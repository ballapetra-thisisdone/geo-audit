import { CodeBlock } from '../../components/ui';
import type { TabProps } from '../AuditView';

export function Measure({ round }: TabProps) {
  const host = new URL(round.input.url).hostname;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <p className="label">E. Mérési terv</p>
        <h3>1. Bing Webmaster Tools</h3>
        <ul className="small" style={{ paddingLeft: 18 }}>
          <li>Indexelés: a vizsgált URL állapota (URL Inspection), indexelt oldalak száma, sitemap-feldolgozás.</li>
          <li>Crawl-hibák és robots.txt-tesztelő; IndexNow-beküldések riportja.</li>
          <li>Megjelenések és kattintások a fő kérdésekre (Search Performance).</li>
          <li>
            <b>AI Performance:</b> Copilot-idézések és a grounding query-k (milyen kérdésekre használja a Copilot az oldalt). Havonta mentsd.
          </li>
        </ul>

        <h3>2. Szervernapló</h3>
        <p className="small">A bingbot, az OAI-SearchBot, a GPTBot és a ChatGPT-User kéréseit külön kell szűrni. A UA hamisítható, ezért IP alapján is ellenőrizni kell: az OpenAI-nál a JSON-listákkal, a bingbotnál fordított DNS-sel.</p>
        <CodeBlock
          snippet={{
            label: 'Gyors szűrés (bash, combined log formátum)',
            lang: 'bash',
            code: `for ua in bingbot OAI-SearchBot GPTBot ChatGPT-User; do\n  echo "== $ua"\n  grep -i "$ua" access.log | awk '{print $9}' | sort | uniq -c   # státuszkódok\ndone\n\n# bingbot IP-ellenőrzés: fordított, majd előre DNS\nhost 157.55.39.1        # → msnbot-157-55-39-1.search.msn.com\nhost msnbot-157-55-39-1.search.msn.com`,
          }}
        />
        <p className="small muted">OpenAI IP-listák: searchbot.json, gptbot.json, chatgpt-user.json (openai.com). A 3. fázisban a napló feltölthető lesz az eszközbe.</p>

        <h3>3. Analitika</h3>
        <ul className="small" style={{ paddingLeft: 18 }}>
          <li>
            ChatGPT-ből érkező forgalom: <code>utm_source=chatgpt.com</code> paraméter és <code>chatgpt.com</code> referrer – külön csatornacsoportba.
          </li>
          <li>Copilotból érkező forgalom külön (copilot.microsoft.com, bing.com/chat referrer).</li>
          <li>Konverziók forrás szerint (ajánlatkérés, foglalás, hívás).</li>
          <li>
            <b>Alulmérés okai:</b> hiányzó referrer (app, másolt link), cookie-hozzájárulás elutasítása, a ChatGPT-ben megválaszolt kérdés kattintás nélkül.
          </li>
        </ul>
        <CodeBlock
          snippet={{
            label: 'GA4 – egyéni csatornacsoport feltétel (szemléltető)',
            lang: 'text',
            code: `Csatorna: "AI asszisztensek"\n  Session source egyezik regex-szel: ^(chatgpt\\.com|chat\\.openai\\.com|copilot\\.microsoft\\.com|perplexity\\.ai|claude\\.ai)$\n  VAGY utm_source = chatgpt.com`,
          }}
        />

        <h3>4. Negyedéves kézi kérdésteszt</h3>
        <p className="small">
          Rögzített kérdéslistával (a „Kérdések és AI-teszt” fül, CSV-export), ChatGPT-ben (keresés bekapcsolva, tiszta munkamenet) és Copilotban. Minden körben
          új kört indíts az eszközben, és rögzítsd: megjelent-e az oldal, melyik URL, milyen tényt idéz, pontos-e. A trend számít, nem az egyes futások. Ha
          elavult tényt idéz, keresd meg a forrását (régi PDF, harmadik fél, cache), és vegyél fel rá backlog-tételt.
        </p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          A ChatGPT és a Copilot eredményei munkamenetenként, helyenként és időben változnak – {host} hiánya egy futásban nem bizonyítja az indexelés hiányát.
        </p>
      </div>
    </div>
  );
}
