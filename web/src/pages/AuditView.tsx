import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { fmtDate, toast } from '../components/ui';
import { go } from '../App';
import type { AuditSummary, CheckDef, Round } from '../../../shared/types';
import { Overview } from './tabs/Overview';
import { Details } from './tabs/Details';
import { Bots } from './tabs/Bots';
import { Questions } from './tabs/Questions';
import { Manual } from './tabs/Manual';
import { Backlog } from './tabs/Backlog';
import { Samples } from './tabs/Samples';
import { Measure } from './tabs/Measure';
import { Rounds } from './tabs/Rounds';

export interface TabProps {
  id: string;
  round: Round;
  setRound: (r: Round) => void;
  summary: AuditSummary;
  checks: Record<string, CheckDef>;
  reload: () => Promise<void>;
  aiEnabled: boolean;
}

const TABS = [
  { id: 'overview', label: 'Áttekintés' },
  { id: 'details', label: 'Részletes audit' },
  { id: 'bots', label: 'Bot-mátrix' },
  { id: 'questions', label: 'Kérdések és AI-teszt' },
  { id: 'manual', label: 'Kézi teendők' },
  { id: 'backlog', label: 'Backlog és csomagok' },
  { id: 'samples', label: 'Kódminták' },
  { id: 'measure', label: 'Mérési terv' },
  { id: 'rounds', label: 'Körök és napló' },
];

export function AuditView({ id, n, tab, aiEnabled }: { id: string; n?: number; tab: string; aiEnabled: boolean }) {
  const [summary, setSummary] = useState<(AuditSummary & { running: boolean }) | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentN = n ?? (summary?.rounds.length ? summary.rounds[summary.rounds.length - 1].n : undefined);

  const reload = useCallback(async () => {
    try {
      const s = await api.audit(id);
      setSummary(s);
      const target = n ?? (s.rounds.length ? s.rounds[s.rounds.length - 1].n : undefined);
      if (target) setRound(await api.round(id, target));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, n]);

  useEffect(() => void reload(), [reload]);

  // Futó körnél pollozunk.
  useEffect(() => {
    if (round?.status !== 'running') return;
    const h = setInterval(() => void reload(), 1500);
    return () => clearInterval(h);
  }, [round?.status, reload]);

  const checks = useMemo(() => Object.fromEntries((round?.checks ?? []).map((c) => [c.id, c])), [round?.checks]);

  if (error) return <div className="card empty">Hiba: {error}</div>;
  if (!summary || !round) return <div className="empty"><span className="spinner" /></div>;

  const setTab = (t: string) => go(`/audit/${id}${n ? `/${n}` : ''}?tab=${t}`);
  const latest = summary.rounds[summary.rounds.length - 1]?.n;
  const props: TabProps = {
    id,
    round,
    setRound: (r) => setRound(r),
    summary,
    checks,
    reload,
    aiEnabled,
  };

  return (
    <>
      <div className="header-block">
        <div className="stripe" />
        <div style={{ flex: '1 1 380px', minWidth: 0 }}>
          <p className="label">
            GEO audit · {currentN}. kör {currentN !== latest ? '(korábbi kör)' : ''}
          </p>
          <h1 className="title">{round.input.name || round.input.url}</h1>
          <p className="sub">
            <a href={round.input.url} target="_blank" rel="noreferrer">
              {round.input.url}
            </a>{' '}
            · {round.input.org || 'szervezet nincs megadva'} · {round.input.pageType || '—'} · {fmtDate(round.createdAt)}
          </p>
        </div>
        <div className="row no-print" style={{ alignSelf: 'flex-start' }}>
          {summary.rounds.length > 1 && (
            <select value={currentN} onChange={(e) => go(`/audit/${id}/${e.target.value}?tab=${tab}`)} style={{ width: 'auto' }}>
              {summary.rounds.map((r) => (
                <option key={r.n} value={r.n}>
                  {r.n}. kör · {fmtDate(r.createdAt)}
                </option>
              ))}
            </select>
          )}
          <button className="btn" onClick={() => window.print()}>
            Nyomtatás / PDF
          </button>
          <button
            className="btn dark"
            disabled={summary.running || round.status === 'running'}
            onClick={async () => {
              try {
                const { n: nn } = await api.newRound(id, {});
                toast(`${nn}. kör elindítva`);
                go(`/audit/${id}?tab=${tab}`);
                await reload();
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            Új kör
          </button>
        </div>
      </div>

      {round.status === 'running' && (
        <div className="notice neutral row" style={{ marginBottom: 16 }}>
          <span className="spinner" /> A kör fut: {round.log[round.log.length - 1]?.msg ?? 'indul…'}
        </div>
      )}
      {round.status === 'error' && <div className="notice" style={{ marginBottom: 16 }}>A kör hibával állt le. Részletek a „Körök és napló” fülön.</div>}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {round.status !== 'running' || tab === 'rounds' ? (
        <>
          {tab === 'overview' && <Overview {...props} />}
          {tab === 'details' && <Details {...props} />}
          {tab === 'bots' && <Bots {...props} />}
          {tab === 'questions' && <Questions {...props} />}
          {tab === 'manual' && <Manual {...props} />}
          {tab === 'backlog' && <Backlog {...props} />}
          {tab === 'samples' && <Samples {...props} />}
          {tab === 'measure' && <Measure {...props} />}
          {tab === 'rounds' && <Rounds {...props} />}
        </>
      ) : (
        <div className="card">
          <div className="log">
            {round.log.map((l, i) => (
              <div key={i} className={l.level}>
                {l.msg}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
