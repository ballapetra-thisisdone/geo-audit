# analysis.json – szerkezet és útmutató

Az `analysis.json` a szakértői rész eredménye. Az audit mappájába kerül (az `audit.json` mellé), és a `report` parancs olvassa be. Minden mező opcionális; ami hiányzik, ott a riport a gépi eredményt mutatja. A fájl újraírható, és a `report` újrafuttatható – nincs mellékhatása.

## Tartalom

1. Szerkezet
2. Értékkészletek
3. Útmutató mezőnként
4. Ellenőrzőlista beadás előtt

## 1. Szerkezet

Az alábbi **szerkezeti minta**, nem valós adat. A szögletes zárójeles részek helyére az adott oldal tényei kerülnek.

```json
{
  "meta": {
    "analyst": "Claude (geo-audit skill)",
    "date": "ÉÉÉÉ-HH-NN",
    "docsChecked": [
      { "url": "https://developers.openai.com/docs/bots", "date": "ÉÉÉÉ-HH-NN", "note": "UA-sztringek egyeznek a config/bots.json-nal" }
    ]
  },
  "executiveSummary": [
    "**Bing/Copilot:** […egy mondat a felkészültségről…]",
    "**ChatGPT:** […]",
    "**Jól működik:** […]",
    "**A 3 legnagyobb lehetőség:** 1) […] 2) […] 3) […]"
  ],
  "overrides": [
    { "checkId": "html.locked-content", "status": "pass", "evidence": "observed",
      "note": "[Mit néztél meg, mit találtál – pl. a slider csak dekoratív képeket tartalmaz, a szöveges tartalom a HTML-ben is megvan.]" }
  ],
  "custom": [
    {
      "title": "[rövid cím]",
      "topic": "html",
      "surfaces": ["bing", "chatgpt"],
      "weight": 3,
      "status": "fail",
      "evidence": "observed",
      "summary": "[egy mondat: mi a helyzet, bizonyítékkal]",
      "details": ["[részlet 1]", "[részlet 2]"],
      "sources": [{ "title": "[forrás]", "url": "https://…" }],
      "backlog": {
        "title": "[teendő címe]", "category": "Tartalom/IA", "owner": "ügyfél",
        "implementation": "CMS", "change": "[javasolt változtatás]", "benefit": "[várható előny]",
        "priority": "magas", "effort": "S", "effortReason": "[miért ennyi]", "verification": "[hogyan igazolható]"
      }
    }
  ],
  "questions": [
    { "kind": "search", "text": "[kérdés az oldal nyelvén]", "coverage": "yes",
      "fact": "[szó szerinti idézet az oldalról]", "missing": "", "sourceOwner": "" },
    { "kind": "conversational", "text": "[hosszabb, többfeltételes kérdés]", "coverage": "no",
      "missing": "[milyen tény hiányzik]", "sourceOwner": "ügyfél",
      "results": [
        { "surface": "chatgpt", "date": "ÉÉÉÉ-HH-NN", "appears": "no", "accurate": "unknown", "note": "[csak ha a felhasználó lefuttatta]" }
      ] }
  ],
  "jsonld": { "note": "[mire figyeljen a fejlesztő]", "code": "{ \"@context\": \"https://schema.org\", \"@graph\": [ … ] }" },
  "notes": ["[szakértői megjegyzés, ami nem illik egy ellenőrzéshez sem]"],
  "limitations": ["[a vizsgálat korlátja, pl. a mentett HTML hiányzott]"]
}
```

## 2. Értékkészletek

