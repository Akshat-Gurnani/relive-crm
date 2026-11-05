import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { getRefs } from "@/lib/refs";
import { one } from "@/lib/format";
import { Empty, Notice, Page, PageHeader } from "@/components/ui";
import { createRule, deleteRule, saveFallback, saveIdle, saveRule, saveUntouched, setClaimMode } from "./actions";

export const dynamic = "force-dynamic";

type Rule = { id: string; name: string; active: boolean; claim_mode: boolean; match_project_id: string | null; form_ids: string[]; campaign_ids: string[]; adset_ids: string[]; ad_ids: string[]; name_contains: string | null; created_at: string };
type Preview = { total: number; ytt: number; idle: number; by_owner: { name: string; n: number }[] };
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
  const [rulesRes, memRes, projRes, rotRes, fbRes, poolRes, prevRes] = await Promise.all([
    sb.from("routing_rules").select("id,name,active,claim_mode,match_project_id,form_ids,campaign_ids,adset_ids,ad_ids,name_contains,created_at").order("name"),
    sb.from("routing_members").select("rule_id,user_id,position,active,served").order("position"),
    sb.from("projects").select("id,name,active").order("name"),
    sb.from("app_settings").select("value").eq("key", "rotation").single(),
    sb.from("app_settings").select("value").eq("key", "fallback_owner").maybeSingle(),
    sb.from("app_settings").select("value").eq("key", "pool").maybeSingle(),
    sb.rpc("rotation_preview", { p_settings: null }),
  ]);
  const fallback = ((fbRes.data?.value ?? {}) as { user_id?: string | null }).user_id ?? "";
  const poolMin = ((poolRes.data?.value ?? {}) as { timeout_minutes?: number }).timeout_minutes ?? 60;
  const preview = (prevRes.data ?? null) as Preview | null;
  const all = (rulesRes.data ?? []) as Rule[];
  const members = (memRes.data ?? []) as Member[];
  const projects = (projRes.data ?? []) as { id: string; name: string; active: boolean }[];
  const rot = (rotRes.data?.value ?? {}) as { enabled?: boolean; minutes?: number; idle_enabled?: boolean; idle_days?: number; ytt_days?: number; followup_grace_days?: number; idle_max?: number; work_start?: string; work_end?: string };
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
          <h2 className="panel-title mb-1">Idle lead rotation</h2>
          <p className="mb-3 text-[12.5px] text-mute">Keeps every lead in use until it is proven not qualified. An open lead moves to the next person in its rule (or its project&apos;s rule) when it has had no call, note, visit or stage change for the set days, or has sat in <b>Yet To Talk</b> too long. A follow-up booked within the grace period protects it. Runs during working hours ({rot.work_start ?? "09:00"}–{rot.work_end ?? "21:00"}), up to 25 leads a minute.</p>
          {preview && (
            <div className={`mb-3 rounded-lg border px-3 py-2 text-[13px] ${rot.idle_enabled ? "border-line/10 bg-white/[.03]" : "border-warn/40 bg-warn/10"}`}>
              <b>{rot.idle_enabled ? "Right now" : "If switched on now"}: {preview.total} lead{preview.total === 1 ? "" : "s"} would move</b> ({preview.ytt} stuck in Yet To Talk, {preview.idle} untouched).
              {preview.by_owner.length > 0 && <span className="text-mute"> Most from: {preview.by_owner.slice(0, 6).map((o) => `${o.name} ${o.n}`).join(", ")}.</span>}
            </div>
          )}
          <form action={saveIdle} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="flex items-end gap-2 pb-2 text-[13px] lg:col-span-2"><input type="checkbox" name="idle_enabled" defaultChecked={!!rot.idle_enabled} className="h-4 w-4 accent-[rgb(var(--accent))]" />Switch on idle rotation</label>
            <div><label className="label" htmlFor="idle_days">Untouched for (days)</label><input id="idle_days" name="idle_days" type="number" min={2} defaultValue={rot.idle_days ?? 15} className="input h-9" /></div>
            <div><label className="label" htmlFor="ytt_days">Yet To Talk for (days)</label><input id="ytt_days" name="ytt_days" type="number" min={1} defaultValue={rot.ytt_days ?? 5} className="input h-9" /></div>
            <div><label className="label" htmlFor="followup_grace_days">Follow-up protects (days)</label><input id="followup_grace_days" name="followup_grace_days" type="number" min={0} defaultValue={rot.followup_grace_days ?? 15} className="input h-9" /></div>
            <div><label className="label" htmlFor="idle_max">Max moves per lead</label><input id="idle_max" name="idle_max" type="number" min={1} defaultValue={rot.idle_max ?? 10} className="input h-9" /></div>
            <div className="lg:col-span-6"><button className="btn-quiet h-9" type="submit">Save</button></div>
          </form>
        </section>

        <section className="panel p-5">
          <h2 className="panel-title mb-1">When nobody can take a lead</h2>
          <p className="mb-3 text-[12.5px] text-mute">If no rule matches and nobody is free, or everyone in the rule is switched off, the lead goes to this person with an alert instead of waiting unassigned. Open-pool leads that nobody calls within the wait time are handed out in turn as usual.</p>
          <form action={saveFallback} className="flex flex-wrap items-end gap-4">
            <div><label className="label" htmlFor="fb_user">Fallback owner</label>
              <select id="fb_user" name="user_id" defaultValue={fallback} className="input h-9 w-60"><option value="">Nobody (leave unassigned, alert admins)</option>{refs.staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
            <div><label className="label" htmlFor="timeout_minutes">Open pool wait (minutes)</label><input id="timeout_minutes" name="timeout_minutes" type="number" min={0} defaultValue={poolMin} className="input h-9 w-28" /></div>
            <button className="btn-quiet h-9" type="submit">Save</button>
          </form>
          <p className="mt-2 text-[12px] text-mute">Wait 0 means an open lead stays open until someone calls it.</p>
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
                      <td className="td">Product Category <span className="font-medium text-won">IS</span> {p?.name ?? r.name}{p && !p.active && <span className="text-mute"> (inactive project)</span>}{!r.active && <span className="ml-2 text-mute">Off</span>}
                        <form action={setClaimMode} className="mt-1.5">
                          <input type="hidden" name="id" value={r.id} />
                          {r.claim_mode && <input type="hidden" name="claim_mode" value="" />}
                          {!r.claim_mode && <input type="hidden" name="claim_mode" value="on" />}
                          <button type="submit" className={`rounded-full border px-2 py-0.5 text-[11.5px] ${r.claim_mode ? "border-accent/50 bg-accent/15 text-accent-2" : "border-line/15 text-mute hover:text-ink"}`}>
                            {r.claim_mode ? "Open pool: first to call keeps it ✓" : "Taking turns · switch to open pool"}
                          </button>
                        </form>
                      </td>
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
