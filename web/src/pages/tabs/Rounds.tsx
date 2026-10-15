import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, readFileAsText, type SavedHtml } from '../../api';
import { InputForm } from '../../components/InputForm';
import { band, fmtDate, toast } from '../../components/ui';
import { go } from '../../App';
import type { TabProps } from '../AuditView';

export function Rounds({ id, round, summary, reload, setRound }: TabProps) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedHtml | undefined>();
  const [note, setNote] = useState('');
  const [editInput, setEditInput] = useState(false);

  const trend = summary.rounds.map((r) => ({
    kor: `${r.n}. kör`,
    bing: r.scores?.surfaces.bing.score ?? null,
    chatgpt: r.scores?.surfaces.chatgpt.score ?? null,
  }));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid cols-2">
        <div className="card stack">
          <p className="label">Új kör</p>
          <p className="small muted" style={{ margin: 0 }}>
            Újra begyűjti az adatokat (lekérések, renderelés, robots.txt…), és az aktuális ellenőrzés-könyvtárral fut. A kérdések, a saját megállapítások és a kézi
            ellenőrzések eredményei átkerülnek.
          </p>
          <label className="field">
            <span>Megjegyzés a körhöz</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="pl. robots.txt javítás után" />
          </label>
          <label className="field">
            <span>Mentett HTML (opcionális)</span>
            <input
              type="file"
              accept=".html,.htm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setSaved(f ? { fileName: f.name, html: await readFileAsText(f) } : undefined);
              }}
            />
          </label>
          <div>
            <button
              className="btn dark"
              disabled={busy || round.status === 'running'}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.newRound(id, { savedHtml: saved, note: note || undefined });
                  go(`/audit/${id}?tab=rounds`);
                  await reload();
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Új kör indítása
            </button>
          </div>
        </div>
        <div className="card stack">
          <p className="label">A jelenlegi kör módosítása</p>
          <p className="small muted" style={{ margin: 0 }}>
            Új adatgyűjtés nélkül: a {round.n}. kör begyűjtött adatain újrafuttatja az összes ellenőrzést az ellenőrzés-könyvtár aktuális állapotával. Így az új vagy
            módosított ellenőrzések erre a körre is érvényesek lesznek. A kézi felülírások megmaradnak.
          </p>
          <div>
            <button
              className="btn"
              disabled={busy || round.status !== 'done'}
              onClick={async () => {
                setBusy(true);
                try {
                  setRound(await api.rerun(id, round.n, { refreshChecks: true }));
                  toast('Ellenőrzések újrafuttatva az aktuális könyvtárral.');
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              ↻ Újrafuttatás az aktuális könyvtárral
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Egyes ellenőrzések a „Részletes audit” fülön külön is újrafuttathatók és felülírhatók. Új kérdés a „Kérdések” fülön, saját megállapítás témakörönként
            vehető fel.
          </p>
        </div>
      </div>

      {summary.rounds.length > 1 && (
        <div className="card">
          <p className="label">Trend körönként</p>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 16, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="kor" tick={{ fontSize: 12, fill: '#898781' }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#898781' }} axisLine={false} tickLine={false} width={36} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line name="Bing/Copilot" dataKey="bing" stroke="#2a78d6" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                <Line name="ChatGPT" dataKey="chatgpt" stroke="#eb6834" strokeWidth={2} dot={{ r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card flat">
        <table className="t">
          <thead>
            <tr>
              <th>Kör</th>
              <th>Indítva</th>
              <th>Állapot</th>
              <th className="num">Bing/Copilot</th>
              <th className="num">ChatGPT</th>
              <th className="num">Hiba / figy.</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...summary.rounds].reverse().map((r) => (
              <tr key={r.n} style={{ background: r.n === round.n ? 'var(--orange-soft)' : undefined }}>
                <td>
                  <b>{r.n}.</b>
                </td>
                <td>{fmtDate(r.createdAt)}</td>
                <td>{r.status === 'done' ? 'kész' : r.status === 'running' ? 'fut' : 'hiba'}</td>
                <td className={`num band-${band(r.scores?.surfaces.bing.score ?? null).cls}`}>{r.scores?.surfaces.bing.score ?? '—'}</td>
                <td className={`num band-${band(r.scores?.surfaces.chatgpt.score ?? null).cls}`}>{r.scores?.surfaces.chatgpt.score ?? '—'}</td>
                <td className="num">
                  {r.scores ? `${r.scores.counts.fail} / ${r.scores.counts.warn}` : '—'}
                </td>
                <td>
                  {r.n !== round.n && (
                    <a className="btn sm ghost" href={`#/audit/${id}/${r.n}?tab=overview`}>
                      Megnyitás
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card stack">
        <div className="row between">
          <p className="label" style={{ margin: 0 }}>
            Bemenet
          </p>
          <button className="btn sm" onClick={() => setEditInput(!editInput)}>
            {editInput ? 'Bezárás' : 'Szerkesztés (a következő körre)'}
          </button>
        </div>
        {editInput ? (
          <InputForm
            initial={summary.input}
            withUpload={false}
            submitLabel="Bemenet mentése"
            onSubmit={async (input) => {
              try {
                await api.updateInput(id, input);
                toast('Mentve. A következő körben lép érvénybe.');
                setEditInput(false);
                await reload();
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          />
        ) : (
          <dl className="kv">
            <dt>Kör megjegyzése</dt>
            <dd>{round.note ?? '—'}</dd>
            <dt>CMS / stack</dt>
            <dd>{round.input.cms}</dd>
            <dt>Fő entitás</dt>
            <dd>{round.input.entityType || '—'}</dd>
            <dt>Nyelvek</dt>
            <dd>{round.input.languages.join(', ')}</dd>
            <dt>Kulcsadatok</dt>
            <dd>{round.input.keyData.map((k) => `${k.label}${k.value ? ` („${k.value}”)` : ''}`).join(' · ') || '—'}</dd>
            <dt>Modulok</dt>
            <dd>{round.input.modules.join(', ') || 'csak alap'}</dd>
            <dt>Mentett HTML</dt>
            <dd>{round.artifacts?.saved?.fileName ?? '—'}</dd>
          </dl>
        )}
      </div>

      <div className="card">
        <p className="label">Napló – {round.n}. kör</p>
        <div className="log">
          {round.log.map((l, i) => (
            <div key={i} className={l.level}>
              {new Date(l.t).toLocaleTimeString('hu-HU')} {l.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
