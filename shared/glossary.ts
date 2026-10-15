// Ügyfélnek is érthető magyarázatok az audit jelöléseihez. Egy helyen, hogy a szöveg mindenhol egységes legyen.
import type { BacklogCategory, Effort, Evidence, Owner, Priority, Status } from './types.ts';

export const PRIORITY: Record<Priority, { short: string; text: string }> = {
  kritikus: {
    short: 'Azonnal',
    text: 'Amíg nincs javítva, az oldal nem vagy csak hibásan jelenhet meg a Bingben, a Copilotban vagy a ChatGPT-ben (pl. a robot nem éri el az oldalt).',
  },
  magas: {
    short: 'A következő fejlesztési körben',
    text: 'Jelentősen javítja, hogy az AI-rendszerek pontosan megértsék és forrásként idézzék az oldalt.',
  },
  közepes: {
    short: 'Tervezetten',
    text: 'Érezhető javulást hoz, de a megjelenést nem akadályozza. Érdemes a következő hónapok fejlesztései közé beütemezni.',
  },
  alacsony: {
    short: 'Ha van rá kapacitás',
    text: 'Finomhangolás: kis hatású, vagy csak bizonyos helyzetekben számít.',
  },
};

export const EFFORT: Record<Effort, { short: string; text: string }> = {
  S: { short: 'kis munka (≤ 1 nap)', text: 'Néhány óra, legfeljebb egy nap: beállítás, egy-két sor kód vagy szöveg.' },
  M: { short: 'közepes munka (2–5 nap)', text: 'Sablon- vagy tartalommódosítás, több oldalt érint, tesztelni kell.' },
  L: { short: 'nagy munka (5+ nap)', text: 'Külön tervezést igényel, pl. az oldal megjelenítésének technikai átalakítása.' },
};

export const STATUS_TEXT: Record<Status, string> = {
  pass: 'Megfelel, nincs teendő.',
  warn: 'Működik, de javítható. Nem akadályozza a megjelenést, csak gyengíti.',
  fail: 'Hiányzik vagy rosszul működik, javítani kell.',
  info: 'Tájékoztatás, nem jó vagy rossz. Gyakran üzleti döntés (pl. engedjük-e a modelltanító robotokat).',
  na: 'Erre az oldalra nem vonatkozik.',
  unverifiable: 'Kívülről nem látható. Hozzáférés vagy ügyféladat kell hozzá. A pontszámba nem számít bele.',
};

export const EVIDENCE_TEXT: Record<Evidence, string> = {
  observed: 'Közvetlenül mértük, a bizonyítékot csatoltuk.',
  likely: 'Erős jelekből következik, de közvetlenül nem mérhető.',
  hypothesis: 'Feltételezés. Döntés előtt érdemes ellenőrizni.',
  unverifiable: 'Nem tudtuk ellenőrizni. Hozzáférés kell hozzá (pl. Bing Webmaster Tools, szervernapló).',
};

export const OWNER_TEXT: Record<Owner, string> = {
  fejlesztő: 'A weboldal fejlesztője vagy üzemeltetője végzi.',
  ügyfél: 'Az ügyfél adja az információt vagy a döntést (pl. árak, feltételek, szövegek).',
  mindkettő: 'Közös munka: az ügyfél adja a tartalmat, a fejlesztő építi be.',
};

export const CATEGORY_TEXT: Record<BacklogCategory, string> = {
  Hibajavítás: 'Valami most rosszul működik.',
  'SEO/indexelés': 'Hogy a keresők megtalálják, és helyesen tárolják az oldalt.',
  'Strukturált adat': 'Gépi „címkék” az oldal kódjában, amelyekből a rendszerek pontosan kiolvassák pl. a nevet, az árat, a címet.',
  'AI-láthatóság': 'Közvetlenül azt befolyásolja, hogy a ChatGPT vagy a Copilot el tudja-e olvasni és idézni az oldalt.',
  'Tartalom/IA': 'Szöveg és oldalszerkezet. Az információt jellemzően az ügyfél adja.',
  Kísérleti: 'Nincs dokumentált hatása, csak megfigyelésre.',
};

export const BANDS = [
  { cls: 'good', label: 'Jó', range: '80–100', text: 'Az oldal jól felkészült, finomhangolás maradt.' },
  { cls: 'warn', label: 'Közepes', range: '60–79', text: 'Alapvetően elérhető, de több fontos hiányosság gyengíti.' },
  { cls: 'serious', label: 'Gyenge', range: '40–59', text: 'Komoly hiányosságok: az AI-rendszerek nehezen vagy pontatlanul használják az oldalt.' },
  { cls: 'critical', label: 'Kritikus', range: '0–39', text: 'Az oldal az AI-rendszerek számára gyakorlatilag láthatatlan vagy félreérthető.' },
] as const;

export const COVERAGE_TEXT =
  'A lefedettség megmutatja, hogy a vizsgált tételek hány százalékát tudtuk ténylegesen ellenőrizni. Alacsony lefedettségnél a pontszám bizonytalanabb.';

export const SURFACE_TEXT = {
  'Bing/Copilot': 'A Microsoft keresője és AI-asszisztense, valamint a Bing indexére épülő felületek.',
  ChatGPT: 'A ChatGPT keresése, az Atlas böngésző, és amikor egy felhasználó linket illeszt be a ChatGPT-be.',
  mindkettő: 'Mindkét felületre hat.',
};

export const priorityLabel = (p: Priority) => `${p} prioritás – ${PRIORITY[p].short.toLowerCase()}`;
export const effortLabel = (e: Effort) => `${e} – ${EFFORT[e].short}`;
