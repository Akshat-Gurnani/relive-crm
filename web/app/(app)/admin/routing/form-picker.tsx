"use client";

import { useMemo, useState } from "react";

export type FormOpt = { id: string; name: string; page: string | null; leads: number | null; status: string | null; created: string | null; live?: boolean };

// A searchable checklist: Meta can have hundreds of forms, so a plain multi-select is unusable.
export function FormPicker({ options, selected }: { options: FormOpt[]; selected?: string[] }) {
  const known = useMemo(() => new Set(options.map((o) => o.id)), [options]);
  const [picked, setPicked] = useState<Set<string>>(new Set((selected ?? []).filter((s) => known.has(s))));
  const [q, setQ] = useState("");
  const [days, setDays] = useState(90);
  const anyLive = options.some((o) => o.live);
  const [liveOnly, setLiveOnly] = useState(true);
  const extra = (selected ?? []).filter((s) => !known.has(s));
  const cutoff = days > 0 ? Date.now() - days * 86_400_000 : 0;
  const shown = options.filter((o) => (picked.has(o.id) || (anyLive && liveOnly ? o.live : (!o.created || new Date(o.created).getTime() >= cutoff))) && (!q || `${o.name} ${o.page ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const dateOf = (c: string | null) => (c ? new Date(c).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" }) : null);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="sm:col-span-2 lg:col-span-4">
      <label className="label">Lead forms{picked.size ? ` (${picked.size} chosen)` : ""}</label>
      {[...picked].map((id) => <input key={id} type="hidden" name="form_ids" value={id} />)}
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} className="input h-8 max-w-xs text-[12.5px]" placeholder="Search forms" aria-label="Search forms" />
        {anyLive && <label className="flex items-center gap-1.5 text-[12px] text-mute"><input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} className="h-3.5 w-3.5" />Only forms used by live ads</label>}
        {!(anyLive && liveOnly) && <label className="flex items-center gap-1.5 text-[12px] text-mute">Created in the last
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input h-8 w-auto text-[12px]" aria-label="Form age">
            <option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>6 months</option><option value={365}>year</option><option value={0}>any time</option>
          </select></label>}
        {picked.size > 0 && <button type="button" className="text-[12px] text-mute underline" onClick={() => setPicked(new Set())}>Clear</button>}
      </div>
      <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-line/10 bg-white/[.03] p-1">
        {shown.length === 0 && <li className="px-2 py-1.5 text-[12.5px] text-mute">No forms match.</li>}
        {shown.slice(0, 200).map((o) => (
          <li key={o.id}>
            <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-[12.5px] hover:bg-white/[.05]">
              <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} className="mt-0.5 h-3.5 w-3.5" />
              <span className="min-w-0 flex-1">{o.name}<span className="text-mute"> · {o.page ?? "Page"}{o.created ? ` · made ${dateOf(o.created)}` : ""}{o.leads != null ? ` · ${o.leads} leads` : ""}{o.live ? " · live" : ""}{o.status && o.status !== "ACTIVE" ? ` · ${o.status.toLowerCase()}` : ""}</span></span>
            </label>
          </li>
        ))}
        {shown.length > 200 && <li className="px-2 py-1.5 text-[12px] text-mute">Showing the first 200. Type in the search box to narrow it.</li>}
      </ul>
      <input name="form_ids_extra" defaultValue={extra.join(", ")} className="input mt-1 h-8 text-[12px]" placeholder="Other form IDs, comma separated" aria-label="Lead forms, other IDs" />
    </div>
  );
}
