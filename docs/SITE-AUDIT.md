# Webhely-szintű GEO Audit (v2) – architektúra és működés

Egyszeri, pillanatfelvétel-alapú GEO audit egy domainről és a key competitorokról. A rendszer feltérképezi a webhelyet, technikai és szemantikai elemzést végez, kérdés-lefedettséget mér, versenytársakat hasonlít össze, és ha van hozzáférés, tényleges AI/search válaszokat gyűjt. Az eredmény prioritásos, bizonyítékokhoz kötött javaslatlista és fejlesztői backlog.

> A v1 (egyetlen oldalt vizsgáló Bing/ChatGPT audit + Claude Code skill) változatlanul működik a `#/pages` útvonalon és a `geo-audit` skillben.

## Indítás

```bash
npm install
cp .env.example .env     # opcionális kulcsok
npm run dev              # felület: http://localhost:5173, API: 127.0.0.1:4317
npm test                 # egység-, integrációs és e2e tesztek
```

Szükséges: Node.js 22.5+ (beépített `node:sqlite`), a renderelés miatt telepített Edge vagy Chrome. Egyportos futtatás: `npm run build && npm start`. Külön worker-folyamat: `GEO_EMBEDDED_WORKER=0 npm start` + `npm run worker`.

## Stack és indoklás

| Réteg | Választás | Miért |
|---|---|---|
| Nyelv | TypeScript (Node 24, tsx) | a meglévő projekt stackje; közös típusok a szerver és a felület között (`shared/site.ts`) |
| API | Fastify (`/api/v2`) | már használatban; gyors, egyszerű |
| Adatbázis | SQLite (`node:sqlite`, WAL) | normalizált séma natív függőség nélkül; egy fájl, könnyen menthető; a repository réteg mögött cserélhető PostgreSQL-re |
| Job queue | SQLite-tábla + worker | tartós, újraindítás után folytatható, retry-jal; Redis nem kell egy audit-léptékű MVP-hez |
| Crawler | saját, `node:http(s)` + cheerio | SSRF-védelem a socket szintjén (DNS-rebinding ellen is), robots/crawl-delay, átirányításlánc rögzítése |
| Renderelés | playwright-core + rendszer Edge/Chrome | nincs böngészőletöltés; kérésszintű SSRF-szűrés |
| LLM | Anthropic SDK (Claude), szolgáltató-független interfész | strukturált JSON-kimenet + zod; opcionális |
| Felület | React + Vite | meglévő; DONE-arculatú stílusrendszer |

## Architektúra

```
web/src/site/            felület (15 fül, URL-részletek, export)
server/site/
  routes.ts              /api/v2 végpontok
  jobs.ts                tartós job queue (retry, beragadt futások visszaállítása)
  pipeline.ts            20 lépéses audit, lépésenként független hibakezeléssel
  security.ts            SSRF-védelem, biztonságos HTTP-kliens (méret-, idő-, átirányításkorlát)
  crawl/                 url-normalizálás, sitemap, crawler, headless renderelő
  extract/page.ts        HTML → fő tartalom, szakaszok, linkzónák, JSON-LD/Microdata/RDFa, szerző, dátum, simhash
  analyze/               model (oldalbesorolás, linkgráf, PageRank), context, technical, aibots, structured,
                         entities, content, trust, links, queries (generálás + BM25 megválaszolhatóság), compare
  llm/                   provider (Claude, cache, keret, költség) és feladatok (idézet-validálással)
  visibility/            adapterek (OpenAI, Perplexity, Claude web search, Brave) + mérés
  scoring.ts             GEO Score motor (config/scoring.json)
  recommend.ts           false-positive szűrés, prioritás, javaslatok, backlog, vezetői összefoglaló
  export.ts              JSON, CSV, nyomtatható HTML-riport
  repo.ts, db.ts         normalizált adatmodell
config/
  bots.json              robotok szerepe (forrás + ellenőrzés dátuma)
  structured-data.json   schema.org készlet + Google rich result követelmények (forrással)
  scoring.json           komponensek és súlyok
```

## Audit folyamat

Lépésenként rögzített állapot, időbélyeg, hiba és haladás (a „Crawl és folyamat” fülön élőben):

1. Input validálása → 2. domain-ellenőrzés (DNS, SSRF) → 3. robots.txt és sitemap → 4. crawl → 5. renderelés → 6–7. HTML-, metaadat- és tartalomkinyerés → üzleti kontextus → technikai és AI-crawler audit → 8. strukturált adat → 9. entitások → 10. tartalom (+ E-E-A-T) → 11. kérdések → 12. versenytársak → 13. AI/search → 14. citation-feldolgozás → 15. összehasonlítás → 17–18. false-positive szűrés és prioritás → 16. scoring → 19. ajánlások és backlog → 20. riport.

A pontozás a prioritizált problémákra épül, ezért a false-positive szűrés a scoring előtt fut. A lépések függetlenek: ha nincs AI API, vagy egy versenytárs-crawl elbukik, a többi lépés lefut. Az auditot ilyenkor „részleges” állapot jelzi, ha valami hibázott; ha egy modul csak nincs konfigurálva, azt „kihagyva / nem mérhető” jelzi.

