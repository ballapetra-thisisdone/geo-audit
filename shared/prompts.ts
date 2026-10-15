// Beilleszthető promptok a kézi ChatGPT- / Copilot-teszthez.
import type { AuditInput } from './types.ts';

export const hasPlaceholder = (s: string) => /\[[^\]]+\]/.test(s);

export const SOURCES_FOLLOWUP =
  'Milyen forrásokból dolgoztál az előző válaszban? Sorold fel mindet pontos URL-lel, és mindegyik mellé írd oda, melyik állítást vetted belőle. Ha valamit nem forrásból, hanem saját tudásból írtál, azt külön jelöld.';

export function urlReadPrompt(input: AuditInput) {
  const labels = input.keyData.map((k) => k.label).filter(Boolean);
  const list = labels.length ? labels.map((l) => `- ${l}`).join('\n') : '- [kulcsadatok – add meg őket az audit bemenetében]';
  return `Nyisd meg és olvasd el ezt az oldalt: ${input.url}

Csak az oldalon ténylegesen szereplő információ alapján válaszolj, más forrást ne használj. Sorold fel pontosan, ahogy az oldalon szerepel:
${list}
- Ki üzemelteti az oldalt (cégnév)?
- Van-e az oldalon dátum, amikor az adatokat utoljára frissítették?

Ha valamelyiket nem találod az oldalon, írd mellé: „nem található”. Ha az oldalt nem tudod megnyitni, azt írd meg, és ne találgass.`;
}
