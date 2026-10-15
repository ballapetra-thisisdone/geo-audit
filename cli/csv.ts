export function toCsv(rows: (string | number | undefined | null)[][]) {
  const esc = (v: string | number | undefined | null) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Pontosvessző + BOM: a magyar Excel így nyitja meg helyesen.
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}
