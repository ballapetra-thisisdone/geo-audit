import { TOPICS, type BacklogItem, type BacklogTemplate, type CheckDef, type Finding, type Priority, type Round, type Scores, type Status, type Surface, type TopicId } from '../shared/types.ts';

const POINTS: Partial<Record<Status, number>> = { pass: 1, warn: 0.5, fail: 0 };

export const effective = (f?: Finding): Status => f?.override?.status ?? f?.status ?? 'unverifiable';

export function activeChecks(round: Round): CheckDef[] {
  return round.checks.filter((c) => c.enabled && (c.module === 'core' || round.input.modules.includes(c.module)));
}

interface Item {
  topic: TopicId;
  surfaces: Surface[];
  weight: number;
  status: Status;
}

function items(round: Round): Item[] {
  return [
    ...activeChecks(round).map((c) => ({ topic: c.topic, surfaces: c.surfaces, weight: c.weight, status: effective(round.findings[c.id]) })),
    ...round.custom.map((c) => ({ topic: c.topic, surfaces: c.surfaces, weight: c.weight, status: effective(c) })),
  ];
}

function score(list: Item[]) {
  const applicable = list.filter((i) => i.status !== 'na' && i.status !== 'info');
  const scored = applicable.filter((i) => POINTS[i.status] !== undefined);
  const w = scored.reduce((s, i) => s + i.weight, 0);
  const total = applicable.reduce((s, i) => s + i.weight, 0);
  return {
    score: w ? Math.round((scored.reduce((s, i) => s + i.weight * POINTS[i.status]!, 0) / w) * 100) : null,
    coverage: total ? Math.round((w / total) * 100) : 0,
  };
}

export function computeScores(round: Round): Scores {
  const all = items(round);
  const counts = { pass: 0, warn: 0, fail: 0, info: 0, na: 0, unverifiable: 0 } as Record<Status, number>;
  all.forEach((i) => counts[i.status]++);
  return {
    overall: score(all.filter((i) => !(i.surfaces.length === 1 && i.surfaces[0] === 'other'))).score,
    surfaces: {
      bing: score(all.filter((i) => i.surfaces.includes('bing'))),
      chatgpt: score(all.filter((i) => i.surfaces.includes('chatgpt'))),
    },
    topics: TOPICS.map((t) => ({ topic: t.id, ...score(all.filter((i) => i.topic === t.id)) })),
    counts,
  };
}

const PRIO: Priority[] = ['kritikus', 'magas', 'közepes', 'alacsony'];

export function buildBacklog(round: Round): BacklogItem[] {
  const out: Omit<BacklogItem, 'n'>[] = [];
  for (const c of activeChecks(round)) {
    const f = round.findings[c.id];
    const st = effective(f);
    const ovb = f?.override?.backlog;
    if (ovb === null || (st !== 'fail' && st !== 'warn')) continue;
    const tpl = { ...(c.backlog ?? {}), ...(ovb ?? {}) } as BacklogTemplate;
    if (!tpl.title || !tpl.priority || !tpl.effort) continue;
    // Figyelmeztetésnél egy szinttel lejjebb sorolunk (kivéve, ha a szakértő maga adta meg a prioritást).
    const prio = ovb?.priority ?? (st === 'warn' ? PRIO[Math.min(PRIO.indexOf(tpl.priority) + 1, 3)] : tpl.priority);
    out.push({
      ...tpl,
      priority: prio,
      checkId: c.id,
      surfaces: c.surfaces,
      current: f?.override?.note ? `${f.override.note}` : (f?.summary ?? ''),
      status: st,
    });
  }
  for (const c of round.custom) {
    const st = effective(c);
    if (!c.backlog || (st !== 'fail' && st !== 'warn')) continue;
    out.push({ ...c.backlog, checkId: c.checkId, surfaces: c.surfaces, current: c.summary, status: st });
  }
  out.sort((a, b) => PRIO.indexOf(a.priority) - PRIO.indexOf(b.priority) || (a.status === 'fail' ? -1 : 1) - (b.status === 'fail' ? -1 : 1));
  return out.map((x, i) => ({ ...x, n: i + 1 }));
}
