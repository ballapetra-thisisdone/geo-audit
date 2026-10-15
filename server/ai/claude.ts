// Claude API integráció (2. fázis). Kulcs nélkül kikapcsol, a gépi ellenőrzések attól még működnek.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../env.ts';
import type { AuditInput, PageFacts, Question } from '../../shared/types.ts';

export const ai = {
  enabled: () => !!env.anthropicKey,
  model: () => env.claudeModel,
};

let client: Anthropic | undefined;
function getClient() {
  if (!ai.enabled()) throw new Error('Nincs ANTHROPIC_API_KEY beállítva (.env).');
  client ??= new Anthropic({ apiKey: env.anthropicKey });
  return client;
}

const QuestionsSchema = z.object({
  questions: z.array(
    z.object({
      kind: z.enum(['search', 'conversational']),
      text: z.string(),
      coverage: z.enum(['yes', 'partial', 'no']),
      fact: z.string().describe('Az oldalon szó szerint szereplő tény, amely megválaszolja; üres, ha nincs.'),
      missing: z.string().describe('Mi hiányzik a válaszhoz; üres, ha semmi.'),
      sourceOwner: z.string().describe('Ki adhatja meg a hiányzó adatot (ügyfél, hatóság…); üres, ha nem releváns.'),
    }),
  ),
});

const JSON_SCHEMA = z.toJSONSchema(QuestionsSchema);

/**
 * 10–15 keresési és 5–8 társalgási kérdés generálása és értékelése az oldal szövege alapján.
 * Csak az oldalon igazolható tényre hivatkozhat.
 */
export async function suggestQuestions(input: AuditInput, facts: PageFacts): Promise<Question[]> {
  const c = getClient();
  const page = facts.text.slice(0, 60000);
  const prompt = [
    `Vizsgált oldal: ${input.name} (${input.org}) – ${input.pageType}. URL: ${input.url}`,
    `Fő entitás: ${input.entityType}. Nyelvek: ${input.languages.join(', ')}.`,
    `Kulcsadatok: ${input.keyData.map((k) => k.label).join(', ')}.`,
    '',
    'Feladat: írj 10–15 valószínű keresési vagy AI-kérdést (kind=search) és 5–8 hosszabb, összehasonlító, többfeltételes ChatGPT-stílusú kérdést (kind=conversational) az oldal nyelvén, a célközönség szemszögéből.',
    'Mindegyiknél értékeld, hogy az alábbi oldalszöveg tartalmaz-e egyértelmű, egy bekezdésből kiemelhető, lehetőleg dátummal ellátott tényt (coverage: yes/partial/no).',
    'A "fact" mezőbe csak olyan szöveget írj, ami az oldalon szerepel. Ne találj ki árat, dátumot, értékelést. Versenytársakról ne írj kérdést.',
    '',
    '<oldal_szoveg>',
    page,
    '</oldal_szoveg>',
  ].join('\n');

  // Szerveroldali fallback: biztonsági elutasításnál a platform másik modellre irányít ("default" mód).
  const res = await c.beta.messages.create({
    model: ai.model(),
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: JSON_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);

  if (res.stop_reason === 'refusal') throw new Error('A modell elutasította a kérést.');
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const parsed = QuestionsSchema.parse(JSON.parse(text));
  return parsed.questions.map((q, i) => ({
    id: `ai-${Date.now().toString(36)}-${i}`,
    kind: q.kind,
    text: q.text,
    coverage: q.coverage,
    fact: q.fact || undefined,
    missing: q.missing || undefined,
    sourceOwner: q.sourceOwner || undefined,
    results: [],
    origin: 'llm' as const,
  }));
}
