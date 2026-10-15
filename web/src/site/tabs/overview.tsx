import { useEffect, useRef, useState } from 'react';
import type { AuditDetail } from '../api';
import { siteApi } from '../api';
import { Kind, Note, ScoreBar, Stat } from '../ui';
import { EVIDENCE_KIND_LABEL } from '../../../../shared/site';
import type { Detected } from '../../../../shared/site';

function bandLabel(v: number | null) {
  if (v === null) return { l: 'Nincs elég adat', cls: 'none' };
  if (v >= 80) return { l: 'Erős', cls: 'good' };
  if (v >= 60) return { l: 'Közepes', cls: 'warn' };
  if (v >= 40) return { l: 'Gyenge', cls: 'serious' };
  return { l: 'Kritikus', cls: 'critical' };
}

export function OverviewTab({ d, go }: { d: AuditDetail; go: (t: string) => void }) {
  const s = d.score;
  const sum = d.summary;
  const ctx = d.context;
  const b = bandLabel(s?.overall ?? null);
  return (
    <div className="stack">
      <div className="grid cols-4">
        <div className="card stat">
          <p className="label">GEO Score</p>
          <div className={`stat-v band-${b.cls}`}>
            {s?.overall ?? '—'}
            <small>/100</small>
          </div>
          <div className="small"><b className={`band-${b.cls}`}>{b.l}</b>{s ? ` · bizonyosság ${Math.round(s.confidence * 100)}% · mért súlyarány ${Math.round(s.measuredWeightShare * 100)}%` : ''}</div>
        </div>
        <Stat label="Kritikus + magas" value={d.counts.p0 + d.counts.p1} sub={`P0: ${d.counts.p0} · P1: ${d.counts.p1}`} />
        <Stat label="Kérdések" value={d.counts.queries} sub="generált hipotézisek + megadott kérdések" />
        <Stat label="Fejlesztői feladat" value={d.counts.tasks} sub={`${d.counts.recommendations} konkrét javaslat`} />
      </div>
      {s && <Note>{s.note}</Note>}

      {sum && (
        <div className="card stack">
          <h2>Executive Summary</h2>
          <p><b>{sum.headline}</b></p>
          <div className="grid cols-2">
            <div>
              <h3>Legfontosabb megállapítások</h3>
              <ul className="tight">{sum.findings.map((x) => <li key={x}>{x}</li>)}</ul>
              <h3>Kritikus problémák</h3>
              <ul className="tight">{sum.critical.length ? sum.critical.map((x) => <li key={x}>{x}</li>) : <li className="muted">Nincs P0/P1 probléma.</li>}</ul>
            </div>
            <div>
              <h3>Fő erősségek</h3>
              <ul className="tight">{sum.strengths.length ? sum.strengths.map((x) => <li key={x}>{x}</li>) : <li className="muted">—</li>}</ul>
              <h3>Legjobb lehetőségek</h3>
              <ul className="tight">{sum.opportunities.length ? sum.opportunities.map((x) => <li key={x}>{x}</li>) : <li className="muted">Versenytárs-adat nélkül nincs összehasonlító lehetőség.</li>}</ul>
            </div>
          </div>
          <details>
            <summary>Mérési korlátok</summary>
            <ul className="tight small">{sum.limits.map((x) => <li key={x}>{x}</li>)}</ul>
          </details>
          <div className="row no-print">
            <button className="btn sm" onClick={() => go('issues')}>Prioritizált ajánlások →</button>
            <button className="btn sm" onClick={() => go('backlog')}>Fejlesztői backlog →</button>
          </div>
        </div>
      )}

      {s && (
        <div className="card">
          <h2>GEO Score komponensek</h2>
          <p className="small muted">Minden komponens 0–100. A nem mérhető vagy elégtelen adatú komponens nem nulla pont: kimarad a súlyozásból. Kattints egy sorra a módszerért és a bizonyítékokért.</p>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr><th>Komponens</th><th style={{ width: '38%' }}>Pont</th><th className="num">Súly</th><th>Bizonyosság</th><th>Adat</th></tr>
              </thead>
              <tbody>
                {s.components.map((c) => (
                  <ComponentRow key={c.id} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ctx && (
        <div className="card">
          <h2>Felismert üzleti kontextus</h2>
          <p className="small muted">Automatikus felismerés a crawl adataiból; a bizonyosság és a forrás minden értéknél látható.</p>
          <dl className="kv">
            <Ctx label="Nyelv" d={ctx.language} />
            <Ctx label="Szervezet / márka" d={ctx.organization} extra={ctx.brandVariants.length > 1 ? `Változatok: ${ctx.brandVariants.join(' · ')}` : undefined} />
            <Ctx label="Fő tevékenység" d={ctx.activity} />
            <Ctx label="Termékek / szolgáltatások" d={ctx.offerings} />
            <Ctx label="Célközönség" d={ctx.audience} />
            <Ctx label="Földrajzi fókusz" d={ctx.geo} />
            <Ctx label="Fő témák" d={ctx.topics} />
            <Ctx label="Szerzők / szakértők" d={ctx.people} />
            <Ctx label="Keresési szándékok" d={ctx.intents} />
          </dl>
          {ctx.clarifications.length > 0 && (
            <div className="notice" style={{ marginTop: 12 }}>
              <b>Célzott pontosítás javasolt:</b>
              <ul className="tight">{ctx.clarifications.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>Adatforrások</h2>
        <table className="t">
          <thead><tr><th>Forrás</th><th>Típus</th><th>Állapot</th><th>Megjegyzés</th></tr></thead>
          <tbody>
            {d.audit.dataSources.map((x) => (
              <tr key={x.id}>
                <td>{x.label}</td>
                <td><Kind k={x.kind} /></td>
                <td>{x.status === 'used' ? 'használva' : x.status === 'not_configured' ? 'nincs konfigurálva' : x.status === 'failed' ? 'sikertelen' : 'kihagyva'}</td>
                <td className="small">{x.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.llmUsage && <Note>LLM: {d.llmUsage.calls} hívás, {d.llmUsage.cached} cache-ből, {d.llmUsage.failed} sikertelen · {(d.llmUsage.inputTokens + d.llmUsage.outputTokens).toLocaleString('hu-HU')} token · becsült költség ≈ ${d.llmUsage.costUsd.toFixed(2)}</Note>}
      </div>
    </div>
  );
}

function ComponentRow({ c }: { c: NonNullable<AuditDetail['score']>['components'][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <td><b>{c.label}</b><div className="small muted">{c.explanation}</div></td>
        <td>
          {c.status === 'ok' ? <ScoreBar value={c.score} label={c.label} /> : <span className="tag evidence-unverifiable">{c.status === 'not_measured' ? 'nem mérhető' : 'elégtelen adat'}</span>}
        </td>
        <td className="num">{c.weight}</td>
        <td>{c.status === 'ok' ? `${Math.round(c.confidence * 100)}%` : '—'}</td>
        <td><span className="small">{EVIDENCE_KIND_LABEL[c.source]}</span></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="small">
            <b>Módszer:</b> {c.method}
            {c.evidence.length > 0 && (
              <ul className="tight">{c.evidence.map((e, i) => <li key={i}>{e.url && <a href={e.url} target="_blank" rel="noreferrer">{e.url}</a>} {e.detail}</li>)}</ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Ctx<T>({ label, d, extra }: { label: string; d: Detected<T>; extra?: string }) {
  const v = Array.isArray(d.value) ? (d.value.length ? d.value.join(', ') : null) : (d.value as unknown as string | null);
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {v ?? <span className="muted">nem azonosítható</span>}
        <div className="small muted">
          {d.source} · bizonyosság {Math.round(d.confidence * 100)}%{extra ? ` · ${extra}` : ''}
        </div>
      </dd>
    </>
  );
}

export function ProgressTab({ d, running }: { d: AuditDetail; running: boolean }) {
  const [logs, setLogs] = useState<{ id: number; t: string; level: string; msg: string }[]>([]);
  const last = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      siteApi.logs(d.audit.id, last.current).then((x) => {
        if (!alive || !x.length) return;
        last.current = x[x.length - 1].id;
        setLogs((l) => [...l, ...x].slice(-1000));
      });
    void load();
    const h = running ? setInterval(load, 2000) : undefined;
    return () => {
      alive = false;
      if (h) clearInterval(h);
    };
  }, [d.audit.id, running]);
  const ic: Record<string, string> = { pending: '○', running: '↻', done: '✓', failed: '✕', skipped: '–' };
  const cls: Record<string, string> = { pending: 'na', running: 'info', done: 'pass', failed: 'fail', skipped: 'na' };
  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Lépések</h2>
        <ol className="steps">
          {d.audit.steps.map((s) => (
            <li key={s.id}>
              <span className={`status ${cls[s.status]}`}><span className="ic" aria-hidden>{ic[s.status]}</span>{s.status === 'pending' ? 'vár' : s.status === 'running' ? 'fut' : s.status === 'done' ? 'kész' : s.status === 'failed' ? 'hiba' : 'kihagyva'}</span>
              <div>
                <b>{s.title}</b>
                {s.progress && s.status === 'running' && (
                  <div className="row small"><ScoreBar value={Math.round((s.progress.done / Math.max(1, s.progress.total)) * 100)} label="Haladás" /> <span className="muted">{s.progress.done}/{s.progress.total}</span></div>
                )}
                {s.note && <div className="small muted">{s.note}</div>}
                {s.error && <div className="small" style={{ color: '#9d2222' }}>{s.error}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="card">
        <h2>Napló</h2>
        <div className="log" style={{ maxHeight: 640 }}>
          {logs.map((l) => (
            <div key={l.id} className={l.level}>
              {l.t.slice(11, 19)} {l.msg}
            </div>
          ))}
          {!logs.length && <div>—</div>}
        </div>
        <h3 style={{ marginTop: 16 }}>Konfiguráció</h3>
        <pre className="code" style={{ maxHeight: 260 }}>{JSON.stringify(d.audit.input, null, 2)}</pre>
      </div>
    </div>
  );
}
