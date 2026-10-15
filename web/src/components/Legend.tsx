import { BANDS, CATEGORY_TEXT, COVERAGE_TEXT, EFFORT, EVIDENCE_TEXT, OWNER_TEXT, PRIORITY, STATUS_TEXT, SURFACE_TEXT } from '../../../shared/glossary';
import { EvidenceTag, StatusBadge } from './ui';
import type { BacklogCategory, Effort, Evidence, Owner, Priority, Status } from '../../../shared/types';

export type LegendSection = 'scores' | 'status' | 'evidence' | 'priority' | 'effort' | 'owner' | 'category' | 'surface';

const STATUSES: Status[] = ['pass', 'warn', 'fail', 'info', 'unverifiable', 'na'];
const EVIDENCES: Evidence[] = ['observed', 'likely', 'hypothesis', 'unverifiable'];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="legend-block">
      <h3>{title}</h3>
      <dl className="gloss">{children}</dl>
    </div>
  );
}

export function Legend({ sections, open = false, title = 'Hogyan olvasd az auditot?' }: { sections: LegendSection[]; open?: boolean; title?: string }) {
  const has = (s: LegendSection) => sections.includes(s);
  return (
    <details className="card legend-card" open={open}>
      <summary>
        <span className="label" style={{ display: 'inline' }}>
          Jelmagyarázat
        </span>{' '}
        <b>{title}</b>
      </summary>
      <div className="legend-grid">
        {has('scores') && (
          <Block title="Pontszám (0–100)">
            {BANDS.map((b) => (
              <div key={b.cls}>
                <dt>
                  <b className={`band-${b.cls}`}>{b.label}</b> <span className="muted">{b.range}</span>
                </dt>
                <dd>{b.text}</dd>
              </div>
            ))}
            <div>
              <dt>
                <b>Lefedettség</b>
              </dt>
              <dd>{COVERAGE_TEXT}</dd>
            </div>
            <div>
              <dt />
              <dd className="muted">A pontszám a felkészültséget méri, nem garantálja, hogy az oldal megjelenik.</dd>
            </div>
          </Block>
        )}
        {has('status') && (
          <Block title="Az ellenőrzések eredménye">
            {STATUSES.map((s) => (
              <div key={s}>
                <dt>
                  <StatusBadge s={s} />
                </dt>
                <dd>{STATUS_TEXT[s]}</dd>
              </div>
            ))}
          </Block>
        )}
        {has('evidence') && (
          <Block title="Mennyire biztos a megállapítás?">
            {EVIDENCES.map((e) => (
              <div key={e}>
                <dt>
                  <EvidenceTag e={e} />
                </dt>
                <dd>{EVIDENCE_TEXT[e]}</dd>
              </div>
            ))}
          </Block>
        )}
        {has('priority') && (
          <Block title="Prioritás – mikor érdemes elvégezni?">
            {(Object.keys(PRIORITY) as Priority[]).map((p) => (
              <div key={p}>
                <dt>
                  <span className={`prio prio-${p}`}>{p}</span>
                </dt>
                <dd>
                  <b>{PRIORITY[p].short}.</b> {PRIORITY[p].text}
                </dd>
              </div>
            ))}
          </Block>
        )}
        {has('effort') && (
          <Block title="Ráfordítás – mekkora munka?">
            {(Object.keys(EFFORT) as Effort[]).map((e) => (
              <div key={e}>
                <dt>
                  <span className="effort">{e}</span>
                </dt>
                <dd>
                  <b>{EFFORT[e].short[0].toUpperCase() + EFFORT[e].short.slice(1)}.</b> {EFFORT[e].text}
                </dd>
              </div>
            ))}
            <div>
              <dt />
              <dd className="muted">Tájékoztató becslés; a pontos ráfordítást a fejlesztő adja meg.</dd>
            </div>
          </Block>
        )}
        {has('owner') && (
          <Block title="Ki a felelős?">
            {(Object.keys(OWNER_TEXT) as Owner[]).map((o) => (
              <div key={o}>
                <dt>
                  <b>{o}</b>
                </dt>
                <dd>{OWNER_TEXT[o]}</dd>
              </div>
            ))}
          </Block>
        )}
        {has('surface') && (
          <Block title="Melyik AI-felületet érinti?">
            {Object.entries(SURFACE_TEXT).map(([k, v]) => (
              <div key={k}>
                <dt>
                  <span className="tag outline">{k}</span>
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </Block>
        )}
        {has('category') && (
          <Block title="Kategória – milyen jellegű a feladat?">
            {(Object.keys(CATEGORY_TEXT) as BacklogCategory[]).map((c) => (
              <div key={c}>
                <dt>
                  <b>{c}</b>
                </dt>
                <dd>{CATEGORY_TEXT[c]}</dd>
              </div>
            ))}
          </Block>
        )}
      </div>
    </details>
  );
}