## Crawler

- Robots.txt (RFC 9309) betartása a saját `GEOAuditBot` tokennel; 5xx robots esetén nincs crawl. A `Crawl-delay` tiszteletben tartva (max. 30 s).
- Sitemap és sitemap index (gzip is), csak a domainen belül.
- BFS mélységkorláttal; a csak sitemapből elérhető URL-ek külön fázisban (nehezen felfedezhető / orphan jelölt).
- URL-normalizálás: séma/hoszt kisbetű, alapport, fragment, tracking- és session-paraméterek, rendezett query (konfigurálható).
- Átirányításlánc rögzítése, hurokfelismerés; újrapróbálás 429/5xx/hálózati hibánál (Retry-After); lapozás az 5. oldalig.
- Besorolás: indexelhető, noindex, kanonizált, átirányítás, hibás, robots-tiltott, nem HTML; jelzők: thin, duplikált (szöveghash), közel duplikált (simhash ≤ 3 bit), orphan, mély, linkből nem elérhető, JS-függő, kevés belső link.
- Renderelés: automatikusan a fontos és a gyanúsan üres oldalakon (vagy mindenhol, korláttal). Nyers vs. renderelt szószám, title, canonical, JSON-LD és noindex összevetése; rejtett blokkok (details, tab, accordion, `hidden`) jelzése. A JS-tartalom nem automatikusan hiba: csak a nyers HTML-ből hiányzó lényeges tartalom az.

## Adatmodell

Normalizált táblák (SQLite): `users`, `projects`, `domains`, `audits`, `crawl_jobs`, `pages`, `page_snapshots` (http / raw / rendered), `links`, `issues`, `recommendations`, `scores`, `entities`, `entity_relationships`, `structured_data_records`, `queries`, `query_clusters`, `topics`, `competitors`, `ai_platforms`, `ai_responses`, `citations` (mention és citation külön sorban), `source_urls`, `opportunities`, `developer_tasks`, `audit_evidence`, valamint `artifacts` (elemzési riportok), `audit_logs`, `jobs` és `llm_cache`.

- Project → Domain → Audit → CrawlJob → Pages → Issues → Recommendations → DeveloperTasks
- Audit → Competitors → Queries → AIResponses → Citations/Mentions → SourceURLs → Domain → Topic

Minden audit tárolja az audit ID-t, a dátumokat, a teljes konfigurációt, az adatforrásokat (állapottal) és a módszerverziót (`site-audit/1.0.0`). A monitoring később hozzáadható: ugyanarra a projektre/domainre több audit futtatható, és a táblák auditonként tárolják az adatot. Időzítés, trend és értesítés az MVP-ben nincs.

## Pontozás

`config/scoring.json` súlyai szerint 13 komponens: Technical Crawlability, AI Accessibility, Content Clarity, Answerability, Entity Clarity, Structured Data, Trust Signals, Citation Potential (becslés), Topical Coverage, Internal Linking, Content Freshness, Query Coverage, AI Visibility (csak mérve).

Minden komponensnél megjelenik a pont, a maximum, a bizonyosság, a magyarázat, a módszer, az adatforrás és a bizonyíték. Ha egy komponenshez kevés az adat, `insufficient` vagy `not_measured` jelölést kap: ilyenkor nem nulla pont, hanem kimarad a súlyozásból. Az összpontszám csak akkor jelenik meg, ha a mért súlyarány legalább 60%. A GEO Score belső, dokumentált értékelés, nem univerzális AI-rangsorolási mérőszám.

Prioritás (P0–P3): hatás × üzleti fontosság (fontos oldalt érint-e) × kiterjedés × bizonyosság × bizonyítékminőség ÷ ráfordítás. P0 csak blokkoló, magas bizonyosságú hiba lehet.

## Adatminőség és bizonyíték

Minden megállapítás jelöli az adat eredetét:
- mért technikai tény;
- crawl alapján megfigyelt;
- külső API-ból megfigyelt;
- AI-alapú értékelés;
- becslés;
- ajánlás;
- nem ellenőrizhető.

A false-positive szűrő elveti a bizonyíték nélküli tételeket, összevonja az ismétlődőket, és csökkenti a bizonyosságot hiányos adatnál (pl. ha a crawl elérte az oldalkorlátot). A tanító célú robotok tiltását nem kezeli hibának.

Javaslatok:
- **Tesztelt kód:** a JSON-LD-t `JSON.parse` és a schema.org készlet ellenőrzi; a robots.txt-javaslatot az RFC 9309 értelmező.
- **Ellenőrizetlen:** kivonat, belső link.
- **Kitöltendő sablon:** brief, GYIK-kérdések, szerzői bemutatkozás.

Nem generálunk értékelést, szerzőt, árat vagy választ igazolt adat nélkül. A strukturált adat javaslatai kizárólag a webhelyen látott értékeket használják.

