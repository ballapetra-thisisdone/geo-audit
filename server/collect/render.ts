// Renderelt DOM a gépre telepített Edge/Chrome-mal.
// 1. playwright-core, ha elérhető (mérőszámokkal: LCP, CLS, kérésszám);
// 2. különben a böngésző saját headless --dump-dom módja (függőség nélkül, mérőszámok nélkül).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RenderOutput {
  ok: boolean;
  engine?: string;
  error?: string;
  status?: number;
  html?: string;
  loadMs?: number;
  lcpMs?: number;
  cls?: number;
  requestCount?: number;
  transferBytes?: number;
  thirdPartyDomains?: string[];
  consoleErrors?: string[];
}

const PERF_SCRIPT = `
  window.__geo = { lcp: 0, cls: 0 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__geo.lcp = e.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__geo.cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
`;

type Chromium = typeof import('playwright-core').chromium;

async function loadPlaywright(): Promise<Chromium | undefined> {
  try {
    const mod = 'playwright-core';
    return (await import(/* @vite-ignore */ mod)).chromium as Chromium;
  } catch {
    return undefined;
  }
}

export async function renderPage(url: string, ua: string, channel = 'msedge'): Promise<RenderOutput> {
  const chromium = await loadPlaywright();
  if (chromium) {
    const res = await renderWithPlaywright(chromium, url, ua, channel);
    if (res.ok) return res;
  }
  return renderWithDumpDom(url, ua);
}

async function renderWithPlaywright(chromium: Chromium, url: string, ua: string, preferred: string): Promise<RenderOutput> {
  const channels = [preferred, 'msedge', 'chrome'].filter((c, i, a) => c && a.indexOf(c) === i);
  let browser: Awaited<ReturnType<Chromium['launch']>> | undefined;
  let engine = '';
  try {
    for (const channel of channels) {
      try {
        browser = await chromium.launch({ channel, headless: true });
        engine = channel;
        break;
      } catch {
        /* következő csatorna */
      }
    }
    if (!browser) return { ok: false, error: 'Nem található Edge vagy Chrome (playwright)' };
    const context = await browser.newContext({ userAgent: ua, locale: 'hu-HU', viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(PERF_SCRIPT);
    const host = new URL(url).hostname.replace(/^www\./, '');
    const domains = new Set<string>();
    let requestCount = 0;
    let transferBytes = 0;
    const consoleErrors: string[] = [];
    page.on('request', (req) => {
      requestCount++;
      try {
        const h = new URL(req.url()).hostname;
        if (h && !h.endsWith(host)) domains.add(h);
      } catch {
        /* data: stb. */
      }
    });
    page.on('response', (res) => {
      const len = Number(res.headers()['content-length'] ?? 0);
      if (len) transferBytes += len;
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && consoleErrors.length < 20) consoleErrors.push(m.text().slice(0, 300));
    });
    const started = performance.now();
    const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      /* hosszú pollingnál nem várunk tovább */
    }
    const loadMs = Math.round(performance.now() - started);
    const perf = (await page.evaluate('window.__geo')) as { lcp: number; cls: number } | undefined;
    const html = await page.content();
    await context.close();
    return {
      ok: true,
      engine: `${engine} (playwright)`,
      status: response?.status(),
      html,
      loadMs,
      lcpMs: perf?.lcp ? Math.round(perf.lcp) : undefined,
      cls: perf ? Math.round(perf.cls * 1000) / 1000 : undefined,
      requestCount,
      transferBytes,
      thirdPartyDomains: [...domains].sort(),
      consoleErrors,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message.split('\n')[0] };
  } finally {
    await browser?.close().catch(() => {});
  }
}

function findBrowsers(): string[] {
  const env = process.env.GEO_BROWSER_PATH;
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    env,
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ];
  return [...new Set(candidates.filter((c): c is string => !!c && fs.existsSync(c)))];
}

/** Minden talált böngészővel, előbb az új, majd a régi headless móddal próbálkozik; az első nem üres DOM nyer. */
async function renderWithDumpDom(url: string, ua: string): Promise<RenderOutput> {
  const exes = findBrowsers();
  if (!exes.length) return { ok: false, error: 'Nem található Edge vagy Chrome. Állítsd be a GEO_BROWSER_PATH környezeti változót.' };
  const errors: string[] = [];
  for (const exe of exes) {
    for (const mode of ['--headless=new', '--headless']) {
      const res = await dumpDom(exe, mode, url, ua);
      if (res.ok) return res;
      errors.push(`${path.basename(exe)} ${mode}: ${res.error}`);
    }
  }
  return { ok: false, error: errors.join(' | ') };
}

function dumpDom(exe: string, mode: string, url: string, ua: string): Promise<RenderOutput> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-audit-'));
  const args = [
    mode,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--user-agent=${ua}`,
    '--lang=hu-HU',
    '--virtual-time-budget=10000',
    '--dump-dom',
    url,
  ];
  const started = performance.now();
  return new Promise((resolve) => {
    execFile(exe, args, { maxBuffer: 30 * 1024 * 1024, timeout: 60000, windowsHide: true }, (err, stdout) => {
      fs.rm(profile, { recursive: true, force: true }, () => {});
      const html = stdout?.toString() ?? '';
      if (err && !html) return resolve({ ok: false, error: `Headless böngésző hiba: ${err.message.split('\n')[0]}` });
      if (html.replace(/<[^>]+>/g, '').trim().length < 50) return resolve({ ok: false, error: 'üres DOM' });
      resolve({
        ok: true,
        engine: `${path.basename(exe)} ${mode} --dump-dom`,
        html,
        loadMs: Math.round(performance.now() - started),
      });
    });
  });
}
