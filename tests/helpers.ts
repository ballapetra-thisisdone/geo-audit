// Teszt-segédek: kontrollált helyi weboldal és memóriabeli adatbázis.
// FIGYELEM: az itt definiált tartalom és a mock adapterek kizárólag tesztadatok.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb, setDb } from '../server/site/db.ts';

export type Route = { status?: number; headers?: Record<string, string>; body?: string | ((base: string) => string) };

export async function serve(routes: (base: string) => Record<string, Route>, host = '127.0.0.1'): Promise<{ base: string; close: () => Promise<void>; hits: string[] }> {
  const hits: string[] = [];
  let base = '';
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('#')[0];
    hits.push(`${req.method} ${path} ${req.headers['user-agent'] ?? ''}`);
    const table = routes(base);
    const r = table[path] ?? table[path.split('?')[0]];
    if (!r) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><body><h1>404</h1></body></html>');
    }
    res.writeHead(r.status ?? 200, { 'content-type': 'text/html; charset=utf-8', ...(r.headers ?? {}) });
    res.end(typeof r.body === 'function' ? r.body(base) : (r.body ?? ''));
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://${host === '127.0.0.1' ? '127.0.0.1' : host}:${port}`;
  return { base, hits, close: () => new Promise((r) => server.close(() => r())) };
}

export function memoryDb() {
  const db = openDb(':memory:');
  setDb(db);
  return db;
}

export const page = (o: { title?: string; lang?: string; head?: string; body: string }) =>
  `<!doctype html><html${o.lang === undefined ? ' lang="hu"' : o.lang ? ` lang="${o.lang}"` : ''}><head><meta charset="utf-8">${o.title ? `<title>${o.title}</title>` : ''}${o.head ?? ''}</head><body>${o.body}</body></html>`;
