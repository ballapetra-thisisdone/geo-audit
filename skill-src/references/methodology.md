# Módszertan

Ez a skill a felhasználó (DONE. Digital) audit-keretrendszerére épül. Szerep: senior technikai SEO-, webfejlesztő és strukturáltadat-szakértő, aki két AI-keresési ökoszisztémára specializálódott: (1) Bing és Microsoft-felületek (Bing, Copilot, Bing-indexre épülő AI-felületek), (2) OpenAI-felületek (ChatGPT search, ChatGPT Atlas, ChatGPT-ben végzett felhasználói oldallekérések).

A cél nem elsősorban hibakeresés, hanem egy **fejlesztői backlog**, amelyből a csapat becsülni tud, a projektvezető pedig látja az üzleti értéket.

## Tartalom

1. A mentett HTML kezelése
2. Vizsgálati szempontok (1–7) – mit fed le a szkript, mi a te dolgod
3. Robotok és hivatalos állítások
4. Munkamódszer
5. Kimenet (A–F)

## 1. A mentett HTML kezelése

Ha van a böngészőből mentett HTML (`--saved`): az a JavaScript lefutása utáni DOM, nem a szerver nyers válasza. A szkript (`crawl.saved-html`) ellenőrzi, hogy byte-ra egyezik-e a nyers válasszal, hogy a megnevezett oldal-e (canonical / og:url / title), és hogy bejelentkezett felhasználó mentette-e (admin sáv). A mentett fájlból csak a renderelt állapotra vonj le következtetést.

## 2. Vizsgálati szempontok

A táblázat megmutatja, mit ad a szkript, és hol kell a te mérlegelésed.

| # | Témakör | Szkript (gépi) | Te (szakértői) |
|---|---|---|---|
| 1 | Feltérképezés, indexelés | státusz, átirányítás, title, meta, canonical, robots meta, X-Robots-Tag, robots.txt, sitemap + lastmod hihetőség, soft 404, paraméteres URL-ek, BWT-jel | IndexNow indokoltsága (gyakran változó ár/elérhetőség/időpont), BWT-teendők, duplikált tétel-aloldalak |
| 2 | HTML, szemantika | H1, címsorok, landmarkok, alt, horgonyok, iframe/térkép/slider/videó/PDF jelenléte, JS-függőség, kulcsadat-mátrix | mi van ténylegesen a képben/PDF-ben/sliderben, ellentmondó források, javasolt HTML-részletek |
| 3 | Strukturált adat | JSON-LD leltár, parse-hibák, Organization, fő entitás, névegyezés, BreadcrumbList, WebPage, FAQ-hitelesség, JS-injektált séma, sameAs | entitásmodell-javaslat, mi nincs összhangban a látható tartalommal |
| 4 | AI-keresés, idézhetőség | tényblokk, frissesség, azonosíthatóság, llms.txt (kísérleti) | 10–15 + 5–8 kérdés és lefedettségük, idézhető szövegblokkok javaslata, összehasonlító tartalom |
| 5 | Robotok, hozzáférés | robots.txt botonként, ChatGPT-User JS nélkül, noindex-ellentmondás, nocache/noarchive, WAF-jelek, további AI-botok, consent, TTFB | üzleti kompromisszum (tanító vs. kereső botok), WAF-teendő |
| 6 | Technikai alapok | HTTPS, viewport, lang, hreflang, Open Graph + og:image, betöltés (ha mérhető), külső szkriptek, tömörítés | felesleges bővítmények megnevezése |
| 7 | Gyakorlati AI-teszt | – | promptok a riportban; az eredményt a felhasználó futtatja és hozza |

## 3. Robotok és hivatalos állítások

Ellenőrizd a hivatalos forrást, ha az állítás a riportba kerül; a dokumentáció gyakran változik. Kiindulópontok:

- OpenAI robotok, IP-listák, robots.txt-időzítés: https://developers.openai.com/docs/bots
- OpenAI Publishers and Developers FAQ (ChatGPT search megjelenés, noindex, utm_source): https://help.openai.com/en/articles/12627856-publishers-and-developers-faq
- Bing: https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a, robots meta: https://www.bing.com/webmasters/help/which-robots-metatags-does-bing-support-5198d240, nocache/noarchive a Copilotra: https://blogs.bing.com/webmaster/september-2023/Announcing-new-options-for-webmasters-to-control-usage-of-their-content-in-Bing-Chat

Amit az OpenAI dokumentációja mond (2026-10-14-én ellenőrizve – a lekéréskor frissítsd):

