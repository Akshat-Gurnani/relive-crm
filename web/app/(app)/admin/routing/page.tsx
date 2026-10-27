import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { getRefs } from "@/lib/refs";
import { one } from "@/lib/format";
import { Empty, Notice, Page, PageHeader } from "@/components/ui";
import { FormPicker, type FormOpt } from "./form-picker";
import { addMembers, createList, refreshAds, refreshForms, deleteList, removeMember, resetCounts, saveList, saveMember, testRoute } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Rule = { id: string; name: string; active: boolean; position: number; form_ids: string[]; campaign_ids: string[]; adset_ids: string[]; ad_ids: string[];
  name_contains: string | null; match_project_id: string | null; set_project_id: string | null; set_source_id: string | null; set_priority: string | null; note: string | null };
type Member = { rule_id: string; user_id: string; position: number; share: number; active: boolean; served: number };
type Seen = { form_id: string | null; form_name: string | null; campaign_id: string | null; campaign_name: string | null; adset_id: string | null; adset_name: string | null; ad_id: string | null; ad_name: string | null };

const uniq = (rows: Seen[], idK: keyof Seen, nameK: keyof Seen) => {
  const m = new Map<string, string>();
  for (const r of rows) { const id = r[idK]; if (id && !m.has(id)) m.set(id, r[nameK] ?? id); }
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
};

function Multi({ name, label, options, selected }: { name: string; label: string; options: { id: string; name: string }[]; selected?: string[] }) {
  const known = new Set(options.map((o) => o.id));
  const extra = (selected ?? []).filter((s) => !known.has(s));
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} multiple size={Math.min(6, Math.max(3, options.length))} defaultValue={selected ?? []} className="input h-auto py-1">
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <input name={`${name}_extra`} defaultValue={extra.join(", ")} className="input mt-1 h-8 text-[12px]" placeholder="Other IDs, comma separated" aria-label={`${label}, other IDs`} />
    </div>
  );
}

