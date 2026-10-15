// Kézi teendők: amit sem a gépi ellenőrzés, sem AI API nem tud elvégezni.
// Minden feladat egy vagy több ellenőrzéshez kötődik; az eredményt ott rögzíted.

export interface ManualTask {
  id: string;
  title: string;
  why: string;
  who: string;
  access: string;
  time: string;
  steps: string[];
  record: string;
  /** Ellenőrzés(ek), amelyekbe az eredmény kerül. */
  checks: string[];
  /** Ha a feladat a Kérdések fülön rögzíthető. */
  questionsTab?: boolean;
  /** Csak akkor releváns, ha ez az ellenőrzés nem "pass". */
  onlyIf?: string;
}

export const MANUAL_TASKS: ManualTask[] = [
  {
    id: 'chatgpt-test',
    title: 'ChatGPT-kérdésteszt',
    why: 'Megmutatja, hogy a ChatGPT ma forrásként használja-e az oldalt, és pontos tényt idéz-e belőle. Az API nem azonos a ChatGPT keresésével, ezért ezt csak a felületen lehet lefuttatni.',
    who: 'Auditor (DONE)',
    access: 'Nincs szükség hozzáférésre – egy böngésző elég.',
    time: '30–45 perc 15–20 kérdésre',
    steps: [
      'Véglegesítsd a kérdéslistát – ugyanez lesz a negyedéves teszt listája is.',
      'Nyiss egy privát/inkognitó ablakot, és menj a chatgpt.com oldalra kijelentkezve, vagy egy tiszta, előzmények nélküli fiókkal.',
      'Kapcsold be a keresést (Search), hogy a válasz webes forrásokra épüljön.',
      'Tedd fel egyenként a kérdéseket, minden kérdést új beszélgetésben – a lenti „Beilleszthető promptok” közül másold, változtatás nélkül.',
      'Minden válasznál nézd meg a forráslistát: szerepel-e az oldal (vagy a domain bármely aloldala)? Ha kell, illeszd be a forráskérő követő promptot.',
      'Ha szerepel: jegyezd fel az idézett URL-t és tényt, és vesd össze az oldallal – pontos, elavult vagy hibás?',
      'Ha hibás vagy elavult tényt idéz, keresd meg a forrását (régi PDF, harmadik féltől származó oldal), és írd a megjegyzésbe.',
      'Készíts képernyőképet a fontosabb válaszokról (dátummal) – az ügyfélnek ez a legmeggyőzőbb bizonyíték.',
      'Végül futtasd egyszer az URL-olvasási tesztet: ez mutatja meg, mit lát a ChatGPT, ha egy felhasználó beilleszti a linket.',
    ],
    record: 'Kérdések és AI-teszt fül → kérdésre kattintva „+ ChatGPT-eredmény”. A „ChatGPT kézi kérdésteszt” ellenőrzés automatikusan kiértékelődik.',
    checks: ['test.chatgpt'],
    questionsTab: true,
  },
  {
    id: 'copilot-test',
    title: 'Copilot-kérdésteszt',
    why: 'Ugyanaz a kérdéslista a Microsoft Copilotban: a két felület forrásai gyakran eltérnek, és a Copilot a Bing indexére épül.',
    who: 'Auditor (DONE)',
    access: 'Nincs szükség hozzáférésre.',
    time: '30–45 perc',
    steps: [
      'Nyisd meg a copilot.microsoft.com oldalt privát ablakban.',
      'Tedd fel ugyanazokat a kérdéseket (a lenti promptokból másolva), ugyanabban a sorrendben, kérdésenként új beszélgetésben.',
      'Rögzítsd: megjelent-e az oldal forrásként, melyik URL, milyen tényt idéz, pontos-e.',
      'Vesd össze a ChatGPT forrásaival: ha az egyik felületen megjelenik, a másikon nem, az irányt mutat (pl. Bing-indexelési vagy robots.txt-kérdés).',
    ],
    record: 'Kérdések és AI-teszt fül → „+ Copilot-eredmény”.',
    checks: ['test.copilot'],
    questionsTab: true,
  },
  {
    id: 'bwt',
    title: 'Bing Webmaster Tools áttekintése',
    why: 'Csak itt látszik közvetlenül, hogy a Bing indexelte-e az oldalt, milyen hibákat talált, és hogy a Copilot idézi-e (AI Performance riport).',
    who: 'Ügyfél adja a hozzáférést, auditor nézi át',
    access: 'Olvasási jog a webhely Bing Webmaster Tools fiókjához (az ügyfél felhasználóként hozzáadhat). Ha nincs fiók: képernyőképek kérése, vagy a fiók létrehozása az ügyféllel közösen.',
    time: '30–60 perc (hozzáférés után)',
    steps: [
      'Kérd meg az ügyfelet, hogy adjon hozzá olvasási joggal (Settings → User management), vagy küldjön képernyőképet az alábbiakról.',
      'Ellenőrizd, hogy a webhely hitelesített-e, és be van-e küldve a sitemap (Sitemaps: státusz, feldolgozott URL-ek száma, utolsó olvasás).',
      'URL Inspection: írd be a vizsgált URL-t – indexelt-e, mikor járt ott utoljára a bingbot, van-e figyelmeztetés.',
      'Nézd meg a crawl-hibákat és a robots.txt-tesztelőt a vizsgált útvonalra.',
      'IndexNow: van-e beküldés, és mikor volt az utolsó.',
      'AI Performance: hányszor idézte a Copilot az oldalt, és milyen kérdésekre (grounding query-k). Mentsd el kiindulási értéknek.',
      'Search Performance: megjelenések és kattintások a fő kérdésekre.',
    ],
    record: 'A „Bing Webmaster Tools” és az „IndexNow” ellenőrzésnél „Kézi felülírás”, indoklással. Konkrét hibához (pl. nincs indexelve) vegyél fel saját megállapítást az 1. témakörben.',
    checks: ['crawl.bwt', 'crawl.indexnow'],
  },
  {
    id: 'logs',
    title: 'Szervernapló elemzése',
    why: 'A naplóból derül ki, hogy a valódi robotok (nem csak a mi UA-hamisított lekérésünk) tényleg elérik-e az oldalt, és milyen státuszt kapnak.',
    who: 'Ügyfél vagy tárhelyszolgáltató adja, auditor elemzi',
    access: 'Az elmúlt 30 nap access logja (cPanel / Plesk „Raw Access Logs”, vagy kérés a tárhelyszolgáltatótól / üzemeltetőtől). Ha CDN van előtte (pl. Cloudflare), annak a naplója is kell.',
    time: '1–2 óra',
    steps: [
      'Kérd el a 30 napos access logot (személyes adatot tartalmazhat – csak biztonságos csatornán, és az elemzés után töröld).',
      'Szűrj UA-ra külön: bingbot, OAI-SearchBot, GPTBot, ChatGPT-User (minta a Mérési tervben).',
      'Botonként nézd meg: hány kérés, milyen státuszkódok (200 / 301 / 403 / 429 / 5xx), mely URL-eket kérik.',
      'Ellenőrizd az IP-ket: OpenAI-nál a searchbot.json / gptbot.json / chatgpt-user.json listák alapján, a bingbotnál fordított DNS-sel (*.search.msn.com). A nem egyező IP hamis bot.',
      'Ha a valódi botok 403-at vagy 429-et kapnak, az WAF- vagy rate limit-probléma → lásd a következő feladatot.',
    ],
    record: 'A „Szervernapló: bot-kérések” ellenőrzésnél „Eredmény rögzítése”, a számokkal az indoklásban.',
    checks: ['test.logs'],
  },
  {
    id: 'waf',
    title: 'CDN / WAF / botvédelem beállításai',
    why: 'A WAF IP alapján is dönthet, ezért a mi UA-teszünk lehet „rendben”, miközben a valódi bingbot vagy OAI-SearchBot blokkot kap. Ez csak a beállításokból vagy a WAF-eseménynaplóból látszik.',
    who: 'Az üzemeltető / aki a CDN-fiókot kezeli',
    access: 'Hozzáférés a CDN/WAF fiókhoz (pl. Cloudflare), vagy egy rövid egyeztetés az üzemeltetővel.',
    time: '30 perc egyeztetés',
    steps: [
      'Tisztázd, ki kezeli a CDN/WAF-ot (a Bot-mátrix és a „CDN / WAF / botvédelem” ellenőrzés mutatja, mit ismertünk fel).',
      'Nézd meg a botvédelmi beállításokat: van-e AI-botokat blokkoló kapcsoló, „bot fight” mód, kihívás (challenge) ismeretlen botoknak. (A menüpontok neve szolgáltatónként és időben változik.)',
      'A WAF-eseménynaplóban szűrj az elmúlt 30 napra a bingbot, OAI-SearchBot és ChatGPT-User UA-ra: volt-e blokk vagy challenge?',
      'Ha igen: javasold az engedélyezőlistát (a Kódminták között van minta az OpenAI IP-JSON-ok alapján, a bingbotot fordított DNS-sel).',
      'Rögzítsd az üzleti döntést is: a GPTBot (modelltanítás) engedélyezése nem feltétele a ChatGPT search-láthatóságnak.',
    ],
    record: 'A „CDN / WAF / botvédelem” ellenőrzésnél „Kézi felülírás” (pl. „Megfigyelt: Cloudflare AI-bot blokk bekapcsolva”), vagy saját megállapítás az 5. témakörben.',
    checks: ['bots.waf'],
  },
];

