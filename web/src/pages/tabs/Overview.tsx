import { useEffect, useState } from 'react';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { api } from '../../api';
import { band, Meter, ScoreTile, StatusBadge } from '../../components/ui';
import { Legend } from '../../components/Legend';
import { EFFORT, priorityLabel } from '../../../../shared/glossary';
import { STATUS_LABEL, TOPICS, type BacklogItem, type Status } from '../../../../shared/types';
import type { TabProps } from '../AuditView';
import { effective } from '../../lib';

const STATUS_ORDER: Status[] = ['pass', 'warn', 'fail', 'info', 'unverifiable', 'na'];
const STATUS_COLOR: Record<Status, string> = {
  pass: 'var(--good)',
  warn: 'var(--warning)',
  fail: 'var(--critical)',
  info: 'var(--info)',
  unverifiable: 'var(--neutral)',
  na: 'var(--ultra)',
};

interface KeyRow {
  label: string;
  value: string;
  raw: boolean | null;
  rendered: boolean | null;
  jsonld: boolean | null;
  alt: boolean | null;
  chatgptUser: boolean | null;
}

function Cell({ v }: { v: boolean | null }) {
  if (v === null) return <td className="cell na">—</td>;
  return <td className={`cell ${v ? 'pass' : 'fail'}`}>{v ? '✓ van' : '✕ nincs'}</td>;
}