- **OAI-SearchBot** – ChatGPT search; robots.txt-vel szabályozható; nem tanításra gyűjt. A kizárt oldalak nem jelennek meg a válaszokban, legfeljebb navigációs linkként. A robots.txt-módosítás kb. 24 óra alatt hat. IP: `https://openai.com/searchbot.json`.
- **GPTBot** – modelltanítás; robots.txt-vel szabályozható. Független az OAI-SearchBottól, de ha mindkettő engedélyezett, egy lekérés mindkét célra felhasználható. IP: `gptbot.json`.
- **ChatGPT-User** – felhasználói kérésre végzett lekérés, nem automatikus crawling; a robots.txt erre nem feltétlenül vonatkozik. Ez olvassa a ChatGPT-be beillesztett URL-t. IP: `chatgpt-user.json`.
- **OAI-AdsBot** – csak a ChatGPT-hirdetésként beküldött landing oldalak; csak hirdetés esetén releváns.
- A robots.txt-ben tiltott oldal címmel és linkkel még megjelenhet (pl. Atlasban). Ennek megakadályozásához `noindex` kell, amit a robotnak le kell tudnia kérni – a tiltás + noindex együtt ellentmondás.

Bing / Copilot: a `nocache`-sel jelölt tartalomból a Copilot csak URL-t, címet és kivonatot használ; a `noarchive`-val jelölt nem jelenik meg a válaszokban (Microsoft blog, 2023-09). Valódi bingbot fordított DNS-sel ellenőrizhető (`*.search.msn.com`).

Ne állítsd, hogy a ChatGPT a Bing-indexből dolgozik, vagy hogy nem, ha hivatalos OpenAI-forrás nem támasztja alá; írd le, mit mond az aktuális dokumentáció, és mi ennek a következménye a Bing-indexelés fontosságára.

AI-crawlerek általában: válaszd külön a keresési/válaszadó és a modelltanító robotokat, csak dokumentált robotokat említs, és írd le az üzleti kompromisszumot. Ne javasold automatikusan, hogy mindent engedjenek.

Az OpenAI termékfeed-specifikációját (ChatGPT shopping / Agentic Commerce Protocol) csak akkor javasold, ha a hivatalos feltételek szerint az oldal kategóriája támogatott.

Open Graph: az og:image a ChatGPT/Atlas linkelőnézeteinél is látszhat – ezt csak megfigyelésként jelezd, ne rangsorolási tényezőként.

## 4. Munkamódszer

- Címkék: [Megfigyelt] / [Valószínű] / [Hipotézis] / [Nem ellenőrizhető – szükséges hozzáférés: …].
- Ha egy keresés nem ad találatot, abból ne állítsd, hogy az oldal nincs indexelve.
- Harmadik féltől származó forrás másodlagos; nem építhető rá backlog-tétel hivatalos megerősítés nélkül.
- Ha valami jól működik, mondd ki. Ne gyárts hibát. Ne javasolj fejlesztést csak azért, mert technikailag lehetséges.
- Ne javasolj nem dokumentált „AI-optimalizáló” trükköt (rejtett szöveg, csak robotoknak szóló tartalom, garantált hatású nem szabványos fájlok).
- Ne találj ki árat, értékelést, dátumot – a JSON-LD-ben sem.

## 5. Kimenet (amit a riport tartalmaz)

- **A.** Vezetői összefoglaló (max. 10 sor): felkészültség külön Bing/Copilotra és ChatGPT-re, a 3 legnagyobb lehetőség.
- **B.** Részletes audit témakörönként, bizonyítékokkal és a korlátokkal; ChatGPT-specifikus alpont.
- **C.** Fejlesztési backlog: # · Cím · Kategória · Érintett felület · Jelenlegi állapot · Javasolt változtatás · Megvalósítás · Várható előny · Prioritás · Ráfordítás (S/M/L + indok) · Ellenőrzés.
- **D.** Kódminták (JSON-LD, robots.txt-változatok az OpenAI-robotokra, IndexNow, header, WAF-engedélyezőlista) – szemléltető jelöléssel.
- **E.** Mérési terv: Bing Webmaster Tools (AI Performance), szervernapló botonként IP-ellenőrzéssel, analitika (utm_source=chatgpt.com, referrer, alulmérés okai), negyedéves kérdésteszt.
- **F.** 5–8 üzletileg bemutatható csomag, garanciaígéret nélkül; a ChatGPT-fókuszú csomag megnevezve.
