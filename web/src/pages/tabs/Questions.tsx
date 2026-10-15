import { Fragment, useEffect, useState } from 'react';
import { api } from '../../api';
import { toast } from '../../components/ui';
import type { Coverage, Question, QuestionResult, QuestionTemplate } from '../../../../shared/types';
import type { TabProps } from '../AuditView';
import { downloadText, toCsv } from '../../lib';

const COV: Record<Coverage, { l: string; c: string }> = {
  yes: { l: 'Igen', c: 'var(--good)' },
  partial: { l: 'Részben', c: 'var(--warning)' },
  no: { l: 'Nem', c: 'var(--critical)' },
  unknown: { l: 'Nem értékelt', c: 'var(--ultra)' },
};

const today = () => new Date().toISOString().slice(0, 10);

function ResultEditor({ r, onChange, onDelete }: { r: QuestionResult; onChange: (r: QuestionResult) => void; onDelete: () => void }) {
  return (
    <div className="grid cols-4" style={{ background: 'var(--gray)', padding: 10, borderRadius: 6, alignItems: 'end' }}>
      <label className="field">
        <span>{r.surface === 'chatgpt' ? 'ChatGPT' : 'Copilot'} · dátum</span>
        <input type="date" value={r.date} onChange={(e) => onChange({ ...r, date: e.target.value })} />
      </label>
      <label className="field">
        <span>Megjelent forrásként?</span>
        <select value={r.appears} onChange={(e) => onChange({ ...r, appears: e.target.value as QuestionResult['appears'] })}>
          <option value="yes">igen</option>
          <option value="no">nem</option>
          <option value="unknown">nem egyértelmű</option>
        </select>
      </label>
      <label className="field">
        <span>Idézett URL</span>
        <input type="text" value={r.url ?? ''} onChange={(e) => onChange({ ...r, url: e.target.value })} />
      </label>
      <label className="field">
        <span>Pontos?</span>
        <select value={r.accurate ?? 'unknown'} onChange={(e) => onChange({ ...r, accurate: e.target.value as QuestionResult['accurate'] })}>
          <option value="unknown">—</option>
          <option value="yes">igen</option>
          <option value="partial">részben</option>
          <option value="no">nem (elavult/hibás)</option>
        </select>
      </label>
      <label className="field" style={{ gridColumn: 'span 2' }}>
        <span>Idézett tény</span>
        <input type="text" value={r.quotedFact ?? ''} onChange={(e) => onChange({ ...r, quotedFact: e.target.value })} />
      </label>
      <label className="field">
        <span>Megjegyzés (pl. a hibás tény forrása)</span>
        <input type="text" value={r.note ?? ''} onChange={(e) => onChange({ ...r, note: e.target.value })} />
      </label>
      <div>
        <button className="btn sm ghost" onClick={onDelete}>
          Eredmény törlése
        </button>
      </div>
    </div>
  );
}