export function Overview({ id, round, checks }: TabProps) {
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  useEffect(() => {
    api.backlog(id, round.n).then(setBacklog).catch(() => setBacklog([]));
  }, [id, round]);

  const s = round.scores;
  if (!s) return <div className="card empty">Ehhez a körhöz még nincs pontszám.</div>;

  const radarData = TOPICS.map((t) => {
    const ts = s.topics.find((x) => x.topic === t.id);
    const noData = ts?.score === null || ts?.score === undefined;
    return { topic: `${t.n}. ${t.title}${noData ? ' (nincs adat)' : ''}`, score: ts?.score ?? 0, real: ts?.score, coverage: ts?.coverage ?? 0 };
  });

  const active = Object.values(round.findings).filter((f) => checks[f.checkId]);
  const blockers = active.filter((f) => effective(f) === 'fail' && ['crawl', 'bots'].includes(checks[f.checkId].topic) && checks[f.checkId].weight >= 4);
  const strengths = active.filter((f) => effective(f) === 'pass' && checks[f.checkId].weight >= 4).slice(0, 4);
  const unverifiable = active.filter((f) => effective(f) === 'unverifiable');
  const bingB = band(s.surfaces.bing.score);
  const gptB = band(s.surfaces.chatgpt.score);
  const keyRows = (round.findings['html.keydata']?.data as KeyRow[] | undefined) ?? [];
  const totalCount = STATUS_ORDER.reduce((a, k) => a + s.counts[k], 0);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <p className="label">A. Vezetői összefoglaló</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            <b>Bing/Copilot:</b> {s.surfaces.bing.score ?? '—'}/100 – <span className={`band-${bingB.cls}`}>{bingB.label.toLowerCase()}</span> (lefedettség{' '}
            {s.surfaces.bing.coverage}%).
          </li>
          <li>
            <b>ChatGPT:</b> {s.surfaces.chatgpt.score ?? '—'}/100 – <span className={`band-${gptB.cls}`}>{gptB.label.toLowerCase()}</span> (lefedettség{' '}
            {s.surfaces.chatgpt.coverage}%).
          </li>
          <li>
            {blockers.length ? (
              <>
                <b>Hozzáférési akadály:</b> {blockers.map((b) => checks[b.checkId].title).join('; ')}.
              </>
            ) : (
              <>Nincs kritikus feltérképezési vagy robot-hozzáférési akadály.</>
            )}
          </li>
          {strengths.length > 0 && (
            <li>
              <b>Jól működik:</b> {strengths.map((f) => checks[f.checkId].title.toLowerCase()).join(', ')}.
            </li>
          )}
          <li>
            <b>A 3 legnagyobb lehetőség:</b>{' '}
            {backlog.length ? (
              <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {backlog.slice(0, 3).map((b) => (
                  <li key={b.n}>
                    {b.title}{' '}
                    <span className="small muted">
                      ({priorityLabel(b.priority)}; {EFFORT[b.effort].short})
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              'nincs nyitott backlog-tétel.'
            )}
          </li>
          {unverifiable.length > 0 && (
            <li className="muted">
              {unverifiable.length} tétel nem ellenőrizhető vagy kézi rögzítésre vár (pl. {unverifiable.slice(0, 3).map((f) => checks[f.checkId].title).join(', ')}) –{' '}
              <a href={`#/audit/${id}${round.n ? `/${round.n}` : ''}?tab=manual`}>lásd a Kézi teendők fület</a>.
            </li>
          )}
        </ul>
      </div>

      <Legend sections={['scores', 'status', 'evidence']} open />

      <div className="grid cols-3">
        <ScoreTile title="Bing / Copilot" score={s.surfaces.bing.score} coverage={s.surfaces.bing.coverage} />
        <ScoreTile title="ChatGPT" score={s.surfaces.chatgpt.score} coverage={s.surfaces.chatgpt.coverage} />
        <ScoreTile title="Összesített" score={s.overall} coverage={Math.round((s.surfaces.bing.coverage + s.surfaces.chatgpt.coverage) / 2)} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <p className="label">Témakörök</p>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke="var(--grid)" />
                <PolarAngleAxis dataKey="topic" tick={{ fontSize: 11, fill: '#52514e' }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#898781' }} tickCount={5} axisLine={false} />
                <Radar dataKey="score" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.15} dot={{ r: 4, fill: 'var(--series-1)' }} />
                <Tooltip
                  formatter={(_v, _n, item) => {
                    const p = (item as { payload: (typeof radarData)[number] }).payload;
                    return [p.real === null || p.real === undefined ? 'nincs adat' : `${p.real}/100 · lefedettség ${p.coverage}%`, 'Pontszám'];
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card flat">
          <table className="t">
            <thead>
              <tr>
                <th>Témakör</th>
                <th style={{ width: 160 }}>Pontszám</th>
                <th className="num">Lefedettség</th>
              </tr>
            </thead>
            <tbody>
              {TOPICS.map((t) => {
                const ts = s.topics.find((x) => x.topic === t.id)!;
                return (
                  <tr key={t.id}>
                    <td>
                      {t.n}. {t.title}
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <b style={{ width: 28 }} className={`band-${band(ts.score).cls}`}>
                          {ts.score ?? '—'}
                        </b>
                        <div style={{ flex: 1 }}>
                          <Meter value={ts.score} />
                        </div>
                      </div>
                    </td>
                    <td className="num">{ts.coverage}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '12px 16px' }}>
            <p className="small muted" style={{ margin: '0 0 6px' }}>
              Ellenőrzések állapota ({totalCount})
            </p>
            <div className="bar-stack" role="img" aria-label="Ellenőrzések állapot szerint">
              {STATUS_ORDER.filter((k) => s.counts[k]).map((k) => (
                <div key={k} title={`${STATUS_LABEL[k]}: ${s.counts[k]}`} style={{ flex: s.counts[k], background: STATUS_COLOR[k] }} />
              ))}
            </div>
            <div className="legend" style={{ marginTop: 8 }}>
              {STATUS_ORDER.filter((k) => s.counts[k]).map((k) => (
                <span key={k}>
                  <i style={{ background: STATUS_COLOR[k] }} />
                  {STATUS_LABEL[k]} {s.counts[k]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card flat">
        <div style={{ padding: '16px 20px 8px' }}>
          <p className="label">Kulcsadat-mátrix</p>
          <p className="small muted" style={{ margin: 0 }}>
            Hol olvasható ki gépileg az egyes kulcsadat? {round.findings['html.keydata'] && <StatusBadge s={effective(round.findings['html.keydata'])} />}
          </p>
        </div>
        {keyRows.length ? (
          <div className="table-wrap">
            <table className="t heat">
              <thead>
                <tr>
                  <th>Kulcsadat</th>
                  <th>Mintaérték</th>
                  <th>Nyers HTML (JS nélkül)</th>
                  <th>Renderelt DOM</th>
                  <th>JSON-LD</th>
                  <th>Csak alt/kép</th>
                  <th>ChatGPT-User</th>
                </tr>
              </thead>
              <tbody>
                {keyRows.map((k) => (
                  <tr key={k.label}>
                    <td>
                      <b>{k.label}</b>
                    </td>
                    <td className="small">{k.value || <span className="muted">nincs megadva</span>}</td>
                    <Cell v={k.raw} />
                    <Cell v={k.rendered} />
                    <Cell v={k.jsonld} />
                    {k.alt === null ? <td className="cell na">—</td> : <td className={`cell ${k.alt && !k.raw ? 'warn' : 'na'}`}>{k.alt ? 'alt-ban is' : '—'}</td>}
                    <Cell v={k.chatgptUser} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted" style={{ padding: '0 20px 16px' }}>
            Nincs kulcsadat megadva. A bemenetet a „Körök és napló” fülön szerkesztheted.
          </p>
        )}
      </div>

    </div>
  );
}
