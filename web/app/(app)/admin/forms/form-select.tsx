"use client";

import { useMemo, useState } from "react";

export type FormChoice = { id: string; name: string; page: string | null; leads: number | null; created: string | null; mappedAs?: string | null };

// A searchable pick-one list: Meta can have hundreds of forms, so a plain dropdown is unusable.
export function FormSelect({ options, initial, onPick }: { options: FormChoice[]; initial?: string; onPick?: (name: string) => void }) {
  const [picked, setPicked] = useState<string>(initial ?? "");
  const [q, setQ] = useState("");
  const shown = useMemo(() => options.filter((o) => !q || `${o.name} ${o.page ?? ""} ${o.id}`.toLowerCase().includes(q.toLowerCase())), [options, q]);
  const sel = options.find((o) => o.id === picked);
  const dateOf = (c: string | null) => (c ? new Date(c).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" }) : null);
  return (
    <div>
      <label className="label">Facebook form{sel ? `: ${sel.name}` : ""}</label>
      <input type="hidden" name="form_id" value={picked} />
      <input type="hidden" name="form_name" value={sel?.name ?? ""} />
      <input value={q} onChange={(e) => setQ(e.target.value)} className="input h-8 max-w-sm text-[12.5px]" placeholder="Search forms" aria-label="Search forms" />
      <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-line/10 bg-white/[.03] p-1">
        {shown.length === 0 && <li className="px-2 py-1.5 text-[12.5px] text-mute">No forms match.</li>}
        {shown.slice(0, 150).map((o) => (
          <li key={o.id}>
            <label className={`flex items-start gap-2 rounded px-2 py-1 text-[12.5px] ${o.mappedAs ? "opacity-50" : "cursor-pointer hover:bg-white/[.05]"}`}>
              <input type="radio" name="_form_pick" disabled={!!o.mappedAs} checked={picked === o.id} onChange={() => { setPicked(o.id); onPick?.(o.name); }} className="mt-0.5 h-3.5 w-3.5" />
              <span className="min-w-0 flex-1">{o.name}<span className="text-mute"> · {o.page ?? "Page"}{o.created ? ` · made ${dateOf(o.created)}` : ""}{o.leads != null ? ` · ${o.leads} leads` : ""}{o.mappedAs ? ` · already mapped as "${o.mappedAs}"` : ""}</span></span>
            </label>
          </li>
        ))}
        {shown.length > 150 && <li className="px-2 py-1.5 text-[12px] text-mute">Showing the first 150. Type in the search box to narrow it.</li>}
      </ul>
    </div>
  );
}
