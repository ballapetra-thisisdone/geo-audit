import { useState } from 'react';
import { CodeBlock } from '../../components/ui';
import { go } from '../../App';
import { ACCESS_REQUEST, MANUAL_TASKS, type ManualTask } from '../../../../shared/manualTasks';
import type { TabProps } from '../AuditView';
import { FindingCard } from './Details';
import { PromptPack } from '../../components/PromptPack';

function isDone(t: ManualTask, tab: TabProps) {
  if (t.questionsTab) {
    const surface = t.id === 'chatgpt-test' ? 'chatgpt' : 'copilot';
    return tab.round.questions.some((q) => q.results.some((r) => r.surface === surface));
  }
  return t.checks.every((id) => !!tab.round.findings[id]?.override);
}

function TaskCard({ t, tab, done }: { t: ManualTask; tab: TabProps; done: boolean }) {
  const [open, setOpen] = useState(!done);
  const checks = t.checks.map((id) => tab.checks[id]).filter(Boolean);
  return (
    <div className="card flat">
      <div className="row between" style={{ padding: '16px 20px', cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <div className="row">
          <span className={`status ${done ? 'pass' : 'warn'}`}>
            <span className="ic">{done ? '✓' : '!'}</span>
            {done ? 'Rögzítve' : 'Teendő'}
          </span>
          <h3 style={{ margin: 0 }}>{t.title}</h3>
        </div>
        <span className="small muted">
          {t.time} {open ? '▲' : '▼'}
        </span>
      </div>
      {open && (
        <div style={{ padding: '0 20px 16px' }}>
          <p style={{ marginTop: 0 }}>{t.why}</p>
          <dl className="kv" style={{ marginBottom: 12 }}>
            <dt>Ki végzi?</dt>
            <dd>{t.who}</dd>
            <dt>Mi kell hozzá?</dt>
            <dd>{t.access}</dd>
            <dt>Időigény</dt>
            <dd>{t.time}</dd>
          </dl>
          <h3>Lépések</h3>
          <ol style={{ paddingLeft: 20, margin: '0 0 12px' }}>
            {t.steps.map((s, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {s}
              </li>
            ))}
          </ol>
          <div className="notice neutral small" style={{ marginBottom: 12 }}>
            <b>Hová rögzítsd?</b> {t.record}
          </div>
          {t.questionsTab ? (
            <>
              <details open style={{ marginBottom: 12 }}>
                <summary>Beilleszthető promptok</summary>
                <div style={{ marginTop: 12 }}>
                  <PromptPack
                    round={tab.round}
                    surface={t.id === 'chatgpt-test' ? 'chatgpt' : 'copilot'}
                    onEditQuestions={() => go(`/audit/${tab.id}?tab=questions`)}
                  />
                </div>
              </details>
              <button className="btn sm dark" onClick={() => go(`/audit/${tab.id}?tab=questions`)}>
                Eredmények rögzítése a Kérdések fülön →
              </button>
            </>
          ) : (
            <div className="card flat" style={{ margin: 0 }}>
              {checks.map((c) => (
                <FindingCard key={c.id} check={c} finding={tab.round.findings[c.id]} tab={tab} defaultOpen={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Manual(tab: TabProps) {
  const { round, checks } = tab;
  const active = (id: string) => {
    const c = checks[id];
    return c && c.enabled && (c.module === 'core' || round.input.modules.includes(c.module));
  };
  const tasks = MANUAL_TASKS.filter((t) => t.checks.some(active));
  const covered = new Set(tasks.flatMap((t) => t.checks));
  const otherManual = Object.values(checks).filter((c) => c.runner === 'manual' && active(c.id) && !covered.has(c.id));
  const doneCount = tasks.filter((t) => isDone(t, tab)).length + otherManual.filter((c) => round.findings[c.id]?.override).length;
  const total = tasks.length + otherManual.length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <p className="label">Kézi teendők</p>
        <p style={{ marginTop: 0 }}>
          Ezeket sem a gépi ellenőrzés, sem AI nem tudja elvégezni: vagy a ChatGPT/Copilot felületén kell kipróbálni, vagy az ügyfél hozzáférése kell hozzá.
          Amíg nincsenek rögzítve, „Nem ellenőrizhető” státuszúak, és nem számítanak bele a pontszámba – ezért alacsonyabb a lefedettség.
        </p>
        <div className="row">
          <b>
            {doneCount} / {total} rögzítve
          </b>
          <div style={{ flex: 1, maxWidth: 300 }}>
            <div className="meter">
              <div className="band-good-bg" style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
      </div>

      {tasks.map((t) => (
        <TaskCard key={t.id} t={t} tab={tab} done={isDone(t, tab)} />
      ))}

      {otherManual.length > 0 && (
        <div className="card flat">
          <div style={{ padding: '16px 20px 8px' }}>
            <p className="label">További kézi ellenőrzések</p>
            <p className="small muted" style={{ margin: 0 }}>Az ellenőrzés-könyvtár kézi tételei. Kattints rájuk a teendőkért és a rögzítéshez.</p>
          </div>
          {otherManual.map((c) => (
            <FindingCard key={c.id} check={c} finding={round.findings[c.id]} tab={tab} defaultOpen={false} />
          ))}
        </div>
      )}

      <div className="card">
        <p className="label">Hozzáférés kérése az ügyféltől</p>
        <p className="small muted" style={{ marginTop: 0 }}>Másolható levélvázlat a hiányzó hozzáférésekhez. Küldés előtt igazítsd az adott ügyfélhez.</p>
        <CodeBlock snippet={{ label: 'E-mail vázlat', code: ACCESS_REQUEST(new URL(round.input.url).hostname, round.input.org), lang: 'text' }} />
      </div>
    </div>
  );
}
