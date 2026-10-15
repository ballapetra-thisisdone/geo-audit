---
name: geo-audit
description: GEO / AI-láthatósági audit egy weboldalról a Bing/Copilot és a ChatGPT (OpenAI) szemszögéből – bot user-agentes lekérés, renderelés, robots.txt, sitemap, JSON-LD, kulcsadatok gépi olvashatósága, kérdés-lefedettség, majd DONE-arculatú HTML-riport pontszámmal, fejlesztői backloggal, kódmintákkal, mérési tervvel és ügyfélcsomagokkal. Használd, amikor a felhasználó GEO auditot, AI-láthatósági vagy AI-keresési auditot, „LLM SEO”-t kér, vagy azt kérdezi, mennyire látja/idézi a ChatGPT, a Copilot vagy a Bing egy oldalt – akkor is, ha csak egy URL-t ad meg azzal, hogy nézzük meg, hogyan jelenik meg az AI-keresőkben, vagy egy korábbi audit riportját kell frissíteni (pl. kézi ChatGPT-teszt eredményeivel).
---

# GEO audit

Egy weboldalról diagnózist készítesz arról, mennyire tudják a Bing/Copilot és a ChatGPT-felületek feltérképezni, értelmezni, indexelni és forrásként idézni. A végeredmény egy önálló HTML-riport (`report.html`) és egy backlog (`backlog.csv`), amit a fejlesztő becsülni, az ügyfél pedig érteni tud.

A munka két részből áll, és ez a felosztás szándékos:

- **Gépi rész – a mellékelt szkript.** Bot user-agentekkel lekéri az oldalt, rendereli, ellenőrzi a robots.txt-t, sitemapet, JSON-LD-t, a kulcsadatok helyét, és ~60 szabályalapú ellenőrzést futtat bizonyítékokkal. Ez ismételhető és ellenőrizhető – ugyanarra az oldalra ugyanazt adja.
- **Szakértői rész – te.** Amit szabály nem tud eldönteni: a gépi hibák felülvizsgálata, a célközönség kérdései és azok lefedettsége, idézhetőség, ellentmondó források, az oldalra szabott JSON-LD, a vezetői összefoglaló.

## Alapelvek (miért fontosak)

- **Csak valós adat.** Az audit eredményét ügyfél kapja és fejlesztő dolgozik belőle; egy kitalált ár, dátum vagy „nem válaszolja meg” jelölés rossz döntéshez vezet. Ha valamit nem tudsz igazolni, hagyd „unknown” / „unverifiable” állapotban, vagy kérdezd meg a felhasználót. A bemeneti adatokat se találd ki – amit te javasolsz (pl. az oldalon talált mintaérték), azt mondd ki, és kérj megerősítést.
- **Minden megállapítás címkézett:** observed (Megfigyelt) / likely (Valószínű) / hypothesis (Hipotézis) / unverifiable (Nem ellenőrizhető – szükséges hozzáférés). A címke azt mondja meg az olvasónak, mennyire építhet rá.
- **Bing és ChatGPT külön.** Ami az egyiknek jó, nem feltétlenül elég a másiknak. Ne állítsd, hogy a ChatGPT a Bing-indexből dolgozik (vagy hogy nem), és ne állítsd, hogy a ChatGPT search jutalmazza a schema.org-ot – az OpenAI dokumentációja ezt nem mondja ki.
- **Hivatalos forrás, dátummal.** Bing/Copilot-állításhoz Microsoft-, OpenAI-állításhoz OpenAI-dokumentáció kell. Ha lekéred, rögzítsd a lekérés napját (`meta.docsChecked`).
- **Ne gyárts hibát, és mondd ki, ami jól működik.** Ne javasolj fejlesztést csak azért, mert technikailag lehetséges, és ne javasolj nem dokumentált „AI-optimalizáló” trükköt (rejtett szöveg, csak robotoknak szóló tartalom).

A részletes módszertan (vizsgálati szempontok, robotok, mit szabad állítani): `references/methodology.md`. Olvasd el az első audit előtt.

## Munkafolyamat

