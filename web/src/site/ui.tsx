import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Coverage, EvidenceKind, PriorityLevel } from '../../../shared/site';
import { EVIDENCE_KIND_LABEL } from '../../../shared/site';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | undefined; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(undefined)))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, error, loading, reload };
}

export function Loading({ error, loading, children }: { error?: string; loading?: boolean; children?: ReactNode }) {
  if (error) return <div className="notice">Hiba: {error}</div>;
  if (loading) return <div className="empty"><span className="spinner" /> Betöltés…</div>;
  return <>{children}</>;
}

const PRIO_ICON: Record<PriorityLevel, string> = { P0: '!!', P1: '!', P2: '•', P3: '·' };
const PRIO_TEXT: Record<PriorityLevel, string> = { P0: 'kritikus', P1: 'magas', P2: 'közepes', P3: 'alacsony' };
export function Prio({ p }: { p: PriorityLevel | string }) {
  const k = p as PriorityLevel;
  return (
    <span className={`prio2 ${k}`} title={`${k} – ${PRIO_TEXT[k] ?? ''}`}>
      <span aria-hidden>{PRIO_ICON[k]}</span> {k}
    </span>
  );
}

const COV: Record<Coverage, { ic: string; l: string; cls: string }> = {
  full: { ic: '✓', l: 'Teljes', cls: 'pass' },
  partial: { ic: '!', l: 'Részleges', cls: 'warn' },
  missing: { ic: '✕', l: 'Hiányzó', cls: 'fail' },
};
export function CoverageBadge({ c }: { c: Coverage | string }) {
  const x = COV[c as Coverage] ?? { ic: '?', l: c, cls: 'unverifiable' };
  return (
    <span className={`status ${x.cls}`}>
      <span className="ic" aria-hidden>{x.ic}</span>
      {x.l}
    </span>
  );
}

export function Kind({ k }: { k: EvidenceKind | string }) {
  const cls = k === 'measured' || k === 'external' ? 'evidence-observed' : k === 'observed' ? 'evidence-likely' : k === 'unverifiable' ? 'evidence-unverifiable' : 'evidence-hypothesis';
  return <span className={`tag ${cls}`}>{EVIDENCE_KIND_LABEL[k as EvidenceKind] ?? k}</span>;
}

export function Conf({ v }: { v: number }) {
  return <span className="small muted" title="Bizonyosság: mennyire megbízható a megállapítás">{Math.round(v * 100)}% biz.</span>;
}

/** Egyszínű vízszintes sáv 0–100 skálán (magnitúdó); az érték mindig szövegesen is megjelenik. */
export function ScoreBar({ value, label, sub }: { value: number | null; label?: string; sub?: string }) {
  return (
    <div className="sbar" title={label ? `${label}: ${value ?? 'nincs adat'}` : undefined}>
      <div className="sbar-track" role="img" aria-label={`${label ?? ''} ${value ?? 'nincs adat'} / 100`}>
        {value !== null && <div className="sbar-fill" style={{ width: `${Math.max(2, value)}%` }} />}
      </div>
      <span className="sbar-val">{value === null ? '—' : value}</span>
      {sub && <span className="small muted sbar-sub">{sub}</span>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <p className="label">{label}</p>
      <div className="stat-v">{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

export function UrlLink({ url, max = 70 }: { url?: string; max?: number }) {
  if (!url) return <span className="muted">—</span>;
  let short = url.replace(/^https?:\/\/(www\.)?/, '');
  if (short.length > max) short = short.slice(0, max - 1) + '…';
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="url" title={url}>
      {short}
    </a>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Pre({ text, lang }: { text: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="snippet">
      <div className="row between">
        {lang ? <span className="tag outline">{lang}</span> : <span />}
        <button
          className="btn sm ghost"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Másolva ✓' : 'Másolás'}
        </button>
      </div>
      <pre className="code">{text}</pre>
    </div>
  );
}

export function Filter<T extends string>({ label, value, options, onChange }: { label: string; value: T | ''; options: { v: T; l: string }[]; onChange: (v: T | '') => void }) {
  return (
    <label className="field inline">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T | '')}>
        <option value="">mind</option>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="small muted note-line">{children}</p>;
}
