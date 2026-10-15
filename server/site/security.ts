// SSRF-védelem és biztonságos HTTP-lekérés.
// - Csak http(s), csak engedélyezett portok, hitelesítő adat nélküli URL.
// - A DNS-feloldás a kapcsolódáskor történik egy saját lookup-függvénnyel, így a DNS rebinding
//   sem juttat belső címre: minden feloldott IP-t ellenőrzünk, mielőtt a socket létrejön.
// - Méret-, idő- és átirányításkorlát; a tömörített választ korlátozva csomagoljuk ki.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import type { LookupFunction } from 'node:net';

const blocked = new net.BlockList();
// IPv4 – RFC 1918, loopback, link-local, CGNAT, multicast, foglalt, dokumentációs tartományok
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(a, p, 'ipv4');
// IPv6 – loopback, unspecified, ULA, link-local, multicast, dokumentációs, NAT64.
// Az IPv4-mapped (::ffff:0:0/96) tartományt szándékosan NEM vesszük fel: a Node BlockList minden IPv4-címre
// illesztené. A mapped címeket az isPrivateAddress az IPv4 részük alapján ellenőrzi.
for (const [a, p] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96],
] as const) blocked.addSubnet(a, p, 'ipv6');

export interface NetPolicy {
  /** Belső/privát címek engedélyezése – csak tesztkörnyezetben vagy kifejezett beállítással. */
  allowPrivate: boolean;
  allowedPorts: number[];
  maxBytes: number;
}

export const defaultPolicy = (): NetPolicy => ({
  allowPrivate: process.env.GEO_ALLOW_PRIVATE_HOSTS === '1',
  allowedPorts: [80, 443, 8080, 8443],
  maxBytes: 8 * 1024 * 1024,
});

export class BlockedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BlockedError';
  }
}

export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (!family) return true;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) → az IPv4 részt is ellenőrizzük
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(ip)) {
    // hexadecimális IPv4-mapped alak (::ffff:7f00:1) → IPv4
    const [hi, lo] = ip.split(':').slice(-2).map((h) => parseInt(h, 16));
    return blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, 'ipv4');
  }
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** Szintaktikai URL-ellenőrzés (DNS nélkül). Hibát dob, ha a cím nem vizsgálható. */
export function assertSafeUrl(raw: string, policy: NetPolicy = defaultPolicy()): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedError(`Érvénytelen URL: ${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BlockedError(`Csak http(s) engedélyezett: ${u.protocol}`);
  if (u.username || u.password) throw new BlockedError('Hitelesítő adatot tartalmazó URL nem engedélyezett.');
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (!policy.allowPrivate && !policy.allowedPorts.includes(port)) throw new BlockedError(`Nem engedélyezett port: ${port}`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!policy.allowPrivate) {
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) {
      throw new BlockedError(`Belső hosztnév nem vizsgálható: ${host}`);
    }
    if (net.isIP(host) && isPrivateAddress(host)) throw new BlockedError(`Belső IP-cím nem vizsgálható: ${host}`);
    if (!net.isIP(host) && !host.includes('.')) throw new BlockedError(`Nem teljes domainnév: ${host}`);
  }
  return u;
}

/** DNS-ellenőrzés: minden feloldott cím nyilvános-e. A böngészős rendereléshez is használjuk. */
export async function assertPublicHost(host: string, policy: NetPolicy = defaultPolicy()): Promise<void> {
  if (policy.allowPrivate) return;
  const h = host.replace(/^\[|\]$/g, '');
  if (net.isIP(h)) {
    if (isPrivateAddress(h)) throw new BlockedError(`Belső IP-cím: ${h}`);
    return;
  }
  const addrs = await dns.promises.lookup(h, { all: true, verbatim: true });
  if (!addrs.length) throw new BlockedError(`Nem feloldható: ${h}`);
  for (const a of addrs) if (isPrivateAddress(a.address)) throw new BlockedError(`A(z) ${h} belső címre oldódik fel (${a.address}).`);
}

function guardedLookup(policy: NetPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return (callback as (e: Error | null, a: string, f: number) => void)(err, '', 0);
      const list = addresses as unknown as dns.LookupAddress[];
      const bad = list.find((a) => !policy.allowPrivate && isPrivateAddress(a.address));
      if (bad) {
        return (callback as (e: Error | null, a: string, f: number) => void)(
          new BlockedError(`A(z) ${hostname} belső címre oldódik fel (${bad.address}).`),
          '',
          0,
        );
      }
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      (callback as (e: null, a: string, f: number) => void)(null, list[0].address, list[0].family);
    });
  };
}

export interface SafeResponse {
  ok: boolean;
  url: string;
  finalUrl: string;
  status?: number;
  headers: Record<string, string>;
  redirects: { url: string; status: number; location: string }[];
  body?: Buffer;
  text?: string;
  bytes: number;
  truncated: boolean;
  ttfbMs?: number;
  totalMs?: number;
  error?: string;
  blocked?: boolean;
}

export interface FetchOpts {
  method?: 'GET' | 'HEAD';
  ua: string;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
  acceptLanguage?: string;
  policy?: NetPolicy;
  /** Ha false, csak a fejléceket olvassuk. */
  readBody?: boolean;
}

function single(url: URL, opts: FetchOpts, policy: NetPolicy): Promise<{ status: number; headers: Record<string, string>; body: Buffer; truncated: boolean; ttfbMs: number }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const started = performance.now();
    const req = mod.request(
      url,
      {
        method: opts.method ?? 'GET',
        lookup: guardedLookup(policy),
        headers: {
          'user-agent': opts.ua,
          accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': opts.acceptLanguage ?? 'hu-HU,hu;q=0.9,en;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
        },
        timeout: opts.timeoutMs ?? 20000,
      },
      (res) => {
        const ttfbMs = Math.round(performance.now() - started);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
        if (opts.readBody === false || opts.method === 'HEAD' || (res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
          res.resume();
          return resolve({ status: res.statusCode ?? 0, headers, body: Buffer.alloc(0), truncated: false, ttfbMs });
        }
        let stream: NodeJS.ReadableStream = res;
        const enc = (headers['content-encoding'] ?? '').toLowerCase();
        if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
        else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress());
        else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        stream.on('data', (c: Buffer) => {
          if (truncated) return;
          total += c.length;
          if (total > policy.maxBytes) {
            truncated = true;
            chunks.push(c.subarray(0, Math.max(0, c.length - (total - policy.maxBytes))));
            req.destroy();
            return resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks), truncated: true, ttfbMs });
          }
          chunks.push(c);
        });
        stream.on('end', () => resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks), truncated, ttfbMs }));
        stream.on('error', (e: Error) => (truncated ? undefined : reject(e)));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Időtúllépés (${opts.timeoutMs ?? 20000} ms)`)));
    req.on('error', reject);
    req.end();
  });
}

