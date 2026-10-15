import { useEffect, useState } from 'react';
import { api, type SampleGroup } from '../../api';
import { CodeBlock, toast } from '../../components/ui';
import type { TabProps } from '../AuditView';

export function Samples({ id, round }: TabProps) {
  const [groups, setGroups] = useState<SampleGroup[] | null>(null);
  useEffect(() => {
    api.samples(id, round.n).then(setGroups).catch((e) => toast(e.message, true));
  }, [id, round.n]);
  if (!groups) return <div className="empty"><span className="spinner" /></div>;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="notice neutral small">
        D. Kódminták – <b>szemléltető jellegűek</b>. A <code>&lt;&lt;…&gt;&gt;</code> helyőrzőket valós, az oldalon igazolható adatra kell cserélni. Ne kerüljön
        a sémába kitalált ár, értékelés vagy dátum.
      </div>
      {groups.map((g) => (
        <div key={g.id} className="card">
          <p className="label">{g.title}</p>
          <p className="small muted">{g.note}</p>
          {g.snippets.map((s, i) => (
            <CodeBlock key={i} snippet={s} />
          ))}
        </div>
      ))}
    </div>
  );
}