export function Questions({ id, round, setRound, aiEnabled }: TabProps) {
  const [qs, setQs] = useState<Question[]>(round.questions);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [templates, setTemplates] = useState<QuestionTemplate[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQs(round.questions);
    setDirty(false);
  }, [round.questions]);
  useEffect(() => {
    api.config().then((c) => setTemplates(c.templates));
  }, []);

  const update = (i: number, patch: Partial<Question>) => {
    setQs((p) => p.map((q, j) => (j === i ? { ...q, ...patch } : q)));
    setDirty(true);
  };
  const add = (q: Partial<Question>) => {
    const nq: Question = { id: `m-${Date.now().toString(36)}`, kind: 'search', text: '', coverage: 'unknown', results: [], origin: 'manual', ...q };
    setQs((p) => [...p, nq]);
    setOpen(nq.id);
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      setRound(await api.saveQuestions(id, round.n, qs));
      toast('Kérdések mentve, a lefedettség újraszámolva.');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const counts = (['yes', 'partial', 'no', 'unknown'] as Coverage[]).map((c) => ({ c, n: qs.filter((q) => q.coverage === c).length }));
  const search = qs.filter((q) => q.kind === 'search').length;
  const conv = qs.length - search;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card stack">
        <div className="row between">
          <div>
            <p className="label">Kérdés-lefedettség</p>
            <span className="small muted">
              {search} keresési (cél: 10–15) · {conv} társalgási/ChatGPT-stílusú (cél: 5–8)
            </span>
          </div>
          <div className="row no-print">
            <select
              style={{ width: 'auto' }}
              value=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                if (t) add({ kind: t.kind, text: t.text, origin: 'template' });
              }}
            >
              <option value="">+ Sablonból…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.kind === 'search' ? '[K] ' : '[T] '}
                  {t.text}
                </option>
              ))}
            </select>
            <button className="btn sm" onClick={() => add({})}>
              + Kérdés
            </button>
            <button
              className="btn sm"
              disabled={!aiEnabled || busy || dirty}
              title={aiEnabled ? (dirty ? 'Előbb mentsd a változásokat' : 'Claude javasol és értékel kérdéseket az oldal szövege alapján') : 'Ehhez ANTHROPIC_API_KEY kell a .env-ben'}
              onClick={async () => {
                setBusy(true);
                try {
                  setRound(await api.aiQuestions(id, round.n));
                  toast('AI-javaslatok hozzáadva. Ellenőrizd őket!');
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              ✦ AI-javaslat
            </button>
            <button
              className="btn sm"
              onClick={() =>
                downloadText(
                  `kerdeslista-${id}.csv`,
                  toCsv([['#', 'Típus', 'Kérdés', 'Lefedettség', 'Tény', 'Hiányzik', 'Forrás'], ...qs.map((q, i) => [i + 1, q.kind === 'search' ? 'keresési' : 'társalgási', q.text, COV[q.coverage].l, q.fact, q.missing, q.sourceOwner])]),
                  'text/csv',
                )
              }
            >
              CSV
            </button>
            <button className="btn primary sm" disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? <span className="spinner" /> : null} Mentés
            </button>
          </div>
        </div>
        <div className="bar-stack" role="img" aria-label="Kérdés-lefedettség">
          {counts.filter((x) => x.n).map((x) => (
            <div key={x.c} style={{ flex: x.n, background: COV[x.c].c }} title={`${COV[x.c].l}: ${x.n}`} />
          ))}
        </div>
        <div className="legend">
          {counts.map((x) => (
            <span key={x.c}>
              <i style={{ background: COV[x.c].c }} />
              {COV[x.c].l} {x.n}
            </span>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Kézi AI-teszt: futtasd a kérdéseket a ChatGPT-ben (keresés bekapcsolva, kijelentkezve vagy tiszta munkamenetben) és a Copilotban, majd rögzítsd az
          eredményt. Lépésről lépésre: <a href={`#/audit/${id}?tab=manual`}>Kézi teendők fül</a>. Pillanatfelvétel, nem mérés: ha az oldal nem jelenik meg,
          abból nem következik, hogy nincs indexelve.
        </p>
      </div>

      <div className="card flat">
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th>Kérdés</th>
              <th style={{ width: 120 }}>Típus</th>
              <th style={{ width: 140 }}>Megválaszolja?</th>
              <th style={{ width: 150 }}>AI-teszt</th>
            </tr>
          </thead>
          <tbody>
            {qs.map((q, i) => {
              const gpt = q.results.filter((r) => r.surface === 'chatgpt');
              const cop = q.results.filter((r) => r.surface === 'copilot');
              const isOpen = open === q.id;
              return (
                <Fragment key={q.id}>
                  <tr onClick={() => setOpen(isOpen ? null : q.id)} style={{ cursor: 'pointer' }}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      {q.text || <span className="muted">(üres)</span>} {q.origin === 'llm' && <span className="tag orange">AI</span>}
                      {q.fact && <div className="small muted">Tény: {q.fact}</div>}
                      {q.missing && <div className="small" style={{ color: '#9d2222' }}>Hiányzik: {q.missing}</div>}
                    </td>
                    <td className="small">{q.kind === 'search' ? 'keresési' : 'társalgási'}</td>
                    <td>
                      <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <i style={{ width: 10, height: 10, borderRadius: 2, background: COV[q.coverage].c, display: 'inline-block' }} />
                        {COV[q.coverage].l}
                      </span>
                    </td>
                    <td className="small">
                      ChatGPT: {gpt.length ? gpt.map((r) => (r.appears === 'yes' ? '✓' : r.appears === 'no' ? '✕' : '?')).join(' ') : '—'}
                      <br />
                      Copilot: {cop.length ? cop.map((r) => (r.appears === 'yes' ? '✓' : r.appears === 'no' ? '✕' : '?')).join(' ') : '—'}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td />
                      <td colSpan={4}>
                        <div className="stack">
                          <div className="grid cols-4">
                            <label className="field" style={{ gridColumn: 'span 2' }}>
                              <span>Kérdés</span>
                              <input type="text" value={q.text} onChange={(e) => update(i, { text: e.target.value })} />
                            </label>
                            <label className="field">
                              <span>Típus</span>
                              <select value={q.kind} onChange={(e) => update(i, { kind: e.target.value as Question['kind'] })}>
                                <option value="search">keresési</option>
                                <option value="conversational">társalgási (ChatGPT)</option>
                              </select>
                            </label>
                            <label className="field">
                              <span>Megválaszolja az oldal?</span>
                              <select value={q.coverage} onChange={(e) => update(i, { coverage: e.target.value as Coverage })}>
                                {(Object.keys(COV) as Coverage[]).map((c) => (
                                  <option key={c} value={c}>
                                    {COV[c].l}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="field" style={{ gridColumn: 'span 2' }}>
                              <span>Kiemelhető tény az oldalon (lehetőleg dátummal)</span>
                              <input type="text" value={q.fact ?? ''} onChange={(e) => update(i, { fact: e.target.value })} />
                            </label>
                            <label className="field">
                              <span>Mi hiányzik?</span>
                              <input type="text" value={q.missing ?? ''} onChange={(e) => update(i, { missing: e.target.value })} />
                            </label>
                            <label className="field">
                              <span>Ki a forrása? (ügyfél, hatóság…)</span>
                              <input type="text" value={q.sourceOwner ?? ''} onChange={(e) => update(i, { sourceOwner: e.target.value })} />
                            </label>
                          </div>
                          {q.results.map((r, ri) => (
                            <ResultEditor
                              key={ri}
                              r={r}
                              onChange={(nr) => update(i, { results: q.results.map((x, k) => (k === ri ? nr : x)) })}
                              onDelete={() => update(i, { results: q.results.filter((_, k) => k !== ri) })}
                            />
                          ))}
                          <div className="row">
                            <button className="btn sm" onClick={() => update(i, { results: [...q.results, { surface: 'chatgpt', date: today(), appears: 'unknown' }] })}>
                              + ChatGPT-eredmény
                            </button>
                            <button className="btn sm" onClick={() => update(i, { results: [...q.results, { surface: 'copilot', date: today(), appears: 'unknown' }] })}>
                              + Copilot-eredmény
                            </button>
                            <span style={{ flex: 1 }} />
                            <button
                              className="btn sm ghost"
                              onClick={() => {
                                setQs((p) => p.filter((_, j) => j !== i));
                                setDirty(true);
                              }}
                            >
                              Kérdés törlése
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {dirty && (
        <div className="notice row between no-print" style={{ position: 'sticky', bottom: 16 }}>
          <span>Mentetlen változások vannak.</span>
          <button className="btn primary sm" disabled={busy} onClick={() => void save()}>
            Mentés
          </button>
        </div>
      )}
    </div>
  );
}