- `status`: `pass` | `warn` | `fail` | `info` | `na` | `unverifiable`
- `evidence`: `observed` | `likely` | `hypothesis` | `unverifiable`
- `topic`: `crawl` (1. feltérképezés) | `html` (2.) | `schema` (3.) | `ai` (4. idézhetőség) | `bots` (5.) | `tech` (6.) | `test` (7. AI-teszt)
- `surfaces`: `bing` | `chatgpt` | `other` (tömb; mindkettőhöz `["bing","chatgpt"]`)
- `weight`: 0–5 (a pontozásban; a gépi ellenőrzéseknél 1–5)
- `coverage`: `yes` | `partial` | `no` | `unknown`
- `results[].surface`: `chatgpt` | `copilot`; `appears`: `yes` | `no` | `unknown`; `accurate`: `yes` | `partial` | `no` | `unknown`
- backlog `category`: `Hibajavítás` | `SEO/indexelés` | `Strukturált adat` | `AI-láthatóság` | `Tartalom/IA` | `Kísérleti`
- backlog `owner`: `fejlesztő` | `ügyfél` | `mindkettő`; `priority`: `kritikus` | `magas` | `közepes` | `alacsony`; `effort`: `S` | `M` | `L`
- `checkId`: a `summary.md`-ben szereplő azonosítók (pl. `crawl.canonical`, `bots.waf`); a teljes lista a skill `config/checks.json` fájljában

## 3. Útmutató mezőnként

### overrides – a gépi eredmény felülvizsgálata

A szabályok általános heurisztikák; egy adott oldalon tévedhetnek. Minden `fail` és `warn` tételnél nézd meg a bizonyítékot (`summary.md` részletek, `raw/*.html`, élő oldal), és döntsd el:

- **helytálló** → nem kell override;
- **téves vagy túl szigorú** → override a helyes státusszal és a `note`-ban azzal, amit megnéztél (pl. „a 2 slider csak referencia-logókat tartalmaz, az információ szövegben is megvan” → `pass`, `observed`);
- **árnyalandó** → maradhat a státusz, de a `note` pontosít (ez kerül a backlog „Jelenlegi állapot” oszlopába, ezért legyen ügyfélnek is érthető).

Kézi ellenőrzéseknél (`crawl.indexnow`, `crawl.bwt`, `test.logs`, `html.conflicts`, `ai.comparison`, `schema.acp`) csak akkor adj override-ot, ha van valós információ (a felhasználótól vagy az oldalról). A `schema.acp` legyen `na`, ha az oldal nem termék/webshop.

Bizonyítékként a vizsgált webhely más oldalai is használhatók (kapcsolat, rólunk, csapat, PDF) – a `note`-ban add meg az URL-t. A szkript csak a vizsgált URL-t látja, ezért pl. az `ai.entity-trust` vagy a `schema.main-entity` gyakran árnyalandó egy aloldal alapján.

**A backlog-tétel igazítása.** Ha egy hibás/figyelmeztető ellenőrzés sablonja nem írja le jól a valódi teendőt, az override-ban adj `backlog` objektumot – mezőnként felülírja a sablont (pl. csak `title` és `change`):

```json
{ "checkId": "schema.sameas", "status": "warn", "evidence": "observed",
  "note": "[a JSON-LD sameAs linkjei eltérnek a lábléc profiljaitól: …]",
  "backlog": { "title": "sameAs és lábléc-profilok egységesítése", "change": "[…]" } }
```

Ha a teendőt már egy saját megállapításod (`custom`) backlog-tétele lefedi, a duplikáció elkerülésére adj `"backlog": null`-t – ilyenkor a státusz megmarad, de backlog-tétel nem lesz belőle. Ha egy `warn` tételnél te adod meg a `priority`-t, a szkript nem sorolja lejjebb.

### questions – kérdések és lefedettség

