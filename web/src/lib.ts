import type { Finding, Status } from '../../shared/types';

export const effective = (f?: Finding): Status => f?.override?.status ?? f?.status ?? 'unverifiable';

export function downloadText(name: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function toCsv(rows: (string | number | undefined | null)[][]) {
  const esc = (v: string | number | undefined | null) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Pontosvessző + BOM: a magyar Excel így nyitja meg helyesen.
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}