export const ACCESS_REQUEST = (site: string, org: string) => `Tárgy: Hozzáférés az AI-láthatósági audithoz – ${site}

Kedves ${org || '[Ügyfél]'}!

Az AI-láthatósági (Bing/Copilot és ChatGPT) audit egy részét kívülről nem tudjuk ellenőrizni. Ehhez a következőkre lenne szükségünk:

1. Bing Webmaster Tools – olvasási jogú hozzáférés a webhelyhez (Settings → User management), vagy ha nincs fiók, jelezzétek, és segítünk létrehozni.
2. Szervernapló – az elmúlt 30 nap access logja (tárhely-adminisztrációs felületről vagy a tárhelyszolgáltatótól). Biztonságos csatornán kérjük, az elemzés után töröljük.
3. CDN / tűzfal – ki kezeli a CDN-t vagy a webes tűzfalat (pl. Cloudflare)? Egy rövid egyeztetés elég, vagy olvasási hozzáférés.
4. IndexNow – tudtok-e róla, hogy be van-e kapcsolva (pl. SEO-bővítményben)?
5. Gyakori kérdések – mit kérdeznek tőletek leggyakrabban az érdeklődők? (5–10 kérdés, ahogy szó szerint elhangzik.)
6. Kulcsadatok forrása – ki felel az árak, dátumok, feltételek pontosságáért, és van-e róluk aktuális, hiteles dokumentum?

Köszönjük!`;
