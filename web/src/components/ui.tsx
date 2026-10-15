import { useEffect, useState, type ReactNode } from 'react';
import { EVIDENCE_LABEL, STATUS_LABEL, type Evidence, type Snippet, type SourceLink, type Status, type Surface } from '../../../shared/types';
import { BANDS, COVERAGE_TEXT, EVIDENCE_TEXT, STATUS_TEXT } from '../../../shared/glossary';

const ICON: Record<Status, string> = { pass: '✓', warn: '!', fail: '✕', info: 'i', na: '–', unverifiable: '?' };

export function StatusBadge({ s }: { s: Status }) {
  return (
    <span className={`status ${s}`} title={STATUS_TEXT[s]}>
      <span className="ic" aria-hidden>
        {ICON[s]}
      </span>
      {STATUS_LABEL[s]}
    </span>
  );
}

export function EvidenceTag({ e }: { e: Evidence }) {
  return (
    <span className={`tag evidence-${e}`} title={EVIDENCE_TEXT[e]}>
      [{EVIDENCE_LABEL[e]}]
    </span>
  );
}

const SURFACE_LABEL: Record<Surface, string> = { bing: 'Bing/Copilot', chatgpt: 'ChatGPT', other: 'Egyéb AI' };
export function SurfaceTags({ surfaces }: { surfaces: Surface[] }) {
  const both = surfaces.includes('bing') && surfaces.includes('chatgpt');
  if (both) return <span className="tag outline">mindkettő</span>;
  return (
    <>
      {surfaces.map((s) => (
        <span key={s} className="tag outline">
          {SURFACE_LABEL[s]}
        </span>
      ))}
    </>
  );
}

export function band(score: number | null) {
  if (score === null) return { cls: 'none', label: 'Nincs adat' };
  if (score >= 80) return { cls: 'good', label: 'Jó' };
  if (score >= 60) return { cls: 'warn', label: 'Közepes' };
  if (score >= 40) return { cls: 'serious', label: 'Gyenge' };
  return { cls: 'critical', label: 'Kritikus' };
}

export function Meter({ value }: { value: number | null }) {
  const b = band(value);
  return (
    <div className="meter" role="img" aria-label={`${value ?? '—'} / 100`}>
      <div className={`band-${b.cls}-bg`} style={{ width: `${value ?? 0}%` }} />
    </div>
  );
}

export function ScoreTile({ title, score, coverage, hint }: { title: string; score: number | null; coverage: number; hint?: string }) {
  const b = band(score);
  return (
    <div className="card">
      <p className="label">{title}</p>
      <div className="score-tile">
        <div className={`big band-${b.cls}`}>
          {score ?? '—'}
          <small>/100</small>
        </div>
        <div className="stack" style={{ gap: 4, flex: 1 }}>
          <b className={`band-${b.cls}`}>{b.label}</b>
          <Meter value={score} />
          <span className="small">{BANDS.find((x) => x.cls === b.cls)?.text ?? 'Még nincs elég adat az értékeléshez.'}</span>
          <span className="small muted" title={COVERAGE_TEXT}>
            Lefedettség: {coverage}% – ennyit tudtunk ténylegesen ellenőrizni {hint ? `· ${hint}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

export function CodeBlock({ snippet }: { snippet: Snippet }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="snippet">
      <div className="row between">
        <span className="small">
          <b>{snippet.label}</b> {snippet.lang && <span className="tag outline">{snippet.lang}</span>}
        </span>
        <button
          className="btn sm ghost"
          onClick={() => {
            void navigator.clipboard.writeText(snippet.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Másolva ✓' : 'Másolás'}
        </button>
      </div>
      <pre className="code">{snippet.code}</pre>
    </div>
  );
}

export function Sources({ sources }: { sources: SourceLink[] }) {
  if (!sources.length) return null;
  return (
    <div className="sources small">
      <span className="muted">Források: </span>
      {sources.map((s) => (
        <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
          {s.title}
          {s.official === false ? ' (másodlagos)' : ''}
          {s.checked ? ` · ellenőrizve: ${s.checked}` : s.official ? ' · ellenőrizendő' : ''}
        </a>
      ))}
    </div>
  );
}

let toastSetter: ((t: { msg: string; error?: boolean } | null) => void) | null = null;
export function toast(msg: string, error = false) {
  toastSetter?.({ msg, error });
}
export function ToastHost() {
  const [t, setT] = useState<{ msg: string; error?: boolean } | null>(null);
  useEffect(() => {
    toastSetter = setT;
    return () => void (toastSetter = null);
  }, []);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT(null), t.error ? 6000 : 2500);
    return () => clearTimeout(h);
  }, [t]);
  return t ? <div className={`toast ${t.error ? 'error' : ''}`}>{t.msg}</div> : null;
}

export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <div className="drawer">{children}</div>
    </>
  );
}

export function ChipSelect<T extends string>({ options, value, onChange }: { options: { v: T; l: string }[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="chip-select">
      {options.map((o) => (
        <button
          type="button"
          key={o.v}
          className={value.includes(o.v) ? 'on' : ''}
          onClick={() => onChange(value.includes(o.v) ? value.filter((x) => x !== o.v) : [...value, o.v])}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
