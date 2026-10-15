// Ellenőrzések futtatása egy körön – tiszta függvény, tárolótól független (app és CLI is ezt használja).
import type { Artifacts, AuditInput, BotDef, Finding, Question, QuestionTemplate, Round } from '../../shared/types.ts';
import type { Bodies } from '../collect/collect.ts';
import { buildContext } from './context.ts';
import { runners } from './runners.ts';
import { activeChecks } from '../scoring.ts';

export function runChecks(round: Round, a: Artifacts, bodies: Bodies, bots: BotDef[], only?: string) {
  const ctx = buildContext(round.input, a, bodies, bots, round.questions);
  for (const c of activeChecks(round)) {
    if (only && c.id !== only) continue;
    const prev = round.findings[c.id];
    const ranAt = new Date().toISOString();
    let f: Finding;
    if (c.runner === 'auto' && c.impl && runners[c.impl]) {
      try {
        f = { checkId: c.id, ranAt, ...runners[c.impl](ctx) };
      } catch (e) {
        f = { checkId: c.id, ranAt, status: 'unverifiable', evidence: 'unverifiable', summary: `A futtató hibát dobott: ${(e as Error).message}` };
      }
    } else if (c.runner === 'auto') {
      f = { checkId: c.id, ranAt, status: 'unverifiable', evidence: 'unverifiable', summary: `Nincs „${c.impl}” nevű futtató a kódban.` };
    } else if (c.runner === 'llm') {
      f = { checkId: c.id, ranAt, status: 'unverifiable', evidence: 'unverifiable', summary: 'Szakértői/AI-értékelést igényel.' };
    } else {
      f = prev ?? { checkId: c.id, ranAt, status: 'unverifiable', evidence: 'unverifiable', summary: 'Kézi ellenőrzés – még nincs rögzítve.' };
    }
    // A kézi felülírás megmarad újrafuttatáskor is.
    if (prev?.override) f.override = prev.override;
    round.findings[c.id] = f;
  }
}

/** Kérdéslista a sablonokból; csak a bemenetből ismert értékeket helyettesítjük be, a többi [helyőrző] marad. */
export function seedQuestions(templates: QuestionTemplate[], input: AuditInput): Question[] {
  const fill = (s: string) =>
    s
      .replaceAll('[entitás]', input.name || '[entitás]')
      .replaceAll('[szervezet]', input.org || '[szervezet]')
      .replaceAll('[szolgáltatás/termék]', input.entityType || '[szolgáltatás/termék]')
      .replaceAll('[kategória]', input.entityType || '[kategória]');
  return templates.map((x, i) => ({ id: `q${i + 1}`, kind: x.kind, text: fill(x.text), coverage: 'unknown', results: [], origin: 'template' }));
}
