# GEO Audit

## Webhely-szintű GEO audit (v2) – webes alkalmazás

Egy domain megadásából: crawl (robots, sitemap, renderelés), technikai és AI-crawler audit, tartalmi GEO és E-E-A-T jelek, entitásgráf, strukturált adat, kérdés-lefedettség (Query/Topic Coverage Matrix), key competitor snapshot, competitor query gapek, AI/search visibility (ha van API-kulcs), GEO Score, prioritásos javaslatok, fejlesztői backlog, JSON/CSV/nyomtatható riport.

```bash
npm install
npm run dev      # http://localhost:5173 → „Webhely-auditok”
npm test
```

Részletek – architektúra, adatmodell, pontozás, külső szolgáltatások és kulcsok, biztonság, korlátok: **[docs/SITE-AUDIT.md](docs/SITE-AUDIT.md)**. Minden külső kulcs opcionális (`.env.example`); kulcs nélkül az AI visibility „nem mérhető”, a többi elemzés teljes.

---

## Oldal-audit (v1) és Claude Code skill

Technikai eszköz egy weboldal **AI-láthatóságának** vizsgálatára két ökoszisztémában:

- **Bing / Microsoft** (Bing, Copilot, Bing-indexre épülő felületek)
- **OpenAI** (ChatGPT search, ChatGPT Atlas, ChatGPT-User lekérések)

Megadsz egy URL-t és a kulcsadatokat. Az eszköz bot user-agentekkel lekéri az oldalt, rendereli, ellenőrzi a robots.txt-t, a sitemapet és a strukturált adatot, majd diagnózist, pontszámot, fejlesztői backlogot, kódmintákat, mérési tervet és ügyfélcsomagokat ad.

## Claude Code skill (elsődleges használat)

Az auditot a **`geo-audit` skill** készíti: a Claude Code-ban elég ennyit írni: „Készíts GEO auditot: https://…”. A skill egy függőség nélküli szkripttel elvégzi a gépi adatgyűjtést, Claude elvégzi a szakértői elemzést, a végeredmény egy önálló HTML-riport (`report.html`) és egy `backlog.csv`.

```bash
npm install                  # csak a forrás építéséhez kell
npm run build:skill          # skill/geo-audit/ összeállítása
npm run install:skill        # build + telepítés: ~/.claude/skills/geo-audit
```

A skill felépítése:

```
geo-audit/                  (~/.claude/skills/geo-audit)
  SKILL.md                  munkafolyamat Claude-nak
  references/               módszertan, analysis.json útmutató
  config/                   checks.json, bots.json, questions.json (szerkeszthető)
  assets/logo-dark.svg
  scripts/geo-audit.mjs     egyfájlos CLI: collect | report
```

Forrás: a skill szövege a `skill-src/`, a CLI a `cli/` mappában van, a motor (lekérés, ellenőrzések, pontozás) a `server/` alatt közös az alkalmazással. Ha módosítasz, futtasd újra: `npm run install:skill`.

## Webes felület (opcionális)

Szükséges: Node.js 22+ és a gépre telepített Microsoft Edge vagy Google Chrome (a rendereléshez, külön böngészőletöltés nélkül).

```bash
npm install
cp .env.example .env      # opcionális
npm run dev               # API: 127.0.0.1:4317, felület: http://localhost:5173
```

Egyportos futtatás (buildelt frontenddel): `npm run build && npm start` → http://localhost:4317

## Fogalmak

| Fogalom | Jelentés |
|---|---|
| **Audit** | Egy vizsgált URL és a bemenet (szervezet, entitástípus, kulcsadatok, nyelvek, modulok). |
| **Kör** | Egy adatgyűjtés (lekérések, renderelés, robots, sitemap) + az akkori ellenőrzés-könyvtár pillanatképe. A körök összevethetők (trend). |
| **Ellenőrzés (check)** | Adat a `config/checks.json`-ban: témakör, felület, súly, futtató, források, backlog-sablon. |
| **Futtató** | `auto` (kód a `server/checks/runners.ts`-ben), `manual` (kód nélkül, a felületen rögzíted), `llm` (2. fázis). |
| **Bizonyíték** | Minden megállapítás címkéje: Megfigyelt / Valószínű / Hipotézis / Nem ellenőrizhető. |

### Bővítés és a jelenlegi kör módosítása

- **Új kézi ellenőrzés:** Ellenőrzés-könyvtár → „+ Új ellenőrzés”, futtató: kézi. Kód nem kell hozzá.
- **Új automatikus ellenőrzés:** írj egy függvényt a `server/checks/runners.ts`-be (csak a begyűjtött adatokból dolgozik), és vedd fel a könyvtárba `impl` kulccsal.
- **Meglévő kör frissítése új ellenőrzésekkel:** Körök fül → „Újrafuttatás az aktuális könyvtárral”. Nincs új adatgyűjtés, a kézi felülírások megmaradnak.
- **Egy ellenőrzés:** Részletes audit → újrafuttatás vagy kézi felülírás (státusz, bizonyíték, indoklás).
- **Saját megállapítás:** témakörönként felvehető, a pontszámba is beszámít.
- **Kérdések:** szerkeszthető lista, sablonokból vagy kézzel; a ChatGPT/Copilot kézi teszt eredménye kérdésenként rögzíthető.

