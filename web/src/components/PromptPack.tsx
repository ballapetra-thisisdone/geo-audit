// Beilleszthető promptok a kézi ChatGPT- / Copilot-teszthez.
// A fő kérdés szándékosan változatlan: úgy kell feltenni, ahogy egy valódi érdeklődő tenné.
import { useState } from 'react';
import type { Round } from '../../../shared/types';
import { hasPlaceholder, SOURCES_FOLLOWUP, urlReadPrompt as urlPrompt } from '../../../shared/prompts';

const urlReadPrompt = (round: Round) => urlPrompt(round.input);

function CopyBtn({ text, label = 'Másolás', disabled }: { text: string; label?: string; disabled?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="btn sm"
      disabled={disabled}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      {ok ? 'Másolva ✓' : label}
    </button>
  );
}

export function PromptPack({ round, surface, onEditQuestions }: { round: Round; surface: 'chatgpt' | 'copilot'; onEditQuestions: () => void }) {
  const qs = round.questions.filter((q) => q.text.trim());
  const ready = qs.filter((q) => !hasPlaceholder(q.text));
  const name = surface === 'chatgpt' ? 'ChatGPT' : 'Copilot';

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="notice neutral small">
        <b>Így használd:</b> minden kérdést <b>új beszélgetésben</b> tegyél fel{surface === 'chatgpt' ? ', bekapcsolt kereséssel' : ''}. Előbb a kérdést másold be
        változtatás nélkül, és csak a válasz után a forráskérő promptot. A kérdésbe ne írd bele a weboldal nevét, ha a valódi érdeklődő sem írná – különben a teszt
        nem azt méri, amit kell.
      </div>

      <div>
        <h3>1. Kérdések ({ready.length} beilleszthető)</h3>
        {qs.length > ready.length && (
          <p className="small" style={{ color: '#9d2222', marginTop: 0 }}>
            {qs.length - ready.length} kérdésben kitöltetlen [helyőrző] van. Ezeket valós adattal kell kitölteni (pl. a valódi helyszín, ár) a{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onEditQuestions();
              }}
            >
              Kérdések fülön
            </a>
            , addig nem másolhatók.
          </p>
        )}
        <div className="card flat" style={{ margin: 0 }}>
          <table className="t">
            <tbody>
              {qs.map((q, i) => {
                const ph = hasPlaceholder(q.text);
                const done = q.results.some((r) => r.surface === surface);
                return (
                  <tr key={q.id}>
                    <td className="muted" style={{ width: 30 }}>
                      {i + 1}
                    </td>
                    <td>
                      {q.text}
                      <div className="small muted">
                        {q.kind === 'search' ? 'keresési' : 'társalgási'}
                        {done ? ` · ${name}-eredmény rögzítve ✓` : ''}
                        {ph ? ' · kitöltendő helyőrző' : ''}
                      </div>
                    </td>
                    <td style={{ width: 110, textAlign: 'right' }}>
                      <CopyBtn text={q.text} disabled={ph} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <CopyBtn text={ready.map((q, i) => `${i + 1}. ${q.text}`).join('\n')} label="Teljes lista másolása (jegyzetnek)" disabled={!ready.length} />
          <span className="small muted">A listát ne egyben illeszd be a {name}-be – kérdésenként külön beszélgetés kell.</span>
        </div>
      </div>

      <div>
        <h3>2. Forráskérő követő prompt (minden válasz után)</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Ugyanabban a beszélgetésben, a válasz után. Megkönnyíti a rögzítést, de a döntő a válasznál ténylegesen megjelenített forráslista.
        </p>
        <pre className="code" style={{ whiteSpace: 'pre-wrap' }}>{SOURCES_FOLLOWUP}</pre>
        <div style={{ marginTop: 6 }}>
          <CopyBtn text={SOURCES_FOLLOWUP} />
        </div>
      </div>

      <div>
        <h3>3. URL-olvasási teszt (egyszer, új beszélgetésben)</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Azt méri, mit tud kiolvasni a {name} az oldalból, ha egy felhasználó beilleszti a linket
          {surface === 'chatgpt' ? ' (ezt a ChatGPT-User robot kéri le)' : ''}. A választ vesd össze az oldallal: ami „nem található” vagy hibás, az a
          kulcsadat-mátrixszal együtt backlog-tétel.
        </p>
        <pre className="code" style={{ whiteSpace: 'pre-wrap' }}>{urlReadPrompt(round)}</pre>
        <div style={{ marginTop: 6 }}>
          <CopyBtn text={urlReadPrompt(round)} />
        </div>
      </div>

      <p className="small muted" style={{ margin: 0 }}>
        A pontosságot mindig te ellenőrzöd az oldallal összevetve – a {name} saját állítását a forrásairól nem tekintjük bizonyítéknak.
      </p>
    </div>
  );
}
