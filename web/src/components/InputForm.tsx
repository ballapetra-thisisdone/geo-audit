import { useEffect, useState } from 'react';
import { api, readFileAsText, type SavedHtml } from '../api';
import type { AuditInput, KeyDatum, ModuleDef } from '../../../shared/types';

const PAGE_TYPES = ['projektoldal', 'termékoldal', 'eseményoldal', 'szolgáltatásoldal', 'kategóriaoldal', 'főoldal', 'cikk', 'kapcsolat / helyszín'];
const ENTITY_TYPES = ['ingatlanprojekt', 'termék', 'esemény', 'szolgáltatás', 'szervezet', 'képzés', 'szálláshely', 'egészségügyi kezelés', 'étterem', 'hely / helyszín'];
const KEY_PRESETS = ['ár', 'elérhetőség', 'méret', 'dátum', 'helyszín', 'kapacitás', 'feltételek', 'nyitvatartás', 'kapcsolat'];

export const emptyInput = (): AuditInput => ({
  url: '',
  name: '',
  org: '',
  pageType: '',
  entityType: '',
  cms: 'nem ismert',
  languages: ['hu'],
  keyData: [{ label: 'ár' }, { label: 'helyszín' }],
  modules: [],
  notes: '',
});

export function InputForm({
  initial,
  onSubmit,
  submitLabel,
  withUpload = true,
  busy,
}: {
  initial: AuditInput;
  onSubmit: (input: AuditInput, saved?: SavedHtml) => void;
  submitLabel: string;
  withUpload?: boolean;
  busy?: boolean;
}) {
  const [v, setV] = useState<AuditInput>(initial);
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [saved, setSaved] = useState<SavedHtml | undefined>();
  const set = <K extends keyof AuditInput>(k: K, val: AuditInput[K]) => setV((p) => ({ ...p, [k]: val }));

  useEffect(() => {
    api.config().then((c) => {
      const ext = c.modules.filter((m) => m.id !== 'core');
      setModules(ext);
      // Új auditnál az alapértelmezetten bekapcsolt modulok.
      setV((p) => (p.modules.length || initial.url ? p : { ...p, modules: ext.filter((m) => m.defaultOn).map((m) => m.id) }));
    });
  }, [initial.url]);

  const setKey = (i: number, patch: Partial<KeyDatum>) => set('keyData', v.keyData.map((k, j) => (j === i ? { ...k, ...patch } : k)));

  return (
    <form
      className="stack"
      style={{ gap: 20 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v, saved);
      }}
    >
      <div className="card stack">
        <p className="label">Vizsgált oldal</p>
        <label className="field">
          <span>Élő URL *</span>
          <input type="url" required placeholder="https://…" value={v.url} onChange={(e) => set('url', e.target.value)} />
        </label>
        <div className="grid cols-2">
          <label className="field">
            <span>Oldal / projekt neve</span>
            <input type="text" value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="pl. Duna Residence – C épület" />
          </label>
          <label className="field">
            <span>Szervezet neve (hivatalos forma)</span>
            <input type="text" value={v.org} onChange={(e) => set('org', e.target.value)} placeholder="pl. Példa Kft." />
          </label>
          <label className="field">
            <span>Oldaltípus</span>
            <input type="text" list="pagetypes" value={v.pageType} onChange={(e) => set('pageType', e.target.value)} />
            <datalist id="pagetypes">{PAGE_TYPES.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <label className="field">
            <span>Fő entitás típusa</span>
            <input type="text" list="entitytypes" value={v.entityType} onChange={(e) => set('entityType', e.target.value)} />
            <datalist id="entitytypes">{ENTITY_TYPES.map((p) => <option key={p} value={p} />)}</datalist>
            <small>Ebből választjuk ki a szóba jövő schema.org típusokat.</small>
          </label>
          <label className="field">
            <span>CMS / stack</span>
            <select value={v.cms} onChange={(e) => set('cms', e.target.value)}>
              {['WordPress', 'egyedi', 'Laravel', 'Nuxt / Next', 'Shopify', 'Webflow', 'nem ismert'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Nyelvi változatok</span>
            <input type="text" value={v.languages.join(', ')} onChange={(e) => set('languages', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
            <small>Vesszővel, az első a vizsgált oldal nyelve (pl. hu, en).</small>
          </label>
        </div>
      </div>

      <div className="card stack">
        <div>
          <p className="label">Kulcsadatok</p>
          <p className="small muted" style={{ margin: 0 }}>
            Ezeknek gépileg olvashatónak kell lenniük. A mintaértéket úgy add meg, ahogy az oldalon szerepel (pl. „89 900 Ft”, „2026. november 12.”): ezzel
            keressük a nyers HTML-ben, a renderelt DOM-ban, a JSON-LD-ben és a ChatGPT-User válaszában.
          </p>
        </div>
        {v.keyData.map((k, i) => (
          <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="text" style={{ maxWidth: 220 }} list="keypresets" value={k.label} placeholder="címke" onChange={(e) => setKey(i, { label: e.target.value })} />
            <input type="text" value={k.value ?? ''} placeholder="mintaérték az oldalról (opcionális, de ajánlott)" onChange={(e) => setKey(i, { value: e.target.value })} />
            <button type="button" className="btn sm ghost" onClick={() => set('keyData', v.keyData.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <datalist id="keypresets">{KEY_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
        <div>
          <button type="button" className="btn sm" onClick={() => set('keyData', [...v.keyData, { label: '' }])}>
            + Kulcsadat
          </button>
        </div>
      </div>

      <div className="card stack">
        <p className="label">Kiegészítő modulok</p>
        <div className="grid cols-2">
          {modules.map((m) => (
            <label key={m.id} className="check">
              <input
                type="checkbox"
                checked={v.modules.includes(m.id)}
                onChange={(e) => set('modules', e.target.checked ? [...v.modules, m.id] : v.modules.filter((x) => x !== m.id))}
              />
              <span>
                <b>{m.title}</b>
                <br />
                <span className="small muted">{m.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {withUpload && (
        <div className="card stack">
          <p className="label">Mentett HTML (opcionális)</p>
          <p className="small muted" style={{ margin: 0 }}>
            A böngészőből mentett oldal (Ctrl+S, „csak HTML”). Ellenőrizzük, hogy valóban a JS utáni DOM-e, a megnevezett oldal-e, és nem bejelentkezett
            felhasználó mentette-e.
          </p>
          <input
            type="file"
            accept=".html,.htm,text/html"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setSaved(f ? { fileName: f.name, html: await readFileAsText(f) } : undefined);
            }}
          />
          {saved && <span className="small">Betöltve: {saved.fileName} ({Math.round(saved.html.length / 1024)} KB)</span>}
        </div>
      )}

      <label className="field card">
        <span>Megjegyzés</span>
        <textarea value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Bármi, ami a vizsgálathoz fontos (pl. jelszavas staging, ismert WAF)." />
      </label>

      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? <span className="spinner" /> : null} {submitLabel}
        </button>
      </div>
    </form>
  );
}
