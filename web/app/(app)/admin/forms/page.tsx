import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { getRefs } from "@/lib/refs";
import { ago, one } from "@/lib/format";
import { Empty, Notice, Page, PageHeader } from "@/components/ui";
import { FormSelect, type FormChoice } from "./form-select";
import { createMapping, deleteMapping, saveMapping } from "./actions";

export const dynamic = "force-dynamic";

type Mapping = { id: string; name: string; form_id: string; form_name: string | null; project_id: string | null; source_id: string | null; priority: string | null; assign_to: string | null; active: boolean };
type Enq = { form_id: string | null; form_name: string | null; received_at: string };
const WINDOW_DAYS = 60;

export default async function Forms({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { sb, profile } = await getStaff();
  if (profile.role !== "admin") redirect("/admin");
  const refs = await getRefs();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const [mapRes, formsRes, enqRes, projRes, ruleRes, memRes] = await Promise.all([
    sb.from("form_mappings").select("*").order("name"),
    sb.from("meta_forms").select("form_id,name,page_name,leads_count,created_on").order("created_on", { ascending: false }),
    sb.from("enquiries").select("form_id,form_name,received_at").eq("provider", "meta").gte("received_at", since).not("form_id", "is", null).order("received_at", { ascending: false }).limit(5000),
    sb.from("projects").select("id,name,active").order("name"),
    sb.from("routing_rules").select("id,match_project_id,active,form_ids,campaign_ids,adset_ids,ad_ids,name_contains").not("match_project_id", "is", null),
    sb.from("routing_members").select("rule_id,user_id,active"),
  ]);
  const maps = (mapRes.data ?? []) as Mapping[];
  const forms = (formsRes.data ?? []) as { form_id: string; name: string; page_name: string | null; leads_count: number | null; created_on: string | null }[];
  const enq = (enqRes.data ?? []) as Enq[];
  const projects = (projRes.data ?? []) as { id: string; name: string; active: boolean }[];
  const pname = new Map(projects.map((p) => [p.id, p.name]));
  const mappedIds = new Map(maps.map((m) => [m.form_id, m.name]));

  // Who a mapped form's leads go to: the plain "project is X" rule, as in Cratio.
  const rules = ((ruleRes.data ?? []) as { id: string; match_project_id: string; active: boolean; form_ids: string[]; campaign_ids: string[]; adset_ids: string[]; ad_ids: string[]; name_contains: string | null }[])
    .filter((r) => r.active && !r.form_ids.length && !r.campaign_ids.length && !r.adset_ids.length && !r.ad_ids.length && !r.name_contains);
  const mem = (memRes.data ?? []) as { rule_id: string; user_id: string; active: boolean }[];
  const peopleFor = (projectId: string | null) => {
    const r = rules.find((x) => x.match_project_id === projectId);
    return r ? mem.filter((m) => m.rule_id === r.id && m.active).map((m) => refs.staffName.get(m.user_id) ?? "Unknown") : null;
  };

  // Forms that sent leads in the last 60 days but have no mapping: they are the ones that can arrive without a proper owner.
  const seen = new Map<string, { id: string; name: string; leads: number; last: string }>();
  for (const e of enq) {
    if (!e.form_id || mappedIds.has(e.form_id)) continue;
    const s = seen.get(e.form_id);
    if (s) s.leads += 1; else seen.set(e.form_id, { id: e.form_id, name: e.form_name ?? `Form ${e.form_id}`, leads: 1, last: e.received_at });
  }
  const unmapped = [...seen.values()].sort((a, b) => b.leads - a.leads);

  const choices: FormChoice[] = forms.map((f) => ({ id: f.form_id, name: f.name, page: f.page_name, leads: f.leads_count, created: f.created_on, mappedAs: mappedIds.get(f.form_id) ?? null }));
  for (const u of unmapped) if (!choices.some((c) => c.id === u.id)) choices.push({ id: u.id, name: u.name, page: null, leads: null, created: null });
  const preset = one(sp.form);

  const Selects = ({ m }: { m?: Mapping }) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div><label className="label">Product category</label><select name="project_id" defaultValue={m?.project_id ?? ""} className="input h-9" required><option value="" disabled>Choose a project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (inactive)"}</option>)}</select></div>
      <div><label className="label">Lead source</label><select name="source_id" defaultValue={m?.source_id ?? ""} className="input h-9"><option value="">Keep what the form name says</option>{refs.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div><label className="label">Lead priority</label><select name="priority" defaultValue={m?.priority ?? "High"} className="input h-9">{["High", "Medium", "Low"].map((p) => <option key={p}>{p}</option>)}</select></div>
      <div><label className="label">Assigned to (only if no rule)</label><select name="assign_to" defaultValue={m?.assign_to ?? ""} className="input h-9"><option value="">Nobody: use default round robin</option>{refs.assignable.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
    </div>
  );

  return (
    <>
      <PageHeader crumbs={[{ label: "Admin", href: "/admin" }, { label: "Facebook form mapping" }]}>
        <div className="flex gap-1.5"><Link href="/admin/distribution" className="chip">Distribution rules →</Link><Link href="/admin/integrations" className="chip">Integrations →</Link></div>
      </PageHeader>
      <Page>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        {one(sp.notice) && <Notice tone="ok">{one(sp.notice)}</Notice>}

        <section className="panel p-5 space-y-2">
          <h2 className="panel-title">How a lead finds its owner</h2>
          <p className="text-[13px] text-mute">Map each Facebook lead form once: choose its product category, source and priority. When a lead arrives, the form&apos;s category picks the matching <Link href="/admin/distribution" className="underline">distribution rule</Link>, and the people in that rule take turns. This is the same two steps Cratio used. A form with no mapping falls back to guessing from its name, so map every form you run ads on.</p>
        </section>

        {unmapped.length > 0 && (
          <section className="panel p-5">
            <h2 className="panel-title mb-1 text-warn">{unmapped.length} form{unmapped.length > 1 ? "s" : ""} sent leads in the last {WINDOW_DAYS} days without a mapping</h2>
            <p className="mb-3 text-[12.5px] text-mute">These leads were routed by guessing the project from the form name, so some may have arrived with no project or no owner.</p>
            <ul className="divide-y divide-line/10">
              {unmapped.slice(0, 30).map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[13px]">
                  <span className="min-w-0"><span className="font-medium">{u.name}</span><span className="text-mute"> · {u.leads} lead{u.leads > 1 ? "s" : ""} · last {ago(u.last)}</span></span>
                  <Link href={`/admin/forms?form=${encodeURIComponent(u.id)}#new`} className="btn-quiet h-8">Map it</Link>
                </li>
              ))}
            </ul>
            {unmapped.length > 30 && <p className="mt-2 text-[12px] text-mute">Showing the 30 with the most leads.</p>}
          </section>
        )}

        <section id="new" className="panel p-5">
          <h2 className="panel-title mb-3">Create Facebook mapping</h2>
          <form action={createMapping} className="space-y-3">
            <div className="max-w-md"><label className="label" htmlFor="name">Mapper name</label><input id="name" name="name" className="input h-9" placeholder="e.g. FORESTA BAREILLY - DFBL (leave empty to use the form name)" /></div>
            <FormSelect options={choices} initial={preset && choices.some((c) => c.id === preset && !c.mappedAs) ? preset : undefined} />
            {choices.length === 0 && <p className="text-[12.5px] text-mute">No forms read from Meta yet. Press &quot;Refresh forms&quot; on <Link href="/admin/routing" className="underline">Advanced routing</Link>.</p>}
            <Selects />
            <button className="btn" type="submit">Save mapping</button>
          </form>
        </section>

        {maps.length === 0 && <Empty emoji="zap">No forms are mapped yet.</Empty>}

        {maps.length > 0 && (
          <section className="panel overflow-x-auto">
            <div className="panel-head"><h2 className="panel-title">Facebook mapping list</h2><span className="text-[12px] text-mute">{maps.length} mapped</span></div>
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-mute"><th className="th">Mapper</th><th className="th">Product category</th><th className="th">Who takes the lead</th><th className="th w-40" /></tr></thead>
              <tbody>
                {maps.map((m) => {
                  const people = peopleFor(m.project_id);
                  return (
                    <tr key={m.id} className="align-top">
                      <td className="td"><div className="font-medium">{m.name}{!m.active && <span className="ml-2 text-mute">Off</span>}</div><div className="text-[12px] text-mute">{m.form_name ?? m.form_id}</div></td>
                      <td className="td">{pname.get(m.project_id ?? "") ?? "None"}<div className="text-[12px] text-mute">{m.priority ?? "No priority set"} priority</div></td>
                      <td className="td">{people ? <span className="text-[12.5px]">{people.join(", ") || "Everyone in the rule is switched off"}</span> : <span className="text-[12.5px] text-warn">No distribution rule for this category. Falls back to default round robin.</span>}
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[12.5px] text-accent-2 underline">Edit</summary>
                          <form action={saveMapping} className="mt-2 space-y-2">
                            <input type="hidden" name="id" value={m.id} />
                            <div className="grid gap-3 sm:grid-cols-2"><div><label className="label">Mapper name</label><input name="name" defaultValue={m.name} className="input h-9" /></div>
                              <label className="flex items-end gap-2 pb-2"><input type="checkbox" name="active" defaultChecked={m.active} className="h-4 w-4 accent-[rgb(var(--accent))]" />Mapping is on</label></div>
                            <Selects m={m} />
                            <button className="btn-quiet h-8" type="submit">Save mapping</button>
                          </form>
                        </details>
                      </td>
                      <td className="td"><form action={deleteMapping}><input type="hidden" name="id" value={m.id} /><button className="btn-ghost h-8 text-bad" type="submit">Remove</button></form></td>
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
