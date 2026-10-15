import { useEffect, useState } from 'react';
import { api, type ConfigPayload } from '../api';
import { ChipSelect, Drawer, SurfaceTags, toast } from '../components/ui';
import { TOPICS, type BacklogTemplate, type CheckDef, type QuestionTemplate, type RunnerKind, type Surface, type TopicId } from '../../../shared/types';

const RUNNER_LABEL: Record<RunnerKind, string> = { auto: 'automatikus', manual: 'kézi', llm: 'AI (2. fázis)' };
const emptyBacklog = (): BacklogTemplate => ({
  title: '',
  category: 'AI-láthatóság',
  owner: 'fejlesztő',
  implementation: '',
  change: '',
  benefit: '',
  priority: 'közepes',
  effort: 'S',
  effortReason: '',
  verification: '',
});

function CheckEditor({ check, cfg, onSave, onClose, isNew }: { check: CheckDef; cfg: ConfigPayload; onSave: (c: CheckDef) => void; onClose: () => void; isNew: boolean }) {
  const [c, setC] = useState<CheckDef>(check);
  const set = <K extends keyof CheckDef>(k: K, v: CheckDef[K]) => setC((p) => ({ ...p, [k]: v }));
  const b = c.backlog;
  const setB = <K extends keyof BacklogTemplate>(k: K, v: BacklogTemplate[K]) => setC((p) => ({ ...p, backlog: { ...(p.backlog ?? emptyBacklog()), [k]: v } }));

  return (
    <Drawer onClose={onClose}>
      <p className="label">{isNew ? 'Új ellenőrzés' : `Ellenőrzés szerkesztése · v${check.version}`}</p>
      <h2>{c.title || 'Névtelen'}</h2>
      <div className="stack">
        <div className="grid cols-2">
          <label className="field">
            <span>Azonosító</span>
            <input type="text" value={c.id} disabled={!isNew} onChange={(e) => set('id', e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, '-'))} />
            <small>pl. ai.price-table – nem módosítható később</small>
          </label>
          <label className="field">
            <span>Cím</span>
            <input type="text" value={c.title} onChange={(e) => set('title', e.target.value)} />
          </label>
          <label className="field">
            <span>Témakör</span>
            <select value={c.topic} onChange={(e) => set('topic', e.target.value as TopicId)}>
              {TOPICS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.n}. {t.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Modul</span>
            <select value={c.module} onChange={(e) => set('module', e.target.value)}>
              {cfg.modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Futtató</span>
            <select value={c.runner} onChange={(e) => set('runner', e.target.value as RunnerKind)}>
              {(Object.keys(RUNNER_LABEL) as RunnerKind[]).map((r) => (
                <option key={r} value={r}>
                  {RUNNER_LABEL[r]}
                </option>
              ))}
            </select>
            <small>Kézi: kód nélkül felvehető, az eredményt a felületen rögzíted.</small>
          </label>
          {c.runner === 'auto' && (
            <label className="field">
              <span>Futtató kulcs (impl)</span>
              <select value={c.impl ?? ''} onChange={(e) => set('impl', e.target.value)}>
                <option value="">—</option>
                {cfg.runnerKeys.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <small>Új automatikus futtató: server/checks/runners.ts</small>
            </label>
          )}
          <label className="field">
            <span>Súly (0–5)</span>
            <input type="number" min={0} max={5} value={c.weight} onChange={(e) => set('weight', Number(e.target.value))} />
          </label>
          <div className="field">
            <span>Érintett felület</span>
            <ChipSelect<Surface>
              options={[
                { v: 'bing', l: 'Bing/Copilot' },
                { v: 'chatgpt', l: 'ChatGPT' },
                { v: 'other', l: 'Egyéb AI' },
              ]}
              value={c.surfaces}
              onChange={(v) => set('surfaces', v)}
            />
          </div>
        </div>
        <label className="field">
          <span>Leírás (mit vizsgál)</span>
          <textarea value={c.description} onChange={(e) => set('description', e.target.value)} />
        </label>
        {c.runner !== 'auto' && (
          <label className="field">
            <span>Hogyan ellenőrizd (kézi útmutató)</span>
            <textarea value={c.howTo ?? ''} onChange={(e) => set('howTo', e.target.value)} />
          </label>
        )}
        <div className="field">
          <span>Források (soronként: cím | URL | ellenőrizve ÉÉÉÉ-HH-NN)</span>
          <textarea
            value={c.sources.map((s) => [s.title, s.url, s.checked ?? ''].join(' | ')).join('\n')}
            onChange={(e) =>
              set(
                'sources',
                e.target.value
                  .split('\n')
                  .map((l) => l.split('|').map((x) => x.trim()))
                  .filter((p) => p[1])
                  .map(([title, url, checked]) => ({ title, url, checked: checked || undefined, official: true })),
              )
            }
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={c.experimental ?? false} onChange={(e) => set('experimental', e.target.checked)} />
          <span>Kísérleti (nem dokumentált hatás)</span>
        </label>

        <details open={!!b}>
          <summary>Backlog-sablon (hiba vagy figyelmeztetés esetén ebből lesz a tétel)</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            <div className="grid cols-2">
              <label className="field">
                <span>Tétel címe</span>
                <input type="text" value={b?.title ?? ''} onChange={(e) => setB('title', e.target.value)} />
              </label>
              <label className="field">
                <span>Kategória</span>
                <select value={b?.category ?? 'AI-láthatóság'} onChange={(e) => setB('category', e.target.value as BacklogTemplate['category'])}>
                  {['Hibajavítás', 'SEO/indexelés', 'Strukturált adat', 'AI-láthatóság', 'Tartalom/IA', 'Kísérleti'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Felelős</span>
                <select value={b?.owner ?? 'fejlesztő'} onChange={(e) => setB('owner', e.target.value as BacklogTemplate['owner'])}>
                  {['fejlesztő', 'ügyfél', 'mindkettő'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Megvalósítás (HTML/JSON-LD/PHP/CMS/header/robots/WAF)</span>
                <input type="text" value={b?.implementation ?? ''} onChange={(e) => setB('implementation', e.target.value)} />
              </label>
              <label className="field">
                <span>Prioritás</span>
                <select value={b?.priority ?? 'közepes'} onChange={(e) => setB('priority', e.target.value as BacklogTemplate['priority'])}>
                  {['kritikus', 'magas', 'közepes', 'alacsony'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Ráfordítás</span>
                <select value={b?.effort ?? 'S'} onChange={(e) => setB('effort', e.target.value as BacklogTemplate['effort'])}>
                  {['S', 'M', 'L'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Javasolt változtatás</span>
              <textarea value={b?.change ?? ''} onChange={(e) => setB('change', e.target.value)} />
            </label>
            <div className="grid cols-2">
              <label className="field">
                <span>Várható előny</span>
                <input type="text" value={b?.benefit ?? ''} onChange={(e) => setB('benefit', e.target.value)} />
              </label>
              <label className="field">
                <span>Ráfordítás indoka</span>
                <input type="text" value={b?.effortReason ?? ''} onChange={(e) => setB('effortReason', e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Ellenőrzés (hogyan igazolható a javítás)</span>
              <input type="text" value={b?.verification ?? ''} onChange={(e) => setB('verification', e.target.value)} />
            </label>
            {b && (
              <div>
                <button type="button" className="btn sm ghost" onClick={() => setC((p) => ({ ...p, backlog: undefined }))}>
                  Backlog-sablon eltávolítása
                </button>
              </div>
            )}
          </div>
        </details>

        <div className="row">
          <button className="btn primary" disabled={!c.id || !c.title} onClick={() => onSave({ ...c, version: isNew ? 1 : check.version + 1 })}>
            Mentés {isNew ? '' : `(v${check.version + 1})`}
          </button>
          <button className="btn ghost" onClick={onClose}>
            Mégse
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function TemplateEditor({ templates, onSave }: { templates: QuestionTemplate[]; onSave: (t: QuestionTemplate[]) => void }) {
  const [t, setT] = useState(templates);
  return (
    <div className="card stack">
      <p className="label">Kérdéssablonok</p>
      <p className="small muted" style={{ margin: 0 }}>
        Új auditnál ezekből indul a kérdéslista. A [szögletes] helyőrzők: [entitás], [szervezet], [kategória], [szolgáltatás/termék] automatikusan kitöltődnek.
      </p>
      {t.map((q, i) => (
        <div key={q.id} className="row" style={{ flexWrap: 'nowrap' }}>
          <select style={{ width: 150 }} value={q.kind} onChange={(e) => setT(t.map((x, j) => (j === i ? { ...x, kind: e.target.value as QuestionTemplate['kind'] } : x)))}>
            <option value="search">keresési</option>
            <option value="conversational">társalgási</option>
          </select>
          <input type="text" value={q.text} onChange={(e) => setT(t.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <button className="btn sm ghost" onClick={() => setT(t.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <button className="btn sm" onClick={() => setT([...t, { id: `t-${Date.now().toString(36)}`, kind: 'search', text: '' }])}>
          + Sablon
        </button>
        <button className="btn primary sm" onClick={() => onSave(t)}>
          Sablonok mentése
        </button>
      </div>
    </div>
  );
}

export function CheckLibrary() {
  const [cfg, setCfg] = useState<ConfigPayload | null>(null);
  const [edit, setEdit] = useState<{ c: CheckDef; isNew: boolean } | null>(null);
  const load = () => api.config().then(setCfg).catch((e) => toast(e.message, true));
  useEffect(() => void load(), []);
  if (!cfg) return <div className="empty"><span className="spinner" /></div>;

  const save = async (checks: CheckDef[]) => {
    try {
      await api.saveChecks(checks);
      toast('Ellenőrzés-könyvtár mentve. Meglévő körre a „Körök” fülön, az „Újrafuttatás az aktuális könyvtárral” gombbal alkalmazható.');
      await load();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <>
      <div className="header-block">
        <div className="stripe" />
        <div style={{ flex: 1 }}>
          <p className="label">Bővíthető vizsgálat</p>
          <h1 className="title">Ellenőrzés-könyvtár</h1>
          <p className="sub">
            {cfg.checks.length} ellenőrzés, {cfg.modules.length} modul. A könyvtár a <code>config/checks.json</code> fájlban él, verziózott, és git-be tehető.
          </p>
        </div>
        <div className="row" style={{ alignSelf: 'flex-start' }}>
          <button
            className="btn primary"
            onClick={() =>
              setEdit({
                isNew: true,
                c: { id: '', version: 1, title: '', topic: 'ai', surfaces: ['bing', 'chatgpt'], weight: 2, runner: 'manual', module: 'core', enabled: true, description: '', sources: [] },
              })
            }
          >
            + Új ellenőrzés
          </button>
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        {TOPICS.map((t) => (
          <div key={t.id} className="card flat">
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--ultra)' }}>
              <p className="label">{t.n}. témakör</p>
              <h3 style={{ margin: 0 }}>{t.title}</h3>
            </div>
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Aktív</th>
                  <th>Ellenőrzés</th>
                  <th>Felület</th>
                  <th>Futtató</th>
                  <th>Modul</th>
                  <th className="num">Súly</th>
                  <th>Backlog</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cfg.checks
                  .filter((c) => c.topic === t.id)
                  .map((c) => (
                    <tr key={c.id} style={{ opacity: c.enabled ? 1 : 0.5 }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={c.enabled}
                          style={{ accentColor: 'var(--orange)' }}
                          onChange={(e) => void save(cfg.checks.map((x) => (x.id === c.id ? { ...x, enabled: e.target.checked } : x)))}
                        />
                      </td>
                      <td>
                        <b>{c.title}</b> {c.experimental && <span className="tag orange">kísérleti</span>}
                        <div className="small muted">
                          {c.id} · v{c.version}
                        </div>
                      </td>
                      <td>
                        <SurfaceTags surfaces={c.surfaces} />
                      </td>
                      <td className="small">
                        {RUNNER_LABEL[c.runner]}
                        {c.impl ? <div className="muted">{c.impl}</div> : null}
                      </td>
                      <td className="small">{cfg.modules.find((m) => m.id === c.module)?.title ?? c.module}</td>
                      <td className="num">{c.weight}</td>
                      <td className="small">{c.backlog ? c.backlog.priority : '—'}</td>
                      <td>
                        <button className="btn sm ghost" onClick={() => setEdit({ c, isNew: false })}>
                          Szerkesztés
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}

        <TemplateEditor
          templates={cfg.templates}
          onSave={async (tpl) => {
            try {
              await api.saveTemplates(tpl);
              toast('Sablonok mentve.');
              await load();
            } catch (e) {
              toast((e as Error).message, true);
            }
          }}
        />

        <div className="card flat">
          <div style={{ padding: '14px 20px' }}>
            <p className="label">Robotok</p>
            <p className="small muted" style={{ margin: 0 }}>
              A <code>config/bots.json</code> fájlban. Az UA-sztringeket a hivatalos dokumentáció alapján kell frissíteni.
            </p>
          </div>
          <table className="t">
            <thead>
              <tr>
                <th>Robot</th>
                <th>Cél</th>
                <th>Lekérjük?</th>
                <th>User-agent</th>
                <th>Forrás</th>
              </tr>
            </thead>
            <tbody>
              {cfg.bots.map((b) => (
                <tr key={b.id}>
                  <td>
                    <b>{b.name}</b>
                    <div className="small muted">{b.owner}</div>
                  </td>
                  <td className="small">{b.purpose}</td>
                  <td>{b.fetch ? 'igen' : 'csak robots.txt'}</td>
                  <td className="small">
                    <code style={{ wordBreak: 'break-all' }}>{b.ua ?? b.token}</code>
                  </td>
                  <td className="small">
                    {b.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                        {s.checked ? `ellenőrizve ${s.checked}` : 'dokumentáció'}
                      </a>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <CheckEditor
          check={edit.c}
          cfg={cfg}
          isNew={edit.isNew}
          onClose={() => setEdit(null)}
          onSave={(c) => {
            setEdit(null);
            void save(edit.isNew ? [...cfg.checks, c] : cfg.checks.map((x) => (x.id === c.id ? c : x)));
          }}
        />
      )}
    </>
  );
}
