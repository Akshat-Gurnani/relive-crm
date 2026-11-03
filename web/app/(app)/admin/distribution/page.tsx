import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { getRefs } from "@/lib/refs";
import { one } from "@/lib/format";
import { Empty, Notice, Page, PageHeader } from "@/components/ui";
import { createRule, deleteRule, saveRule, saveUntouched } from "./actions";

export const dynamic = "force-dynamic";

type Rule = { id: string; name: string; active: boolean; match_project_id: string | null; form_ids: string[]; campaign_ids: string[]; adset_ids: string[]; ad_ids: string[]; name_contains: string | null; created_at: string };
type Member = { rule_id: string; user_id: string; position: number; active: boolean; served: number };

function People({ staff, picked }: { staff: { id: string; full_name: string }[]; picked?: Set<string> }) {
  return (
    <ul className="grid max-h-60 gap-x-4 overflow-y-auto rounded-lg border border-line/10 bg-white/[.03] p-2 sm:grid-cols-2 lg:grid-cols-3">
      {staff.map((s) => (
        <li key={s.id}><label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-white/[.05]">
          <input type="checkbox" name="user_ids" value={s.id} defaultChecked={picked?.has(s.id)} className="h-4 w-4 accent-[rgb(var(--accent))]" />{s.full_name}
        </label></li>
      ))}
    </ul>
  );
}

export default async function Distribution({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { sb, profile } = await getStaff();
  if (profile.role !== "admin") redirect("/admin");
  const refs = await getRefs();
  const [rulesRes, memRes, projRes, rotRes] = await Promise.all([
    sb.from("routing_rules").select("id,name,active,match_project_id,form_ids,campaign_ids,adset_ids,ad_ids,name_contains,created_at").order("name"),
    sb.from("routing_members").select("rule_id,user_id,position,active,served").order("position"),
    sb.from("projects").select("id,name,active").order("name"),
    sb.from("app_settings").select("value").eq("key", "rotation").single(),
  ]);
  const all = (rulesRes.data ?? []) as Rule[];
  const members = (memRes.data ?? []) as Member[];
  const projects = (projRes.data ?? []) as { id: string; name: string; active: boolean }[];
  const rot = (rotRes.data?.value ?? {}) as { enabled?: boolean; minutes?: number };
  const isSimple = (r: Rule) => !!r.match_project_id && !r.form_ids.length && !r.campaign_ids.length && !r.adset_ids.length && !r.ad_ids.length && !r.name_contains;
  const rules = all.filter(isSimple);
  const advanced = all.length - rules.length;
  const pname = new Map(projects.map((p) => [p.id, p]));
  const taken = new Set(rules.map((r) => r.match_project_id));
  const free = projects.filter((p) => !taken.has(p.id));
  const eligible = refs.staff.filter((s) => s.active && ["agent", "manager", "admin"].includes(s.role));
  const nm = (id: string) => refs.staffName.get(id) ?? "Unknown";

  return (
    <>
      <PageHeader crumbs={[{ label: "Admin", href: "/admin" }, { label: "Distribution rules" }]}>
        <div className="flex gap-1.5"><Link href="/admin/forms" className="chip">Facebook form mapping →</Link><Link href="/admin/routing" className="chip">Advanced routing →</Link></div>
      </PageHeader>
      <Page>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        {one(sp.notice) && <Notice tone="ok">{one(sp.notice)}</Notice>}

        <section className="panel p-5 space-y-2">
          <h2 className="panel-title">Distribution rules</h2>
          <p className="text-[13px] text-mute">Allocate people to leads in round robin, based on the lead&apos;s product category (the project). Each rule says: when the product category is this project, these people take turns. The category comes from the Facebook form mapping, so every form you map sits under one of these rules.</p>
          {advanced > 0 && <p className="text-[12.5px] text-mute">{advanced} more list{advanced > 1 ? "s" : ""} on <Link href="/admin/routing" className="underline">Advanced routing</Link> catch leads by form, ad set or ad instead of by category. They take priority over these rules.</p>}
        </section>

        <section className="panel p-5">
          <form action={saveUntouched} className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 pb-2 text-[13px]"><input type="checkbox" name="enabled" defaultChecked={!!rot.enabled} className="h-4 w-4 accent-[rgb(var(--accent))]" />Enable untouched lead distribution</label>
            <div><label className="label" htmlFor="minutes">Untouched period (minutes)</label><input id="minutes" name="minutes" type="number" min={5} defaultValue={rot.minutes ?? 30} className="input h-9 w-28" /></div>
            <button className="btn-quiet h-9" type="submit">Save</button>
          </form>
          <p className="mt-2 text-[12px] text-mute">A new lead that gets no call, note, task or stage change within this time moves to the next person in the same rule. Working hours and the move limit are under Admin → Lead rules.</p>
        </section>

        <section className="panel p-5">
          <h2 className="panel-title mb-3">Create rule</h2>
          {free.length === 0 ? <p className="text-[13px] text-mute">Every product category already has a rule.</p> : (
            <form action={createRule} className="space-y-3">
              <div className="max-w-sm"><label className="label" htmlFor="project_id">Product category is</label>
                <select id="project_id" name="project_id" className="input h-9" required defaultValue=""><option value="" disabled>Choose a project</option>{free.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (inactive)"}</option>)}</select></div>
              <div><label className="label">People who take turns</label><People staff={eligible} /></div>
              <button className="btn" type="submit">Create rule</button>
            </form>
          )}
        </section>

        {rules.length === 0 && <Empty emoji="zap">No distribution rules yet.</Empty>}

        {rules.length > 0 && (
          <section className="panel overflow-x-auto">
            <div className="panel-head"><h2 className="panel-title">Rules</h2><span className="text-[12px] text-mute">{rules.length} rules</span></div>
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-mute"><th className="th w-12">S.no</th><th className="th">Rule</th><th className="th">Users</th><th className="th w-40" /></tr></thead>
              <tbody>
                {rules.map((r, i) => {
                  const ms = members.filter((m) => m.rule_id === r.id);
                  const p = pname.get(r.match_project_id ?? "");
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="td text-mute">{i + 1}</td>
                      <td className="td">Product Category <span className="font-medium text-won">IS</span> {p?.name ?? r.name}{p && !p.active && <span className="text-mute"> (inactive project)</span>}{!r.active && <span className="ml-2 text-mute">Off</span>}</td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1.5">{ms.map((m) => <span key={m.user_id} className={`rounded border border-line/10 px-2 py-0.5 text-[12px] ${m.active ? "" : "text-mute line-through"}`}>{nm(m.user_id)}</span>)}</div>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[12.5px] text-accent-2 underline">Edit</summary>
                          <form action={saveRule} className="mt-2 space-y-2">
                            <input type="hidden" name="id" value={r.id} />
                            <People staff={eligible} picked={new Set(ms.map((m) => m.user_id))} />
                            <button className="btn-quiet h-8" type="submit">Save people</button>
                          </form>
                        </details>
                      </td>
                      <td className="td"><form action={deleteRule}><input type="hidden" name="id" value={r.id} /><button className="btn-ghost h-8 text-bad" type="submit">Delete</button></form></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </Page>
    </>
  );
}
