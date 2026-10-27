"use client";

import { useActionState, useState } from "react";
import { checkStaff, createStaff, makeLinks, type BulkState } from "./bulk";

const empty: BulkState = { lines: [] };
const TONE: Record<string, string> = { ready: "text-ok", created: "text-ok", link: "text-ok", problem: "text-bad", failed: "text-bad", exists: "text-mute" };

export function BulkStaff() {
  const [rows, setRows] = useState("");
  const [chk, checkAct, checking] = useActionState(checkStaff, empty);
  const [mk, createAct, creating] = useActionState(createStaff, empty);
  const [lk, linkAct, linking] = useActionState(makeLinks, empty);
  const [shown, setShown] = useState<"check" | "create" | "links">("check");
  const state = shown === "links" ? lk : shown === "create" ? mk : chk;
  const ready = chk.lines.filter((l) => l.status === "ready").length;
  const busy = checking || creating || linking;

  return (
    <section className="panel p-5">
      <h2 className="panel-title mb-1">Add many people at once</h2>
      <p className="mb-3 text-[12px] text-mute">Paste one person per line: name, email, phone, role, team. A header row is fine, so the filled staff CSV works as it is. The name must match the Cratio owner exactly to bring their old leads. Nothing is emailed from here.</p>
      <form className="space-y-3">
        <textarea name="rows" value={rows} onChange={(e) => setRows(e.target.value)} rows={8} className="input font-mono text-[12px]" placeholder={"name,email,phone,role,team\nVejiya,vejiya@example.com,9876543210,agent,"} aria-label="Staff rows" />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShown("check")} formAction={checkAct} disabled={busy || !rows.trim()} className="btn-quiet h-9" type="submit">1. Check the list</button>
          <button onClick={() => setShown("create")} formAction={createAct} disabled={busy || chk.mode !== "check" || ready === 0} className="btn h-9" type="submit">2. Create {ready || ""} logins (no email)</button>
          <button onClick={() => setShown("links")} formAction={linkAct} disabled={busy || mk.mode !== "create"} className="btn-quiet h-9" type="submit">3. Make set-password links</button>
        </div>
      </form>
      {state.error && <p className="mt-3 text-[13px] text-bad">{state.error}</p>}
      {state.summary && <p className="mt-3 text-[13px]">{state.summary}</p>}
      {state.lines.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-mute"><th className="th">Name</th><th className="th">Email</th><th className="th">Role</th><th className="th">Result</th></tr></thead>
            <tbody>{state.lines.map((l) => (
              <tr key={l.line}>
                <td className="td">{l.name || "–"}</td><td className="td">{l.email || "–"}</td><td className="td capitalize">{l.role}</td>
                <td className={`td ${TONE[l.status] ?? ""}`}>
                  {l.note}
                  {l.link && <input readOnly value={l.link} onFocus={(e) => e.currentTarget.select()} className="input mt-1 h-8 w-full font-mono text-[11px]" aria-label={`Set-password link for ${l.name}`} />}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