A szkript: `scripts/geo-audit.mjs` (ebben a skill-mappában). Csak Node.js 22+ kell hozzá, telepítés nem. Windows-on, ha a `node` nincs a PATH-ban: PowerShellben `& "C:\Program Files\nodejs\node.exe"`, Git Bashben `"/c/Program Files/nodejs/node.exe"`. A rendereléshez a gépen lévő Edge vagy Chrome kell (más útvonalnál: `GEO_BROWSER_PATH` környezeti változó).

### 1. Bemenet összegyűjtése

Kérdezd meg, ami hiányzik – egyszerre, röviden:

| Mező | Kötelező | Megjegyzés |
|---|---|---|
| `url` | igen | élő URL |
| `name`, `org` | ajánlott | oldal/projekt neve; a szervezet **hivatalos** neve (a névegyezés-ellenőrzés ehhez méri az oldalt) |
| `pageType`, `entityType` | ajánlott | pl. projektoldal / ingatlanprojekt, termékoldal / termék, eseményoldal / esemény. Az entitástípusból választja a szkript a szóba jövő schema.org típusokat |
| `keyData` | erősen ajánlott | `[{label, value}]` – a `value` pontosan úgy, ahogy az oldalon szerepel (pl. „89 900 Ft”). Ezzel keresi a szkript a nyers HTML-ben, a renderelt DOM-ban, a JSON-LD-ben és a ChatGPT-User válaszában. Érték nélkül a kulcsadat-ellenőrzések nem ellenőrizhetők |
| `languages`, `cms` | nem | pl. `["hu","en"]`, `WordPress` |
| mentett HTML | nem | a böngészőből mentett oldal útvonala, ha van (`--saved`) |

Ha a felhasználó nem tudja a kulcsadatok pontos értékét, nézd meg az oldalt (WebFetch), és **javasolj** onnan szó szerinti értékeket – de csak megerősítés után kerüljenek be.

Amit nem tudsz igazoltan, azt a mezőt **hagyd ki** az `input.json`-ból (ne írj bele becslést, üres szöveget se kell). A szkript nem feltételez nyelvet; a CMS hiányában „nem ismert”-et ír. Ha a felhasználó nincs elérhető, és csak az URL-t adta meg, futtasd csak URL-lel, és a végén sorold fel, milyen bemeneti értékeket javasolnál megerősítésre.

Írd ki `input.json`-ba (a munkakönyvtárba):

```json
{ "url": "https://…", "name": "…", "org": "…", "pageType": "…", "entityType": "…",
  "cms": "WordPress", "languages": ["hu"], "keyData": [{ "label": "ár", "value": "…" }] }
```

### 2. Gépi adatgyűjtés

```bash
node "<skill-mappa>/scripts/geo-audit.mjs" collect --input input.json [--saved mentett.html] [--out mappa]
```

Alapértelmezett kimenet: `./geo-audit-reports/<domain>-<dátum>/`. Fél–egy percig tart. A mappában: `summary.md` (gépi eredmények tömören), `page-text.txt` (renderelt szöveg), `page-text-raw.txt` (JS nélküli szöveg), `audit.json` (minden adat), `raw/` (nyers válaszok botonként).

**Ha a renderelés sikertelen** (a kimenet `!!! FIGYELEM` sort ír, a `summary.md` elején is jelzi): a szkript már több böngészővel és móddal próbálkozott. Futtasd újra egyszer a `collect`-et (új mappába kerül). Ha megint sikertelen: kérd meg a felhasználót, hogy mentse el az oldalt a böngészőből (Ctrl+S, „csak HTML”), és futtasd `--saved` kapcsolóval; vagy ha ez sem megy, haladj tovább, és a `limitations` közé írd be, hogy a JS-függőség nem volt vizsgálható. Ilyenkor a `page-text.txt` a nyers szöveg – a kérdés-értékelésnél ezt vedd figyelembe.

### 3. Szakértői elemzés

Olvasd el a `summary.md`-t és a `page-text.txt`-t (a teljes `audit.json`-t csak célzottan, ha egy részlet kell). Bizonyítékként a webhely más oldalait is lekérheted (pl. kapcsolat, rólunk, PDF) – ilyenkor a megállapításban add meg az URL-t. Utána készítsd el az `analysis.json`-t a mappába – a pontos szerkezet és a feladatonkénti útmutató: `references/analysis-guide.md`. Röviden:

