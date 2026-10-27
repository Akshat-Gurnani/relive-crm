"use client";
import { useState } from "react";
import { parseCsv } from "@/lib/csv";

// Reads the file in the browser, shows a preview and lets the user match columns; the server does the import.
export function ImportPicker({ fields }: { fields: { key: string; label: string; guess: string; flags: string }[] }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const header = rows[0] ?? [];
  const guess = (f: { guess: string; flags: string }) => {
    const re = new RegExp(f.guess, f.flags);
    const i = header.findIndex((h) => re.test(h.trim()));
    return i === -1 ? "" : String(i);
  };
  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-line/20 bg-white/[.02] px-4 py-8 text-center transition hover:border-accent/50 hover:bg-white/[.04]">
        <img src="/emoji/mailbox.svg" alt="" width={32} height={32} />
        <span className="font-medium">{name || "Choose a CSV file"}</span>
        <span className="text-[12px] text-mute">{rows.length ? `${rows.length - 1} rows, ${header.length} columns` : "Exported from Cratio, Excel (Save as CSV) or Google Sheets"}</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          const t = await f.text(); setText(t); setName(f.name); setRows(parseCsv(t));
        }} />
      </label>
      <input type="hidden" name="csv" value={text} />
      <input type="hidden" name="file_name" value={name} />
      {header.length > 0 && (
        <>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3" key={name}>
            {fields.map((f) => (
              <div key={f.key}>
                <label className="label" htmlFor={`map_${f.key}`}>{f.label}</label>
                <select id={`map_${f.key}`} name={`map_${f.key}`} defaultValue={guess(f)} className="input">
                  <option value="">Not in file</option>
                  {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-line/10">
            <table className="w-full text-[12px]">
              <thead><tr>{header.map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
              <tbody>{rows.slice(1, 4).map((r, i) => <tr key={i} className="row">{header.map((_, j) => <td key={j} className="td whitespace-nowrap text-mute">{r[j]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
