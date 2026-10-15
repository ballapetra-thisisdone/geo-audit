// Headless renderelés (playwright-core + a gépre telepített Edge/Chrome). Egy böngészőpéldányt
// használunk az egész auditra; minden kérést SSRF-szűrőn engedünk át, a képeket/médiát nem töltjük le.
import { assertPublicHost, assertSafeUrl, defaultPolicy, type NetPolicy } from '../security.ts';

type Chromium = typeof import('playwright-core').chromium;
type Browser = Awaited<ReturnType<Chromium['launch']>>;

export interface RenderedPage {
  ok: boolean;
  html?: string;
  visibleText?: string;
  status?: number;
  loadMs?: number;
  error?: string;
  blockedRequests: number;
}

export class Renderer {
  private browser?: Browser;
  private engine = '';
  private hostOk = new Map<string, boolean>();
  unavailable?: string;

  constructor(
    private ua: string,
    private channel = 'msedge',
    private policy: NetPolicy = defaultPolicy(),
  ) {}

  get engineName() {
    return this.engine;
  }

  private async launch(): Promise<Browser | undefined> {
    if (this.browser || this.unavailable) return this.browser;
    let chromium: Chromium;
    try {
      const mod = 'playwright-core';
      chromium = (await import(/* @vite-ignore */ mod)).chromium as Chromium;
    } catch {
      this.unavailable = 'A playwright-core nincs telepítve.';
      return undefined;
    }
    const errors: string[] = [];
    for (const channel of [this.channel, 'msedge', 'chrome', 'chromium'].filter((c, i, a) => c && a.indexOf(c) === i)) {
      try {
        this.browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: true, executablePath: process.env.GEO_BROWSER_PATH || undefined });
        this.engine = channel;
        return this.browser;
      } catch (e) {
        errors.push(`${channel}: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    this.unavailable = `Nem indítható headless böngésző (${errors.join(' | ')}). Állítsd be a GEO_BROWSER_PATH változót.`;
    return undefined;
  }

  private async allowed(url: string): Promise<boolean> {
    try {
      const u = assertSafeUrl(url, this.policy);
      const cached = this.hostOk.get(u.hostname);
      if (cached !== undefined) return cached;
      await assertPublicHost(u.hostname, this.policy);
      this.hostOk.set(u.hostname, true);
      return true;
    } catch {
      try {
        this.hostOk.set(new URL(url).hostname, false);
      } catch {
        /* érvénytelen URL */
      }
      return false;
    }
  }

  async render(url: string, timeoutMs: number): Promise<RenderedPage> {
    const browser = await this.launch();
    if (!browser) return { ok: false, error: this.unavailable, blockedRequests: 0 };
    let blockedRequests = 0;
    const context = await browser.newContext({ userAgent: this.ua, locale: 'hu-HU', viewport: { width: 1366, height: 900 }, javaScriptEnabled: true });
    try {
      const page = await context.newPage();
      await page.route('**/*', async (route) => {
        const req = route.request();
        const u = req.url();
        if (u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
        if (['image', 'media', 'font'].includes(req.resourceType())) return route.abort();
        if (!(await this.allowed(u))) {
          blockedRequests++;
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
      const started = performance.now();
      const res = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs * 2 });
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
        /* folyamatos pollingnál nem várunk tovább */
      }
      const html = await page.content();
      const visibleText = (await page.evaluate('document.body ? document.body.innerText : ""')) as string;
      return { ok: true, html, visibleText: visibleText.slice(0, 200000), status: res?.status(), loadMs: Math.round(performance.now() - started), blockedRequests };
    } catch (e) {
      return { ok: false, error: (e as Error).message.split('\n')[0], blockedRequests };
    } finally {
      await context.close().catch(() => {});
    }
  }

  async close() {
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
  }
}