function Fields({ r, seen, refs }: { r?: Rule; seen: { forms: FormOpt[]; campaigns: { id: string; name: string }[]; adsets: { id: string; name: string }[]; ads: { id: string; name: string }[] }; refs: Awaited<ReturnType<typeof getRefs>> }) {
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <FormPicker options={seen.forms} selected={r?.form_ids} />
      <Multi name="campaign_ids" label="Campaigns" options={seen.campaigns} selected={r?.campaign_ids} />
      <Multi name="adset_ids" label="Ad sets" options={seen.adsets} selected={r?.adset_ids} />
      <Multi name="ad_ids" label="Ads" options={seen.ads} selected={r?.ad_ids} />
    </div>
    <p className="text-[12px] text-mute">Leave a box empty to mean &quot;any&quot;. Pick several to cover them all. The most specific list wins: an ad beats an ad set, then campaign, form, name, project.</p>
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div className="lg:col-span-2"><label className="label">Name contains</label><input name="name_contains" defaultValue={r?.name_contains ?? ""} className="input h-9" placeholder="e.g. EMAAR" /></div>
      <div><label className="label">Only when project is</label><select name="match_project_id" defaultValue={r?.match_project_id ?? ""} className="input h-9"><option value="">Any</option>{refs.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div><label className="label">Set project</label><select name="set_project_id" defaultValue={r?.set_project_id ?? ""} className="input h-9"><option value="">Keep</option>{refs.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div><label className="label">Set source</label><select name="set_source_id" defaultValue={r?.set_source_id ?? ""} className="input h-9"><option value="">Keep</option>{refs.sources.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div><label className="label">Set priority</label><select name="set_priority" defaultValue={r?.set_priority ?? ""} className="input h-9"><option value="">Keep</option>{["High", "Medium", "Low"].map((p) => <option key={p}>{p}</option>)}</select></div>
    </div>
  </>;
}

export default async function Routing({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { sb, profile } = await getStaff();
  if (profile.role !== "admin") redirect("/admin");
  const refs = await getRefs();
  const [rulesRes, memRes, seenRes, formsRes, adsRes] = await Promise.all([
    sb.from("routing_rules").select("*").order("position").order("created_at"),
    sb.from("routing_members").select("*").order("position"),
    sb.from("enquiries").select("form_id,form_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name").eq("provider", "meta").order("received_at", { ascending: false }).limit(2000),
    sb.from("meta_forms").select("form_id,name,page_name,status,leads_count,created_on"),
    sb.from("meta_ads").select("ad_id,name,adset_id,adset_name,campaign_id,campaign_name,form_id,account_name"),
  ]);
  const rules = (rulesRes.data ?? []) as Rule[];
  const members = (memRes.data ?? []) as Member[];
  const rows = (seenRes.data ?? []) as Seen[];
  const fromMeta = ((formsRes.data ?? []) as { form_id: string; name: string; page_name: string | null; status: string | null; leads_count: number | null; created_on: string | null }[]);
  const formMap = new Map<string, FormOpt>(uniq(rows, "form_id", "form_name").map((f) => [f.id, { id: f.id, name: f.name, page: null, leads: null, status: null, created: null }]));
  for (const f of fromMeta) formMap.set(f.form_id, { id: f.form_id, name: f.name, page: f.page_name, leads: f.leads_count, status: f.status, created: f.created_on });
  const liveAds = (adsRes.data ?? []) as { ad_id: string; name: string; adset_id: string | null; adset_name: string | null; campaign_id: string | null; campaign_name: string | null; form_id: string | null; account_name: string | null }[];
  const liveForms = new Set(liveAds.map((a) => a.form_id).filter(Boolean) as string[]);
  for (const id of liveForms) if (!formMap.has(id)) formMap.set(id, { id, name: `Form ${id}`, page: null, leads: null, status: null, created: null, live: true });
  for (const [id, f] of formMap) formMap.set(id, { ...f, live: liveForms.has(id) });
  const liveOpts = (idK: "ad_id" | "adset_id" | "campaign_id", nameK: "name" | "adset_name" | "campaign_name") => {
    const m = new Map<string, string>();
    for (const a of liveAds) { const id = a[idK]; if (id && !m.has(id)) m.set(id, `${a[nameK] ?? id}${idK === "ad_id" && a.adset_name ? ` · ${a.adset_name}` : ""} · live`); }
    return [...m].map(([id, name]) => ({ id, name }));
  };
  const merge = (live: { id: string; name: string }[], old: { id: string; name: string }[]) => { const k = new Set(live.map((x) => x.id)); return [...live, ...old.filter((x) => !k.has(x.id))].sort((a, b) => a.name.localeCompare(b.name)); };
  const seen = { forms: [...formMap.values()].sort((a, b) => (b.created ?? "").localeCompare(a.created ?? "") || a.name.localeCompare(b.name)), campaigns: merge(liveOpts("campaign_id", "campaign_name"), uniq(rows, "campaign_id", "campaign_name")), adsets: merge(liveOpts("adset_id", "adset_name"), uniq(rows, "adset_id", "adset_name")), ads: merge(liveOpts("ad_id", "name"), uniq(rows, "ad_id", "ad_name")) };
  const adsKnown = liveAds.length;
  const nm = (id: string) => refs.staffName.get(id) ?? "Unknown";
  const pname = (id: string | null) => refs.projects.find((p) => p.id === id)?.name;

  const summary = (r: Rule) => [
    r.ad_ids.length && `${r.ad_ids.length} ad${r.ad_ids.length > 1 ? "s" : ""}`, r.adset_ids.length && `${r.adset_ids.length} ad set${r.adset_ids.length > 1 ? "s" : ""}`,
    r.campaign_ids.length && `${r.campaign_ids.length} campaign${r.campaign_ids.length > 1 ? "s" : ""}`, r.form_ids.length && `${r.form_ids.length} form${r.form_ids.length > 1 ? "s" : ""}`,
    r.name_contains && `name has "${r.name_contains}"`, r.match_project_id && `project ${pname(r.match_project_id)}`,
  ].filter(Boolean).join(" · ") || "every lead";

  return (
    <>
      <PageHeader crumbs={[{ label: "Admin", href: "/admin" }, { label: "Lead routing" }]} />
      <Page>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        {one(sp.notice) && <Notice tone="ok">{one(sp.notice)}</Notice>}
        {one(sp.test) && <Notice tone="warn">{one(sp.test)}</Notice>}

        <section className="panel p-5 space-y-2">
          <h2 className="panel-title">How it works</h2>
          <p className="text-[13px] text-mute">Each list says which leads it catches and who gets them, in the order you give. People take turns evenly. To split by percentage, give a share, for example 50, 30, 20. Editing a list changes only leads that arrive afterwards. A person who enquires again stays with the rep who has their open lead, and that rep sees an alert.</p>
        </section>

        <section className="panel p-5">
          <h2 className="panel-title mb-3">Test a lead</h2>
          <form action={testRoute} className="grid gap-2 sm:grid-cols-4">
            <input name="form_name" className="input h-9" placeholder="Form name" aria-label="Form name" />
            <input name="campaign_name" className="input h-9" placeholder="Campaign name" aria-label="Campaign name" />
            <input name="ad_name" className="input h-9" placeholder="Ad name" aria-label="Ad name" />
            <button className="btn-quiet h-9" type="submit">Which list catches it?</button>
          </form>
          <p className="mt-2 text-[12px] text-mute">A dry run. Nothing is handed out and no counts change.</p>
        </section>

        <section className="panel flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-[13px] text-mute">{fromMeta.length ? `${fromMeta.length} lead forms known from Meta.` : "No forms read from Meta yet; the form list only has forms that already sent a lead."} {adsKnown ? `${adsKnown} live ads known.` : "Live ads have not been read yet, so ads and ad sets only appear after a lead arrives."}</p>
          <div className="flex gap-2"><form action={refreshAds}><button className="btn h-9" type="submit">Refresh live ads from Meta</button></form><form action={refreshForms}><button className="btn-quiet h-9" type="submit">Refresh forms</button></form></div>
        </section>

        <section className="panel p-5">
          <h2 className="panel-title mb-3">New list</h2>
          <form action={createList} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-3"><label className="label">List name</label><input name="name" className="input h-9" placeholder="e.g. Emaar desk" required /></div>
              <div><label className="label">Order (lower wins ties)</label><input name="position" type="number" defaultValue={100} className="input h-9" /></div>
            </div>
            <Fields seen={seen} refs={refs} />
            <div><label className="label">People, one per line, in rotation order</label>
              <textarea name="members" rows={6} className="input font-mono text-[12px]" placeholder={"Vejiya\nAlvia\nOwais 30\nAnand Mohan Chitranshi 20"} required />
              <p className="mt-1 text-[12px] text-mute">Use the full name as in Staff. A number after a name is that person&apos;s share; without one everybody gets an equal share.</p></div>
            <button className="btn" type="submit">Create list</button>
          </form>
        </section>

        {rules.length === 0 && <Empty emoji="zap">No lists yet. Leads only reach people through the old team rule until you make one.</Empty>}

        {rules.map((r) => {
          const ms = members.filter((m) => m.rule_id === r.id);
          const total = ms.filter((m) => m.active).reduce((a, m) => a + Number(m.share), 0) || 1;
          return (
            <details key={r.id} className="panel p-5" open={rules.length <= 3}>
              <summary className="cursor-pointer select-none">
                <span className="panel-title">{r.name}</span>
                <span className={`ml-2 text-[12px] ${r.active ? "text-won" : "text-mute"}`}>{r.active ? "On" : "Off"}</span>
                <span className="ml-2 text-[12px] text-mute">catches {summary(r)} · {ms.filter((m) => m.active).length} of {ms.length} people active</span>
              </summary>
              <div className="mt-4 space-y-4">
                <form action={saveList} className="space-y-3">
                  <input type="hidden" name="id" value={r.id} />
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="sm:col-span-2"><label className="label">List name</label><input name="name" defaultValue={r.name} className="input h-9" /></div>
                    <div><label className="label">Order</label><input name="position" type="number" defaultValue={r.position} className="input h-9" /></div>
                    <label className="flex items-end gap-2 pb-2"><input type="checkbox" name="active" defaultChecked={r.active} className="h-4 w-4 accent-[rgb(var(--accent))]" />List is on</label>
                  </div>
                  <Fields r={r} seen={seen} refs={refs} />
                  <button className="btn-quiet h-9" type="submit">Save list</button>
                </form>

                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead><tr className="text-left text-mute"><th className="th">Person</th><th className="th">Order</th><th className="th">Share</th><th className="th">Gets</th><th className="th">Handed out</th><th className="th">On</th><th className="th" /></tr></thead>
                    <tbody>{ms.map((m) => (
                      <tr key={m.user_id}>
                        <td className="td">{nm(m.user_id)}</td>
                        <td className="td"><input form={`m-${r.id}-${m.user_id}`} name="position" type="number" defaultValue={m.position} className="input h-8 w-16" aria-label="Order" /></td>
                        <td className="td"><input form={`m-${r.id}-${m.user_id}`} name="share" type="number" step="any" min="0.01" defaultValue={Number(m.share)} className="input h-8 w-20" aria-label="Share" /></td>
                        <td className="td text-mute">{m.active ? `${Math.round((Number(m.share) / total) * 100)}%` : "–"}</td>
                        <td className="td text-mute">{m.served}</td>
                        <td className="td"><input form={`m-${r.id}-${m.user_id}`} type="checkbox" name="active" defaultChecked={m.active} className="h-4 w-4 accent-[rgb(var(--accent))]" aria-label="Active" /></td>
                        <td className="td whitespace-nowrap">
                          <form id={`m-${r.id}-${m.user_id}`} action={saveMember} className="inline"><input type="hidden" name="rule_id" value={r.id} /><input type="hidden" name="user_id" value={m.user_id} /><button className="btn-quiet h-8" type="submit">Save</button></form>
                          <form action={removeMember} className="ml-1 inline"><input type="hidden" name="rule_id" value={r.id} /><input type="hidden" name="user_id" value={m.user_id} /><button className="btn-ghost h-8" type="submit">Remove</button></form>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>

                <form action={addMembers} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="rule_id" value={r.id} />
                  <div className="min-w-[14rem] flex-1"><label className="label">Add people (one per line, optional share)</label><textarea name="members" rows={2} className="input font-mono text-[12px]" /></div>
                  <button className="btn-quiet h-9" type="submit">Add</button>
                </form>

                <div className="flex flex-wrap gap-2">
                  <form action={resetCounts}><input type="hidden" name="rule_id" value={r.id} /><button className="btn-ghost h-8" type="submit">Reset counts (everyone starts level)</button></form>
                  <form action={deleteList}><input type="hidden" name="id" value={r.id} /><button className="btn-ghost h-8 text-bad" type="submit">Delete list</button></form>
                </div>
              </div>
            </details>
          );
        })}
      </Page>
    </>
  );
}
