import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { ChipSelect, StatusBadge, SurfaceTags, toast } from '../../components/ui';
import type { BacklogItem, Effort, Owner, Priority } from '../../../../shared/types';
import type { TabProps } from '../AuditView';
import { Legend } from '../../components/Legend';
import { CATEGORY_TEXT, EFFORT, PRIORITY, priorityLabel } from '../../../../shared/glossary';
import { downloadText, toCsv } from '../../lib';

const PRIOS: Priority[] = ['kritikus', 'magas', 'közepes', 'alacsony'];
const EFFORTS: Effort[] = ['S', 'M', 'L'];
const EFFORT_DAYS: Record<Effort, number> = { S: 1, M: 3, L: 8 };
const surfaceLabel = (b: BacklogItem) =>
  b.surfaces.includes('bing') && b.surfaces.includes('chatgpt') ? 'mindkettő' : b.surfaces.includes('chatgpt') ? 'ChatGPT' : b.surfaces.includes('bing') ? 'Bing/Copilot' : 'egyéb';

interface Pkg {
  id: string;
  name: string;
  goal: string;
  chatgpt?: boolean;
  items: BacklogItem[];
}

function packages(items: BacklogItem[]): Pkg[] {
  const pk: Pkg[] = [
    { id: 'tech', name: 'Technikai alapozás', goal: 'A robotok akadálytalanul elérik, és helyesen indexelik az oldalt.', items: [] },
    { id: 'chatgpt', name: 'ChatGPT-láthatósági csomag', goal: 'Kifejezetten a ChatGPT search és a ChatGPT-be beillesztett URL-ek olvashatóságát célozza.', chatgpt: true, items: [] },
    { id: 'bing', name: 'Bing- és Copilot-csomag', goal: 'Gyorsabb Bing-indexelés és teljes értékű Copilot-felhasználás.', items: [] },
    { id: 'schema', name: 'Entitásmodell és strukturált adat', goal: 'Gépileg egyértelmű, ki az üzemeltető és mi a fő entitás. Nem garantál rich resultot.', items: [] },
    { id: 'content', name: 'Idézhető tartalom', goal: 'Tényszerű, dátummal ellátott válaszok a tipikus kérdésekre. Az adatokat az ügyfél adja.', items: [] },
  ];
  const by = (id: string) => pk.find((p) => p.id === id)!;
  for (const b of items) {
    const onlyGpt = b.surfaces.length === 1 && b.surfaces[0] === 'chatgpt';
    const onlyBing = b.surfaces.length === 1 && b.surfaces[0] === 'bing';
    if (onlyGpt || b.checkId === 'bots.chatgpt-user') by('chatgpt').items.push(b);
    else if (onlyBing) by('bing').items.push(b);
    else if (b.category === 'Strukturált adat') by('schema').items.push(b);
    else if (b.category === 'Tartalom/IA' || b.owner === 'ügyfél') by('content').items.push(b);
    else by('tech').items.push(b);
  }
  return pk.filter((p) => p.items.length);
}