- Az itt megadott lista teljesen lecseréli a `summary.md`-ben látható, sablonból indított kérdéseket.
- 10–15 `search` + 5–8 `conversational`, az oldal nyelvén, a célközönség szavaival. A társalgási kérdések sablonjai: „Melyik [kategória] felel meg ezeknek: [feltétel 1], [feltétel 2], [ár/időpont]?”, „Hasonlítsd össze [A]-t és [B]-t…”, „Jogosult vagyok-e…?”, „Ki áll [entitás] mögött, és mik a referenciái?”, „Mennyi a teljes költsége / mik a rejtett költségei…?”.
- A kérdésben csak olyan konkrétum szerepeljen (helyszín, ár, feltétel), ami az oldalból vagy a felhasználótól igazolható. Ha egy sablonhoz nincs valós adat, fogalmazd át általánosra, vagy hagyd ki – a `[helyőrző]` maradó kérdés a riportban nem másolható promptként.
- `coverage`: `yes`, ha a vizsgált oldalon van egy bekezdésből kiemelhető, egyértelmű válasz; `partial`, ha csak részben, szétszórva vagy dátum nélkül; `no`, ha nincs. A lefedettség a **vizsgált URL**-re vonatkozik (`page-text.txt`), mert az AI-felület azt az oldalt idézi.
- `fact`: szó szerinti idézet az oldal szövegéből – a fejlesztő és az ügyfél vissza tudja keresni. Összefüggő mondat vagy kifejezés legyen, ne menüpontokból vagy szomszédos blokkokból összeragasztott töredék (a `page-text.txt` a navigációt is tartalmazza). Ha a válasz csak alt szövegben vagy egy másik aloldalon van, írd oda a helyét: „[alt szöveg] …” vagy „[/kapcsolat/] …” – ilyenkor a lefedettség legfeljebb `partial`. `partial` lefedettségnél a `fact` lehet üres, de akkor a `missing` mondja meg, mi hiányzik.
- `missing` + `sourceOwner`: milyen tény hiányzik, és ki tudja megadni (ügyfél, hatóság, gyártó).
- `results`: csak a felhasználó által ténylegesen lefuttatott ChatGPT/Copilot-teszt eredménye. Soha ne töltsd ki becslésből.

### custom – amit a szkript nem lát

Tipikus témák: ugyanarról a tényről eltérő változatok (két PDF, eltérő számok), képen/PDF-ben lévő kulcsinformáció tartalma, a szöveg idézhetősége (vannak-e tényszerű, önálló bekezdések), összehasonlító tartalom a saját ajánlatok között, azonosíthatóság (ki áll mögötte), nyelvi változatok ellentmondásai. Minden tételhez bizonyíték és címke; ha teendő van, `backlog` sablon, ami önállóan továbbadható fejlesztőnek.

### jsonld – az oldalra szabott javaslat

Organization (stabil `@id`, pl. `https://domain/#organization`) és a fő entitás külön node, `@id`-vel összekötve (provider / organizer / brand / seller), mellette WebPage és szükség szerint BreadcrumbList. Csak az oldalon látható, igazolható érték; ami nincs, az `<<HELYŐRZŐ>>`. FAQPage csak valódi, látható GYIK esetén. Ne javasolj félrevezető típust a rich result kedvéért.

### executiveSummary – vezetői összefoglaló

Legfeljebb 10 sor, ügyfélnek érthetően: mennyire felkészült az oldal külön a Bing/Copilotra és külön a ChatGPT-re (a pontszámot a `report` kiírja, itt a „miért” kell), a 3 legnagyobb lehetőség, és ami jól működik. `**félkövér**` használható.

## 4. Ellenőrzőlista beadás előtt

- Minden állítás mögött van bizonyíték, és a címke megfelel neki.
- A `meta.docsChecked` tartalmazza az OpenAI robot-dokumentáció lekérését (URL + dátum).
- Nincs két backlog-tétel ugyanarra a teendőre (szükség esetén override `"backlog": null`).
- Nincs kitalált érték (ár, dátum, név, eredmény) – ami nem igazolható, az `unknown` / `unverifiable` vagy helyőrző.
- A Bingre és a ChatGPT-re vonatkozó állítások külön vannak, és nem állítasz kapcsolatot a ChatGPT és a Bing-index között hivatalos forrás nélkül.
- Érvényes JSON (a `report` parancs hibát ír, ha nem).