0. **Hivatalos dokumentáció** – minden auditnál kérd le a `https://developers.openai.com/docs/bots` oldalt, vesd össze a UA-sztringeket és a robots.txt-szabályokat a `config/bots.json`-nal és a `references/methodology.md` állításaival, és rögzítsd a `meta.docsChecked`-ben (URL, dátum, eltérés). Ha a riport más OpenAI- vagy Microsoft-állításra épít, azt is ellenőrizd. Eltérésnél szólj a felhasználónak.
1. **Gépi hibák felülvizsgálata** – minden „Hiba” és „Figyelmeztetés” mögé nézz be (a `raw/` fájlok, az élő oldal). Ha a szabály téved vagy árnyalni kell, `overrides` bejegyzés indoklással és címkével. Ha helytálló, nem kell hozzányúlni. Ha a sablon backlog-tétele nem illik a valódi problémához, vagy egy saját megállapításod már lefedi, az override `backlog` mezőjével írd át vagy nyomd el (részletek az útmutatóban).
2. **Kérdések** – 10–15 keresési és 5–8 ChatGPT-stílusú (hosszabb, összehasonlító, többfeltételes) kérdés az oldal nyelvén, a célközönség szemszögéből. Az `analysis.json` kérdéslistája **teljesen lecseréli** a sablonból indított kérdéseket. Mindegyiknél: van-e egy bekezdésből kiemelhető, lehetőleg dátummal ellátott tény (`fact` – szó szerinti idézet), mi hiányzik, ki a forrása.
3. **Saját megállapítások** (`custom`) – amit a szkript nem lát: ellentmondó források (PDF vs. oldal), csak képen lévő információ tartalma, a szöveg idézhetősége, összehasonlító tartalom hiánya stb. Ha teendő van, adj hozzá `backlog` sablont.
4. **JSON-LD javaslat** (`jsonld`) – az entitásmodell (Organization + fő entitás @id-vel összekötve), csak az oldalon igazolható adattal; a többi `<<HELYŐRZŐ>>`.
5. **Vezetői összefoglaló** (`executiveSummary`, max. 10 sor) – külön a Bing/Copilot- és a ChatGPT-felkészültség, a 3 legnagyobb lehetőség, és ami jól működik.

### 4. Riport

```bash
node "<skill-mappa>/scripts/geo-audit.mjs" report --dir "<audit mappa>"
```

Elkészül a `report.html` és a `backlog.csv`, és a pontszám az elemzéssel együtt újraszámolódik. A riport tartalma: jelmagyarázat, A. vezetői összefoglaló, pontszámok és radar, kulcsadat-mátrix, bot-mátrix, B. részletes audit témakörönként (külön ChatGPT-alponttal), kérdések, C. backlog, D. kódminták, E. mérési terv, F. ügyfélcsomagok, kézi teendők beilleszthető promptokkal, korlátok és források.

### 5. Átadás

Mondd meg a riport útvonalát, a két pontszámot a lefedettséggel együtt, a 3 legfontosabb teendőt, és hogy mely kézi teendők vannak hátra (ChatGPT/Copilot-teszt, Bing Webmaster Tools, szervernapló, WAF). A riport ügyféladatot tartalmaz – ne publikáld és ne töltsd fel sehova kérés nélkül.

## Folytatás és újabb körök

- **Kézi teszt eredményei** (a felhasználó lefuttatta a promptokat a ChatGPT-ben/Copilotban, vagy BWT-adatot hoz): vedd fel az `analysis.json`-ba (`questions[].results`, illetve `overrides` a `crawl.bwt`, `test.logs`, `bots.waf` stb. ellenőrzésekre), és futtasd újra a `report` parancsot. Csak azt rögzítsd, amit a felhasználó ténylegesen látott.
- **Javítás utáni újramérés:** új `collect` futtatás új mappába, az előző `analysis.json` kérdéseit átveheted (a lefedettséget az új szöveg alapján értékeld újra). Hasonlítsd össze a két kör pontszámát.
- **Bővítés:** új kézi ellenőrzés kód nélkül felvehető a `config/checks.json`-ba (`runner: "manual"`, `howTo`, opcionális `backlog`); a meglévő auditra `report --refresh-checks` alkalmazza. Új automatikus ellenőrzéshez a forrásprojekt (`geo-audit/server/checks/runners.ts`) módosítása és újraépítés kell. Robotok: `config/bots.json`, kérdéssablonok: `config/questions.json`.