export function Backlog({ id, round }: TabProps) {
  const [items, setItems] = useState<BacklogItem[] | null>(null);
  const [owner, setOwner] = useState<Owner[]>([]);
  const [prio, setPrio] = useState<Priority[]>([]);
  const [surf, setSurf] = useState<string[]>([]);
  useEffect(() => {
    api.backlog(id, round.n).then(setItems).catch((e) => toast(e.message, true));
  }, [id, round]);

  const filtered = useMemo(
    () =>
      (items ?? []).filter(
        (b) =>
          (!owner.length || owner.includes(b.owner) || b.owner === 'mindkettő') &&
          (!prio.length || prio.includes(b.priority)) &&
          (!surf.length || surf.includes(surfaceLabel(b))),
      ),
    [items, owner, prio, surf],
  );

  if (!items) return <div className="empty"><span className="spinner" /></div>;
  if (!items.length) return <div className="card empty">Nincs nyitott backlog-tétel ebben a körben. Ha valami jól működik, az is eredmény.</div>;

  const exportCsv = () =>
    downloadText(
      `backlog-${id}-kor${round.n}.csv`,
      toCsv([
        ['#', 'Cím', 'Kategória', 'Érintett felület', 'Felelős', 'Jelenlegi állapot', 'Javasolt változtatás', 'Megvalósítás', 'Várható előny', 'Prioritás', 'Ráfordítás', 'Ráfordítás indoka', 'Ellenőrzés', 'Check ID'],
        ...filtered.map((b) => [b.n, b.title, b.category, surfaceLabel(b), b.owner, b.current, b.change, b.implementation, b.benefit, `${b.priority} – ${PRIORITY[b.priority].short}`, `${b.effort} – ${EFFORT[b.effort].short}`, b.effortReason, b.verification, b.checkId]),
      ]),
      'text/csv',
    );

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Legend sections={['priority', 'effort', 'owner', 'surface', 'category']} open title="Mit jelent a prioritás, a ráfordítás és a többi oszlop?" />
      <div className="grid cols-2">
        <div className="card">
          <p className="label">Prioritás × ráfordítás</p>
          <p className="small muted" style={{ marginTop: 0 }}>
            Soronként: mennyire sürgős. Oszloponként: mekkora munka. A cellában a backlog-tételek sorszáma.
          </p>
          <table className="t" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th />
                {EFFORTS.map((e) => (
                  <th key={e} className="num">
                    {e} – {EFFORT[e].short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PRIOS.map((p) => (
                <tr key={p}>
                  <td>
                    <span className={`prio prio-${p}`}>{p}</span>
                    <span className="explain">{PRIORITY[p].short}</span>
                  </td>
                  {EFFORTS.map((e) => {
                    const cell = items.filter((b) => b.priority === p && b.effort === e);
                    const quick = (p === 'kritikus' || p === 'magas') && e === 'S';
                    return (
                      <td key={e} className="num" style={{ background: cell.length ? (quick ? '#e8f6e8' : 'var(--gray)') : undefined }} title={cell.map((b) => `#${b.n} ${b.title}`).join('\n')}>
                        {cell.length ? (
                          <>
                            <b>{cell.length}</b> <span className="small muted">#{cell.map((b) => b.n).join(', #')}</span>
                          </>
                        ) : (
                          <span className="muted">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginBottom: 0 }}>Zöld háttér: gyors nyerő – fontos feladat, kevés munkával (kritikus vagy magas prioritás, S ráfordítás).</p>
        </div>
        <div className="card">
          <p className="label">Megoszlás</p>
          <dl className="kv">
            <dt>Összes tétel</dt>
            <dd>{items.length}</dd>
            <dt>Fejlesztői</dt>
            <dd>{items.filter((b) => b.owner !== 'ügyfél').length}</dd>
            <dt>Ügyféloldali</dt>
            <dd>{items.filter((b) => b.owner !== 'fejlesztő').length}</dd>
            <dt>Becsült ráfordítás</dt>
            <dd>
              ~{items.reduce((s, b) => s + EFFORT_DAYS[b.effort], 0)} embernap
              <span className="explain">Durva becslés: kis munka 1, közepes 3, nagy 8 nappal számolva.</span>
            </dd>
            {(['Hibajavítás', 'SEO/indexelés', 'Strukturált adat', 'AI-láthatóság', 'Tartalom/IA', 'Kísérleti'] as const).map((c) => {
              const n = items.filter((b) => b.category === c).length;
              return n ? (
                <Fragment key={c}>
                  <dt>{c}</dt>
                  <dd>{n}</dd>
                </Fragment>
              ) : null;
            })}
          </dl>
        </div>
      </div>

      <div className="card flat">
        <div className="row between" style={{ padding: '16px 20px' }}>
          <div>
            <p className="label">C. Fejlesztési backlog</p>
            <span className="small muted">Minden tétel önállóan továbbadható. A „Jelenlegi állapot” a kör megállapításából jön.</span>
          </div>
          <div className="row no-print">
            <ChipSelect<Owner> options={[{ v: 'fejlesztő', l: 'Fejlesztő' }, { v: 'ügyfél', l: 'Ügyfél' }]} value={owner} onChange={setOwner} />
            <ChipSelect<string> options={['Bing/Copilot', 'ChatGPT', 'mindkettő'].map((v) => ({ v, l: v }))} value={surf} onChange={setSurf} />
            <ChipSelect<Priority> options={PRIOS.map((v) => ({ v, l: v }))} value={prio} onChange={setPrio} />
            <button className="btn sm" onClick={exportCsv}>
              CSV export
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="t brand">
            <thead>
              <tr>
                <th>#</th>
                <th>Cím</th>
                <th>Kategória</th>
                <th>Felület</th>
                <th>Jelenlegi állapot</th>
                <th>Javasolt változtatás</th>
                <th>Megvalósítás</th>
                <th>Várható előny</th>
                <th>Prioritás</th>
                <th>Ráfordítás</th>
                <th>Ellenőrzés</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.n}>
                  <td>{b.n}</td>
                  <td>
                    <b>{b.title}</b>
                    <div className="small muted">{b.owner}</div>
                  </td>
                  <td className="small">
                    {b.category}
                    <span className="explain">{CATEGORY_TEXT[b.category]}</span>
                  </td>
                  <td>
                    <SurfaceTags surfaces={b.surfaces} />
                  </td>
                  <td className="small">
                    <StatusBadge s={b.status} />
                    <div>{b.current}</div>
                  </td>
                  <td className="small">{b.change}</td>
                  <td className="small">{b.implementation}</td>
                  <td className="small">{b.benefit}</td>
                  <td title={PRIORITY[b.priority].text}>
                    <span className={`prio prio-${b.priority}`}>{b.priority}</span>
                    <span className="explain">{PRIORITY[b.priority].short}</span>
                  </td>
                  <td className="small" title={EFFORT[b.effort].text}>
                    <span className="effort">{b.effort}</span>
                    <span className="explain">{EFFORT[b.effort].short}</span>
                    <span className="explain">{b.effortReason}</span>
                  </td>
                  <td className="small">
                    <code>{b.verification}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <p className="label">F. Üzletileg bemutatható fejlesztési csomagok</p>
        <p className="small muted">Garanciaígéret nélkül: a csomagok a láthatóság feltételeit javítják, a megjelenést a keresők és az AI-felületek döntik el.</p>
        <div className="grid cols-2">
          {packages(items).map((p) => (
            <div key={p.id} className="card" style={{ margin: 0 }}>
              <div className="row between">
                <h3 style={{ margin: 0 }}>{p.name}</h3>
                {p.chatgpt && <span className="tag orange">ChatGPT-fókusz</span>}
              </div>
              <p className="small muted">{p.goal}</p>
              <ul className="small" style={{ paddingLeft: 18, margin: '0 0 8px' }}>
                {p.items.map((b) => (
                  <li key={b.n}>
                    #{b.n} {b.title}{' '}
                    <span className="muted">
                      ({priorityLabel(b.priority)}; {EFFORT[b.effort].short})
                    </span>
                  </li>
                ))}
              </ul>
              <span className="small">
                <b>~{p.items.reduce((s, b) => s + EFFORT_DAYS[b.effort], 0)} embernap</b> · felelős: {[...new Set(p.items.map((b) => b.owner))].join(', ')}
              </span>
            </div>
          ))}
          <div className="card" style={{ margin: 0 }}>
            <h3 style={{ margin: 0 }}>Mérés és monitorozás</h3>
            <p className="small muted">Bing Webmaster Tools AI Performance, szervernapló-szűrés botonként, ChatGPT/Copilot-forgalom az analitikában, negyedéves kérdésteszt.</p>
            <span className="small">
              <b>~2–3 embernap</b> beállítás + negyedévente ~0,5 nap
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
