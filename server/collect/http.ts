// HTTP-lekérés kézi átirányítás-követéssel, hogy a lánc rögzíthető legyen.

export interface HttpResult {
  ok: boolean;
  status?: number;
  finalUrl: string;
  redirects: { url: string; status: number }[];
  headers: Record<string, string>;
  body?: string;
  bytes?: number;
  ttfbMs?: number;
  totalMs?: number;
  error?: string;
}

const MAX_BYTES = 6 * 1024 * 1024;

export async function httpGet(
  url: string,
  opts: { ua: string; method?: 'GET' | 'HEAD'; maxRedirects?: number; timeoutMs?: number; readBody?: boolean } ,
): Promise<HttpResult> {
  const redirects: { url: string; status: number }[] = [];
  let current = url;
  const started = performance.now();
  const max = opts.maxRedirects ?? 10;
  try {
    for (let i = 0; i <= max; i++) {
      const res = await fetch(current, {
        method: opts.method ?? 'GET',
        redirect: 'manual',
        headers: {
          'user-agent': opts.ua,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'hu-HU,hu;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
      });
      const ttfbMs = Math.round(performance.now() - started);
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        redirects.push({ url: current, status: res.status });
        current = new URL(loc, current).toString();
        await res.body?.cancel();
        continue;
      }
      let body: string | undefined;
      let bytes: number | undefined;
      if (opts.readBody !== false && (opts.method ?? 'GET') === 'GET') {
        const buf = await readLimited(res);
        bytes = buf.byteLength;
        body = decode(buf, res.headers.get('content-type'));
      } else {
        await res.body?.cancel();
        const cl = res.headers.get('content-length');
        bytes = cl ? Number(cl) : undefined;
      }
      return {
        ok: true,
        status: res.status,
        finalUrl: current,
        redirects,
        headers,
        body,
        bytes,
        ttfbMs,
        totalMs: Math.round(performance.now() - started),
      };
    }
    return { ok: false, finalUrl: current, redirects, headers: {}, error: 'Túl sok átirányítás' };
  } catch (e) {
    return { ok: false, finalUrl: current, redirects, headers: {}, error: (e as Error).message };
  }
}

async function readLimited(res: Response): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function decode(buf: Uint8Array, contentType: string | null): string {
  const m = /charset=([^;]+)/i.exec(contentType ?? '');
  let charset = m?.[1]?.trim().toLowerCase() ?? 'utf-8';
  if (!m) {
    const head = new TextDecoder('latin1').decode(buf.slice(0, 2048));
    const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
    if (meta) charset = meta[1].toLowerCase();
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/** Ismert challenge-/blokkoló oldalak felismerése. */
export function detectChallenge(status: number | undefined, headers: Record<string, string>, body = ''): string | undefined {
  const head = body.slice(0, 20000);
  if (headers['cf-mitigated'] === 'challenge') return 'Cloudflare challenge (cf-mitigated)';
  if (/<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(head) || /challenge-platform|cf-chl-/i.test(head)) return 'Cloudflare challenge-oldal';
  if (/Attention Required! \| Cloudflare/i.test(head)) return 'Cloudflare blokkoló oldal';
  if (/sucuri website firewall/i.test(head)) return 'Sucuri WAF blokk';
  if (/Request unsuccessful\. Incapsula/i.test(head) || /_Incapsula_Resource/i.test(head)) return 'Imperva/Incapsula blokk';
  if (/Access Denied[\s\S]{0,400}Reference #/i.test(head)) return 'Akamai Access Denied';
  if (/captcha/i.test(head) && (status === 403 || status === 429)) return 'CAPTCHA';
  if (status === 401) return 'Jelszavas védelem (401)';
  return undefined;
}
