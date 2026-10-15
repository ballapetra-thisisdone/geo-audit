import { useState } from 'react';
import { api } from '../api';
import { emptyInput, InputForm } from '../components/InputForm';
import { toast } from '../components/ui';
import { go } from '../App';

export function NewAudit() {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="header-block">
        <div className="stripe" />
        <div>
          <p className="label">Új audit</p>
          <h1 className="title">Mit vizsgálunk?</h1>
          <p className="sub">Az első kör azonnal elindul: bot user-agentes lekérések, renderelés, robots.txt, sitemap és a gépi ellenőrzések.</p>
        </div>
      </div>
      <InputForm
        initial={emptyInput()}
        submitLabel="Audit indítása"
        busy={busy}
        onSubmit={async (input, saved) => {
          setBusy(true);
          try {
            const { id } = await api.createAudit(input, saved);
            go(`/audit/${id}`);
          } catch (e) {
            toast((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
