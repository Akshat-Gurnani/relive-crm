// Small RFC 4180 CSV parser and writer: quoted fields, embedded commas, quotes and new lines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}
const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows: unknown[][]) {
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
// Cratio and spreadsheet dates: "10-Oct-2026", "10-Oct-2026 06:35 PM", "10/10/2026", ISO. Read as India time.
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseLooseDate(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.length === 10 ? `${s}T00:00:00+05:30` : s;
  let m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
  let d: number, mo: number, y: number, h = 0, mi = 0;
  if (m) { d = +m[1]; mo = MON[m[2].toLowerCase()]; y = +m[3]; if (m[4]) { h = +m[4]; mi = +m[5]; if (m[7]) { const pm = m[7].toLowerCase() === "pm"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; } } }
  else {
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3]; if (m[4]) { h = +m[4]; mi = +m[5]; }
  }
  if (!mo || mo > 12 || d > 31) return null;
  if (y < 100) y += 2000;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00+05:30`;
}