A generált kérdések hipotézisek. Lefedettségüket szakasz-szintű BM25 adja, a következő szabályokkal:
- A több oldalon ismétlődő sablonszakaszok és a más oldalra mutató kártyák (teaserek) nem adhatnak teljes választ.
- Szándékspecifikus feltételek: árkérdéshez pénznem, tranzakciós kérdéshez ajánlatkérési elem, lokálishoz helynév kell.
- Ha van LLM, az ítéletét csak szó szerint ellenőrizhető idézettel fogadjuk el teljesnek.

## Külső szolgáltatások és API-kulcsok

| Szolgáltatás | Változó | Mire | Kulcs nélkül |
|---|---|---|---|
| Claude (Anthropic) | `ANTHROPIC_API_KEY`, `LLM_MODEL` | oldalértékelés, kérdés-lefedettség ellenőrzése | kikapcsolva, determinisztikus elemzés fut |
| OpenAI Responses + web_search | `OPENAI_API_KEY`, `OPENAI_SEARCH_MODEL` | AI-válasz + `url_citation` | „API nem konfigurált” |
| Perplexity Sonar | `PERPLEXITY_API_KEY` | AI-válasz + `citations` / `search_results` | „API nem konfigurált” |
| Claude web search | `ANTHROPIC_API_KEY` + `CLAUDE_SEARCH_ENABLED=1` | AI-válasz + `web_search_result_location` | „API nem konfigurált” |
| Brave Search | `BRAVE_SEARCH_API_KEY` | SERP top 10 | „API nem konfigurált” |

Az AI Visibility csak ténylegesen visszakapott válaszokból számol:
- **MENTION:** a domain vagy a márkanév szerepel a szövegben.
- **CITATION:** a szolgáltató ellenőrizhető forrás-URL-t ad vissza.
- **Share of Voice:** mention share és citation share külön; a nevező a követett domainek (saját + key competitorok) összes említése, illetve citationje.

A kérdésminta és a platformok a riportban dokumentálva vannak. Szimulált AI-választ a rendszer nem állít elő. A mock adapterek kizárólag a tesztekben léteznek.

LLM-költség: auditonkénti híváskeret (`llm.maxCalls`), SQLite-cache (azonos prompt → nincs új hívás), előzetes becslés karakter/4 tokennel és a futás utáni tényleges használat. Az árak a `server/site/llm/provider.ts` táblájában vannak.

## Biztonság

- **SSRF:** csak http(s), engedélyezett portok, hitelesítő adat nélküli URL. A belső hosztneveket és a privát, loopback, link-local, CGNAT és metadata IP-tartományokat a DNS-feloldás *után*, a socket létrejötte előtt tiltjuk, minden átirányítási ugrásnál újra. A headless böngésző minden kérése ugyanezen a szűrőn megy át.
- **Erőforrás:** válaszméret-korlát (8 MB), timeout, oldalszám-, mélység-, párhuzamosság- és renderkorlát, gzip-bomba ellen korlátozott kicsomagolás.
- **Prompt injection:** a weboldalszöveg jelölt `<untrusted_content>` blokkban kerül az LLM-hez (a záró tag nem hamisítható). A kimenetet zod validálja, és csak szó szerint ellenőrzött idézetet fogadunk el.
- **Titkok:** csak környezeti változóban (`.env`, git-ignore).
- **A vizsgált webhelyet nem módosítjuk:** a javaslatok csak riportban és exportban jelennek meg.

## Tesztek

`npm test` (node:test + tsx), összesen 21 teszt:
- URL-normalizálás, domainhatár, lapozás;
- SSRF (IP-tartományok, átirányítás, méret, timeout);
- robots és Crawl-delay, sitemap;
- HTML-kinyerés, simhash;
- JSON-LD és rich result szabályok;
- nyelvfelismerés, BM25, Answer Coverage Score, prioritás, CSV;
- adapter-parszolás dokumentált válaszformátumokra, mention/citation/SoV;
- LLM-séma és idézet-validálás, prompt-határolás;
- job queue retry;
- **e2e:** két helyi, kontrollált tesztoldal (saját + versenytárs) teljes pipeline-nal és mock AI-adapterrel.

## Korlátok (MVP)

- Egyszeri pillanatfelvétel: nincs ütemezett újracrawl, trend, értesítés vagy historikus visibility tracking.
- A crawl az oldalkorlátig fut. Nagy webhelynél a linkgráf, az orphan-felismerés és a lefedettség részleges (a riport jelzi).
- A kérdések hipotézisek: keresési volumen-adat (pl. Search Console, kulcsszóeszköz) integráció nélkül nem igazoltak.
- A lexikai megválaszolhatóság közepes bizonyosságú. LLM-mel pontosabb, de az is hívásköltség.
- A UA-teszt user-agent hamisítás: nem helyettesíti a valódi robot-IP-ről érkező kérést.
- Képbe ágyazott szöveg felismerése (OCR) nincs; csak gyanús fájlnév alapján jelezzük.
- Plágiumot vagy internetes duplikációt külső összehasonlítás nélkül nem állítunk; a duplikáció csak a webhelyen belül mért.
- A Google rich result követelmények a forrásokban jelölt dátummal ellenőrzöttek (2026-10-14), és változhatnak.