export function decodeBody(buf: Buffer, contentType?: string): string {
  const m = /charset=([^;]+)/i.exec(contentType ?? '');
  let charset = m?.[1]?.trim().replace(/["']/g, '').toLowerCase() ?? 'utf-8';
  if (!m) {
    const head = buf.subarray(0, 2048).toString('latin1');
    const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
    if (meta) charset = meta[1].toLowerCase();
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/** Biztonságos lekérés kézi átirányítás-követéssel; minden ugrást újra ellenőrzünk. */
export async function safeFetch(rawUrl: string, opts: FetchOpts): Promise<SafeResponse> {
  const policy = opts.policy ?? defaultPolicy();
  const redirects: SafeResponse['redirects'] = [];
  const started = performance.now();
  let current = rawUrl;
  const max = opts.maxRedirects ?? 10;
  try {
    for (let i = 0; i <= max; i++) {
      const u = assertSafeUrl(current, policy);
      const r = await single(u, opts, policy);
      const loc = r.headers['location'];
      if (r.status >= 300 && r.status < 400 && loc) {
        const next = new URL(loc, u).toString();
        redirects.push({ url: current, status: r.status, location: next });
        if (redirects.some((x, idx) => idx < redirects.length - 1 && x.url === next)) {
          return { ok: false, url: rawUrl, finalUrl: next, headers: r.headers, redirects, bytes: 0, truncated: false, error: 'Átirányítási hurok', status: r.status };
        }
        current = next;
        continue;
      }
      const text = opts.readBody === false || opts.method === 'HEAD' ? undefined : decodeBody(r.body, r.headers['content-type']);
      return {
        ok: true,
        url: rawUrl,
        finalUrl: current,
        status: r.status,
        headers: r.headers,
        redirects,
        body: r.body,
        text,
        bytes: r.body.length || Number(r.headers['content-length'] ?? 0),
        truncated: r.truncated,
        ttfbMs: r.ttfbMs,
        totalMs: Math.round(performance.now() - started),
      };
    }
    return { ok: false, url: rawUrl, finalUrl: current, headers: {}, redirects, bytes: 0, truncated: false, error: `Túl sok átirányítás (>${max})` };
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      url: rawUrl,
      finalUrl: current,
      headers: {},
      redirects,
      bytes: 0,
      truncated: false,
      error: err.message,
      blocked: err instanceof BlockedError || err.name === 'BlockedError',
      totalMs: Math.round(performance.now() - started),
    };
  }
}
