// AI-crawler és robots audit. A robotokat cél szerint külön kezeljük (keresés / tanítás / felhasználói lekérés);
// a tanító robotok tiltása üzleti döntés, nem hiba. A szerepeket a config/bots.json forrásai dokumentálják.
import type { AiBotRow } from '../../../shared/site.ts';
import type { BotDef } from '../../../shared/types.ts';
import { isAllowed } from '../../collect/robots.ts';
import { detectChallenge } from '../../collect/http.ts';
import { safeFetch, type NetPolicy } from '../security.ts';
import { IssueCollector, type IssueDef } from './issues.ts';
import type { SiteModel } from './model.ts';

const DEF: Record<string, IssueDef> = {
  search_bot_blocked: {
    category: 'ai_access',
    title: 'Keresési/AI-válasz robot ki van zárva – üzleti döntés szükséges',
    why: 'A szolgáltatók dokumentációja szerint a keresési célú robot kizárása esetén a webhely oldalai nem (vagy csak korlátozottan) jelenhetnek meg forrásként az adott felület válaszaiban.',
    fix: 'Döntsd el, hogy a felületen való megjelenés üzletileg kívánatos-e. Ha igen, engedélyezd a robotot a robots.txt-ben (pl. "User-agent: OAI-SearchBot / Allow: /").',
    acceptance: 'A robots.txt a meghozott döntést tükrözi; a döntés dokumentálva.',
    impact: 4,
    effort: 'S',
    owner: 'business',
    evidenceKind: 'measured',
    confidence: 0.9,
  },
  bot_ua_blocked: {
    category: 'ai_access',
    title: 'A szerver/WAF eltérően válaszol robot user-agentre',
    why: 'Ha a tűzfal vagy CDN a robot user-agentet blokkolja, a robots.txt engedélye ellenére sem jut el a tartalom a szolgáltatóhoz.',
    fix: 'Ellenőrizd a WAF/CDN botvédelmi szabályait (pl. Cloudflare "AI bots" beállítás), és engedélyezd a kívánt robotokat a hivatalos IP-listák alapján.',
    acceptance: 'A robot user-agentjével küldött kérés ugyanazt a 200-as tartalmat kapja, mint a böngésző.',
    impact: 4,
    effort: 'M',
    owner: 'dev',
    evidenceKind: 'measured',
    // UA-hamisítással mérve: a valódi robot IP-címe alapján a WAF másképp dönthet
    confidence: 0.6,
  },
};

const CONSEQUENCE: Record<string, string> = {
  crawler: 'Klasszikus kereső: tiltás esetén az oldalak kimaradhatnak a keresőindexből és az arra épülő AI-felületekből.',
  search: 'Keresési/AI-válasz robot: a szolgáltató szerint tiltás esetén az oldalak nem jelennek meg forrásként a válaszokban.',
  training: 'Modelltanítási célú: tiltása a dokumentáció szerint a keresési megjelenést nem befolyásolja. Üzleti/jogi döntés, nem hiba.',
  user: 'Felhasználói kérésre végzett lekérés: a szolgáltatótól függően a robots.txt nem feltétlenül vonatkozik rá.',
  ads: 'Hirdetési céloldal-ellenőrzés: csak hirdetés esetén releváns.',
};

export interface AiBotReport {
  rows: AiBotRow[];
  uaTests: { bot: string; status?: number; bytes?: number; challenge?: string; error?: string; sameAsBrowser: boolean | null }[];
  note: string;
}

export async function aiBotAudit(m: SiteModel, bots: BotDef[], opts: { policy?: NetPolicy; timeoutMs: number; uaTest: boolean }): Promise<{ issues: IssueCollector; report: AiBotReport }> {
  const ic = new IssueCollector(m.site);
  const parsed = m.crawl.robots.parsed;
  const important = m.content.slice(0, 25).map((r) => r.url);
  const rows: AiBotRow[] = [];
  for (const b of bots.filter((b) => b.purpose !== 'browser')) {
    const path = (u: string) => {
      const x = new URL(u);
      return x.pathname + x.search;
    };
    const home = parsed ? isAllowed(parsed, b.token, path(m.crawl.homeUrl)) : undefined;
    const blockedSample = parsed ? important.filter((u) => !isAllowed(parsed, b.token, path(u)).allowed).slice(0, 10) : [];
    rows.push({
      token: b.token,
      name: b.name,
      owner: b.owner,
      purpose: b.purpose,
      allowedHome: home ? home.allowed : m.crawl.robots.status && m.crawl.robots.status >= 500 ? false : null,
      rule: home?.rule,
      specificGroup: !!home?.specific,
      blockedSample,
      consequence: [CONSEQUENCE[b.purpose], b.note].filter(Boolean).join(' '),
      docs: b.sources[0]?.url ?? '',
    });
    if ((b.purpose === 'search' || b.purpose === 'crawler') && (home?.allowed === false || blockedSample.length)) {
      ic.add(
        `search_bot_blocked`,
        DEF.search_bot_blocked,
        { url: m.crawl.robots.url, detail: `${b.name} (${b.owner}): ${home?.allowed === false ? `a kezdőoldal tiltott (${home.rule})` : `${blockedSample.length} fontos oldal tiltott`}` },
      );
    }
  }

  // UA-teszt: a kezdőoldal lekérése a robotok user-agentjével (WAF/CDN felismerés)
  const uaTests: AiBotReport['uaTests'] = [];
  if (opts.uaTest && m.home) {
    const browser = bots.find((b) => b.id === 'browser');
    const ref = browser?.ua ? await safeFetch(m.crawl.homeUrl, { ua: browser.ua, timeoutMs: opts.timeoutMs, policy: opts.policy }) : undefined;
    for (const b of bots.filter((b) => b.fetch && b.ua && b.id !== 'browser')) {
      const r = await safeFetch(m.crawl.homeUrl, { ua: b.ua!, timeoutMs: opts.timeoutMs, policy: opts.policy });
      const challenge = detectChallenge(r.status, r.headers, r.text ?? '');
      const sameAsBrowser = ref?.status ? r.status === ref.status && !challenge : null;
      uaTests.push({ bot: b.name, status: r.status, bytes: r.bytes, challenge, error: r.error, sameAsBrowser });
      if ((r.status && r.status >= 400 && ref?.status && ref.status < 400) || challenge) {
        ic.add('bot_ua_blocked', DEF.bot_ua_blocked, { url: m.crawl.homeUrl, detail: `${b.name} UA → HTTP ${r.status ?? '—'}${challenge ? `, ${challenge}` : ''}; böngésző UA → HTTP ${ref?.status ?? '—'}` });
      }
    }
  }
  return {
    issues: ic,
    report: {
      rows,
      uaTests,
      note: 'A robots.txt értelmezése az RFC 9309 szerint (leghosszabb egyezés). A UA-teszt user-agent hamisítással készül, ezért nem helyettesíti a valódi robot-IP-ről érkező kérést. Az AI-crawlerek engedélyezése nem minden esetben üzletileg előnyös – a döntés a webhely tulajdonosáé.',
    },
  };
}