## Kézi teendők

Néhány feladatot sem a gépi ellenőrzés, sem AI API nem tud elvégezni. Ezeket az audit **Kézi teendők** füle írja le lépésről lépésre (felelős, szükséges hozzáférés, időigény, hová kell rögzíteni). Ugyanitt van egy ügyfélnek küldhető hozzáféréskérő levélvázlat.

- ChatGPT-kérdésteszt és Copilot-kérdésteszt (a felületen, kézzel)
- Bing Webmaster Tools áttekintése (ügyfél-hozzáférés kell)
- Szervernapló elemzése (30 napos access log)
- CDN / WAF / botvédelem beállításai (üzemeltetői egyeztetés)
- a könyvtár további kézi ellenőrzései (pl. ellentmondó források)

A feladatok szövege: `web/src/manualTasks.ts`.

## Pontozás

Felületenként (Bing/Copilot, ChatGPT) és témakörönként 0–100, súlyozva: rendben = 1, figyelmeztetés = 0,5, hiba = 0. Az „információ”, „nem releváns” és „nem ellenőrizhető” tétel nem számít bele; helyette **lefedettséget** mutatunk. A pontszám nem garantálja a megjelenést.

## Ellenőrzések

A prompt 1–7. pontja (alap modul) plusz kiegészítő modulok, auditonként ki-be kapcsolhatók:

1. További AI-botok a robots.txt-ben (Anthropic, Perplexity, Google-Extended, Applebot-Extended, CCBot, Meta), keresési és tanító cél szerint szétválasztva
2. CDN/WAF felismerése, challenge-oldalak (alap modulban)
3. Cookie-fal / consent-réteg
4. Bot-válaszidő, HTML-méret, a kulcsadat az első 100 KB-ban, tömörítés
5. A sitemap lastmod hihetősége (alap modulban), IndexNow (kézi)
6. Webhely-szintű bejárás – *3. fázis*
7–8. Entitás és bizalom: sameAs, impresszum, kapcsolat, rólunk, NAP
9. Frissesség: látható dátum, dateModified és lastmod összhangja
10. Kulcsadatok táblázatban vagy `<dl>`-ben, `lang`
11. PDF-leltár, ellentmondó változatok gyanúja
12. Szervernapló (kézi, a 3. fázisban feltölthető)
13. llms.txt – csak jelenlét, **kísérleti**, nem javasoljuk aktívan

## Claude API (2. fázis, előkészítve)

Ha a `.env`-ben van `ANTHROPIC_API_KEY`, a Kérdések fülön az „AI-javaslat” gomb a `CLAUDE_MODEL` modellel (alapértelmezés: `claude-opus-5-5`) kérdéseket generál és értékel az oldal szövege alapján. Ez strukturált JSON-kimenettel megy, szerveroldali fallbackkel. A kód a `server/ai/claude.ts`-ben van, ide kerülnek a további AI-elemzések (idézhetőség, JSON-LD-javaslat, backlog-szövegezés).

## Felépítés

```
config/          ellenőrzés-könyvtár, robotok, kérdéssablonok (JSON, git-be tehető)
server/          Fastify API
  collect/       HTTP-lekérés (bot UA), renderelés (playwright-core + Edge/Chrome), robots.txt-értelmező
  analyze/       HTML → tények, JSON-LD segédek
  checks/        futtatók (runners.ts) és kontextus
  ai/            Claude API
  pipeline.ts    körök futtatása, újrafuttatás, módosítás
  scoring.ts     pontozás, backlog
  samples.ts     kódminták (D. pont)
shared/types.ts  közös típusok
web/             React + Vite felület
data/            auditok (gitignore) – audits/<id>/round-<n>.json + nyers válaszok
```

## GitHubra költözés

A mappa önálló: `package.json`, `.gitignore`, `.env.example` és CI-workflow (`.github/workflows/ci.yml`: típusellenőrzés + build) a helyén van. Saját repóba másolva azonnal működik. Az auditadatok (`data/`) nincsenek verziózva. Csapatos használathoz a `server/store.ts` interfésze mögött adatbázisra cserélhető a tárolás.

## Korlátok

- A UA-hamisítás nem helyettesíti a valódi robot-IP-ről érkező kérést (a WAF IP alapján is dönthet).
- A ChatGPT- és Copilot-teszt kézi és pillanatfelvétel jellegű. Ha az oldal nem jelenik meg, abból nem következik, hogy nincs indexelve.
- A CWV-érték egyetlen laboratóriumi betöltés, nem terepi adat.
- A Bing Webmaster Tools és a szervernapló adatai hozzáférést igényelnek.
