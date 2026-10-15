import { useState } from 'react';
import { api } from '../../api';
import { ChipSelect, CodeBlock, EvidenceTag, fmtDate, Sources, StatusBadge, SurfaceTags, toast } from '../../components/ui';
import { EVIDENCE_LABEL, STATUS_LABEL, TOPICS, type CheckDef, type CustomFinding, type Evidence, type Finding, type Status, type Surface, type TopicId } from '../../../../shared/types';
import type { TabProps } from '../AuditView';
import { Legend } from '../../components/Legend';
import { effective } from '../../lib';

const ALL: Status[] = ['fail', 'warn', 'pass', 'info', 'unverifiable', 'na'];

function OverrideForm({ initial, onSave, onCancel }: { initial?: Finding['override']; onSave: (o: { status: Status; evidence: Evidence; note: string }) => void; onCancel: () => void }) {
  const [status, setStatus] = useState<Status>(initial?.status ?? 'warn');
  const [evidence, setEvidence] = useState<Evidence>(initial?.evidence ?? 'observed');
  const [note, setNote] = useState(initial?.note ?? '');
  return (
    <div className="card stack" style={{ background: 'var(--gray)' }}>
      <div className="grid cols-2">
        <label className="field">
          <span>Státusz</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {ALL.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Bizonyíték</span>
          <select value={evidence} onChange={(e) => setEvidence(e.target.value as Evidence)}>
            {(Object.keys(EVIDENCE_LABEL) as Evidence[]).map((s) => (
              <option key={s} value={s}>
                {EVIDENCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Megállapítás / indoklás</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mit láttál, honnan tudod? (Ez kerül a backlog „Jelenlegi állapot” oszlopába.)" />
      </label>
      <div className="row">
        <button className="btn primary sm" onClick={() => onSave({ status, evidence, note })}>
          Mentés
        </button>
        <button className="btn sm ghost" onClick={onCancel}>
          Mégse
        </button>
      </div>
    </div>
  );
}

export function FindingCard({ check, finding, tab, defaultOpen }: { check: CheckDef; finding?: Finding; tab: TabProps; defaultOpen?: boolean }) {
  const st = effective(finding);
  const [open, setOpen] = useState(defaultOpen ?? (st === 'fail' || st === 'warn'));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const { id, round, setRound } = tab;
  const ev: Evidence = finding?.override?.evidence ?? finding?.evidence ?? 'unverifiable';

  const act = async (fn: () => Promise<typeof round>) => {
    setBusy(true);
    try {
      setRound(await fn());
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="finding">
      <div className="head" onClick={() => setOpen(!open)}>
        <StatusBadge s={st} />
        <div className="t">
          <b>
            {check.title} {check.experimental && <span className="tag orange">kísérleti</span>} {check.runner === 'manual' && <span className="tag outline">kézi</span>}
          </b>
          <span className="s">{finding?.override?.note || finding?.summary || 'Nincs eredmény.'}</span>
        </div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <EvidenceTag e={ev} />
          <SurfaceTags surfaces={check.surfaces} />
          <span className="muted small">{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div className="body">
          <p className="small muted" style={{ marginTop: 0 }}>
            {check.description}
          </p>
          {check.howTo && (
            <p className="small">
              <b>Hogyan ellenőrizd:</b> {check.howTo}
            </p>
          )}
          {finding?.override && (
            <div className="overridden small">
              <b>Kézi értékelés</b> ({fmtDate(finding.override.at)}): {STATUS_LABEL[finding.override.status]} · {EVIDENCE_LABEL[finding.override.evidence]}
              {finding.override.note && <div>{finding.override.note}</div>}
              {check.runner === 'auto' && <div className="muted">Gépi eredmény: {STATUS_LABEL[finding.status]} – {finding.summary}</div>}
            </div>
          )}
          {finding?.details?.length ? (
            <ul className="details small">
              {finding.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
          {finding?.snippets?.map((s, i) => (
            <details key={i} style={{ marginBottom: 8 }}>
              <summary className="small">{s.label}</summary>
              <CodeBlock snippet={s} />
            </details>
          ))}
          <Sources sources={check.sources} />
          {editing ? (
            <OverrideForm
              initial={finding?.override}
              onCancel={() => setEditing(false)}
              onSave={(o) => {
                setEditing(false);
                void act(() => api.override(id, round.n, check.id, o));
              }}
            />
          ) : (
            <div className="row no-print" style={{ marginTop: 10 }}>
              <button className="btn sm" disabled={busy} onClick={() => setEditing(true)}>
                {check.runner === 'manual' ? 'Eredmény rögzítése' : 'Kézi felülírás'}
              </button>
              {finding?.override && (
                <button className="btn sm ghost" disabled={busy} onClick={() => void act(() => api.clearOverride(id, round.n, check.id))}>
                  Felülírás törlése
                </button>
              )}
              {check.runner === 'auto' && (
                <button className="btn sm ghost" disabled={busy} onClick={() => void act(() => api.rerun(id, round.n, { checkId: check.id }))}>
                  {busy ? <span className="spinner" /> : '↻'} Újrafuttatás
                </button>
              )}
              <span className="small muted">
                {check.id} · v{check.version} · súly {check.weight}
                {finding?.ranAt ? ` · ${fmtDate(finding.ranAt)}` : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CustomForm({ topic, onSave, onCancel }: { topic: TopicId; onSave: (c: CustomFinding) => void; onCancel: () => void }) {
  const [c, setC] = useState<CustomFinding>({
    checkId: '',
    title: '',
    topic,
    surfaces: ['bing', 'chatgpt'],
    weight: 2,
    status: 'warn',
    evidence: 'observed',
    summary: '',
    ranAt: '',
  });
  return (
    <div className="card stack" style={{ background: 'var(--gray)', margin: 16 }}>
      <label className="field">
        <span>Cím</span>
        <input type="text" value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} />
      </label>
      <label className="field">
        <span>Megállapítás</span>
        <textarea value={c.summary} onChange={(e) => setC({ ...c, summary: e.target.value })} />
      </label>
      <div className="grid cols-4">
        <label className="field">
          <span>Státusz</span>
          <select value={c.status} onChange={(e) => setC({ ...c, status: e.target.value as Status })}>
            {ALL.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Bizonyíték</span>
          <select value={c.evidence} onChange={(e) => setC({ ...c, evidence: e.target.value as Evidence })}>
            {(Object.keys(EVIDENCE_LABEL) as Evidence[]).map((s) => (
              <option key={s} value={s}>
                {EVIDENCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Súly (0–5)</span>
          <input type="number" min={0} max={5} value={c.weight} onChange={(e) => setC({ ...c, weight: Number(e.target.value) })} />
        </label>
        <div className="field">
          <span>Felület</span>
          <ChipSelect<Surface>
            options={[
              { v: 'bing', l: 'Bing' },
              { v: 'chatgpt', l: 'ChatGPT' },
              { v: 'other', l: 'Egyéb' },
            ]}
            value={c.surfaces}
            onChange={(v) => setC({ ...c, surfaces: v })}
          />
        </div>
      </div>
      <div className="row">
        <button className="btn primary sm" disabled={!c.title.trim()} onClick={() => onSave(c)}>
          Hozzáadás
        </button>
        <button className="btn sm ghost" onClick={onCancel}>
          Mégse
        </button>
      </div>
    </div>
  );
}

export function Details(tab: TabProps) {
  const { round, checks, id, setRound } = tab;
  const [filter, setFilter] = useState<Status[]>([]);
  const [adding, setAdding] = useState<TopicId | null>(null);
  const active = round.checks.filter((c) => c.enabled && (c.module === 'core' || round.input.modules.includes(c.module)));
  const pass = (s: Status) => !filter.length || filter.includes(s);

  const saveCustom = async (list: CustomFinding[]) => {
    try {
      setRound(await api.saveCustom(id, round.n, list));
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Legend sections={['status', 'evidence', 'surface']} title="Mit jelentenek a címkék?" />
      <div className="row between no-print">
        <ChipSelect<Status> options={ALL.map((s) => ({ v: s, l: STATUS_LABEL[s] }))} value={filter} onChange={setFilter} />
        <span className="small muted">Kattints egy tételre a bizonyítékokért. Minden tétel újrafuttatható vagy kézzel felülírható.</span>
      </div>
      {TOPICS.map((t) => {
        const list = active.filter((c) => c.topic === t.id && pass(effective(round.findings[c.id])));
        const custom = round.custom.filter((c) => c.topic === t.id && pass(effective(c)));
        const general = list.filter((c) => !(c.surfaces.length === 1 && c.surfaces[0] === 'chatgpt'));
        const gpt = list.filter((c) => c.surfaces.length === 1 && c.surfaces[0] === 'chatgpt');
        const ts = round.scores?.topics.find((x) => x.topic === t.id);
        if (!list.length && !custom.length && filter.length) return null;
        return (
          <div key={t.id} className="card flat">
            <div className="row between" style={{ padding: '16px 20px', borderBottom: '1px solid var(--ultra)' }}>
              <div>
                <p className="label">{t.n}. témakör</p>
                <h2 style={{ margin: 0 }}>{t.title}</h2>
              </div>
              <div className="row">
                <span className="small muted">
                  {ts?.score ?? '—'}/100 · lefedettség {ts?.coverage ?? 0}%
                </span>
                <button className="btn sm no-print" onClick={() => setAdding(adding === t.id ? null : t.id)}>
                  + Saját megállapítás
                </button>
              </div>
            </div>
            {adding === t.id && (
              <CustomForm
                topic={t.id}
                onCancel={() => setAdding(null)}
                onSave={(c) => {
                  setAdding(null);
                  void saveCustom([...round.custom, c]);
                }}
              />
            )}
            {general.map((c) => (
              <FindingCard key={c.id} check={c} finding={round.findings[c.id]} tab={tab} />
            ))}
            {gpt.length > 0 && (
              <>
                <div style={{ padding: '10px 20px', background: 'var(--gray)', borderTop: '1px solid var(--ultra)' }}>
                  <b className="small">ChatGPT-specifikus megállapítások</b>
                </div>
                {gpt.map((c) => (
                  <FindingCard key={c.id} check={c} finding={round.findings[c.id]} tab={tab} />
                ))}
              </>
            )}
            {custom.map((c) => (
              <div key={c.checkId} className="finding">
                <div className="head">
                  <StatusBadge s={effective(c)} />
                  <div className="t">
                    <b>
                      {c.title} <span className="tag outline">saját</span>
                    </b>
                    <span className="s">{c.summary}</span>
                  </div>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <EvidenceTag e={c.evidence} />
                    <SurfaceTags surfaces={c.surfaces} />
                    <button
                      className="btn sm ghost no-print"
                      onClick={() => {
                        if (confirm('Törlöd ezt a megállapítást?')) void saveCustom(round.custom.filter((x) => x.checkId !== c.checkId));
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {!list.length && !custom.length && <p className="small muted" style={{ padding: '12px 20px' }}>Nincs aktív ellenőrzés ebben a témakörben.</p>}
          </div>
        );
      })}
      {Object.keys(checks).length === 0 && <div className="empty">Nincs ellenőrzés.</div>}
    </div>
  );
}
