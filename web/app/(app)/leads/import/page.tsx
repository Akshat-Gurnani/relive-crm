import Link from "next/link";
import { redirect } from "next/navigation";
import { canManage, getStaff } from "@/lib/session";
import { one } from "@/lib/format";
import { getRefs } from "@/lib/refs";
import { Emoji, Notice, Page, PageHeader } from "@/components/ui";
import { ImportPicker } from "@/components/import-picker";
import { runImport } from "../actions";
import { IMPORT_FIELDS } from "@/lib/import-fields";

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { sb, profile } = await getStaff();
  if (!canManage(profile.role)) redirect("/leads");
  const refs = await getRefs();
  const done = one(sp.done) ? JSON.parse(one(sp.done)!) as { inserted: number; updated: number; skipped: number; failed: number; rows: number; errors: { row: number; error: string }[] } : null;
  const { data: batches } = await sb.from("import_batches").select("id,file_name,total,inserted,updated,skipped,failed,created_at").order("created_at", { ascending: false }).limit(8);

  return (
    <>
      <PageHeader crumbs={[{ label: "Leads", href: "/leads" }, { label: "Import" }]} />
      <Page>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        {done && (
          <section className="panel p-5">
            <h2 className="display flex items-center gap-2 text-[17px]"><Emoji name="check" size={18} />Import finished</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[["Rows", done.rows], ["Added", done.inserted], ["Updated", done.updated], ["Skipped (already there)", done.skipped], ["Failed", done.failed]].map(([l, n]) => (
                <div key={l as string} className="rounded-xl border border-line/10 bg-white/[.03] p-3"><div className="text-[12px] text-mute">{l}</div><div className="figure text-[24px]">{n as number}</div></div>
              ))}
            </div>
            {done.errors.length > 0 && (
              <ul className="mt-4 max-h-60 space-y-1 overflow-auto text-[12.5px]">
                {done.errors.map((e, i) => <li key={i}><span className="text-mute">Row {e.row + 1}:</span> <span className="text-bad">{e.error}</span></li>)}
              </ul>
            )}
            <Link href="/leads" className="btn mt-4">See leads</Link>
          </section>
        )}
        <section className="panel p-5">
          <h2 className="display text-[17px]">Import leads from a CSV file</h2>
          <p className="mt-1 max-w-2xl text-mute">Works with a Cratio lead export as it comes: columns such as Customer Name, Mobile Number, Product Category, Lead Source, Lead Stage and Assigned To are matched for you. Numbers are cleaned and checked, and a person who already has a lead for the same project is not duplicated.</p>
          <form action={runImport} className="mt-4 space-y-4">
            <ImportPicker fields={IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, guess: f.guess.source, flags: f.guess.flags }))} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="on_duplicate">If the lead already exists</label>
                <select id="on_duplicate" name="on_duplicate" className="input" defaultValue="skip">
                  <option value="skip">Skip it</option><option value="update">Update stage, priority and follow-up</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="team_id">Leads with no owner go round robin to</label>
                <select id="team_id" name="team_id" className="input" defaultValue="">
                  <option value="">Leave unassigned</option>{refs.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              {profile.role === "admin" && (
                <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" name="create_missing" className="h-4 w-4 accent-[rgb(var(--accent))]" />Create projects that do not exist yet</label>
              )}
            </div>
            <button className="btn" type="submit">Import</button>
          </form>
        </section>
        {(batches ?? []).length > 0 && (
          <section className="panel overflow-x-auto">
            <div className="panel-head"><h2 className="panel-title">Recent imports</h2></div>
            <table className="w-full">
              <thead><tr><th className="th">File</th><th className="th">When</th><th className="th text-right">Rows</th><th className="th text-right">Added</th><th className="th text-right">Updated</th><th className="th text-right">Skipped</th><th className="th text-right">Failed</th></tr></thead>
              <tbody>{(batches ?? []).map((b) => (
                <tr key={b.id} className="row"><td className="td">{b.file_name}</td><td className="td text-mute">{new Date(b.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  <td className="td text-right">{b.total}</td><td className="td text-right">{b.inserted}</td><td className="td text-right">{b.updated}</td><td className="td text-right">{b.skipped}</td><td className="td text-right text-bad">{b.failed}</td></tr>
              ))}</tbody>
            </table>
          </section>
        )}
      </Page>
    </>
  );
}
