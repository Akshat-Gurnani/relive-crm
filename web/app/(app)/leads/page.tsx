import Link from "next/link";
import { redirect } from "next/navigation";
import { canLead, canManage, canWorkLeads, getStaff } from "@/lib/session";
import { ago, dateTime, one } from "@/lib/format";
import { getRefs } from "@/lib/refs";
import { applyLeadFilters, LIST_SELECT, listQueryString, openStageIds, searchSelect, SORTS, type SP } from "@/lib/leads-query";
import { Avatar, Emoji, Empty, Notice, Page, PageHeader, StageBadge, TempBadge, type EmojiName } from "@/components/ui";
import { BulkBar, ConfirmButton, SelectAll } from "@/components/client";
import type { LeadRow } from "@/lib/types";
import { bulkUpdate, deleteView, saveView } from "./actions";

const PAGE = 50;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { sb, profile, reports } = await getStaff();
  if (!canWorkLeads(profile.role)) redirect("/");
  const refs = await getRefs();
  const manage = canManage(profile.role);
  const lead = canLead(profile.role, reports);

  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);
  const view = one(sp.view) ?? "all";
  const openIds = await openStageIds(sb);
  const query = applyLeadFilters(
    sb.from("leads").select(searchSelect(LIST_SELECT, sp), { count: "exact" }).range((page - 1) * PAGE, page * PAGE - 1),
    sp, { userId: profile.id, openStageIds: openIds });
  const [{ data, count, error }, viewsRes] = await Promise.all([
    query,
    sb.from("saved_views").select("id,name,params,is_public,owner_id").order("name"),
  ]);
  const rows = (data ?? []) as unknown as LeadRow[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qsNow = listQueryString(sp);
  const savedViews = (viewsRes.data ?? []) as { id: string; name: string; params: Record<string, string>; is_public: boolean; owner_id: string }[];

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(qsNow);
    for (const [k, v] of Object.entries(over)) { if (v) p.set(k, v); else p.delete(k); }
    const s = p.toString();
    return s ? `/leads?${s}` : "/leads";
  };
  const views: [string, string, EmojiName][] = [["all", "All", "house"], ["mine", "Mine", "wave"], ["open", "Open", "sparkles"], ["uncontacted", "Never contacted", "zap"], ["contacted", "Contacted", "call"], ["overdue", "Overdue", "clock"], ["reenquiry", "Re-enquired", "recycle"], ["converted", "Converted", "party"], ["lost", "Lost", "cold"], ...(manage ? [["unassigned", "Unassigned", "thinking"] as [string, string, EmojiName]] : [])];
  const current = views.find(([k]) => k === view);
  const filtered = ["q", "stage", "project", "source", "assignee", "temp", "priority", "from", "to", "fu_from", "fu_to", "channel", "vendor", "campaign", "qual", "tag", "interest"].some((k) => one(sp[k]));
  const ret = `/leads${qsNow ? `?${qsNow}` : ""}${page > 1 ? `${qsNow ? "&" : "?"}page=${page}` : ""}`;
  const ageing = (iso: string) => {
    const d = (Date.now() - new Date(iso).getTime()) / 86400000;
    return d < 3 ? ["0-2 d", "text-won"] : d < 6 ? ["3-5 d", "text-warn"] : d < 10 ? ["6-9 d", "text-accent-2"] : ["10+ d", "text-bad"];
  };

  return (
    <>
      <PageHeader crumbs={view === "all" ? [{ label: "Leads" }] : [{ label: "Leads", href: "/leads" }, { label: current?.[1] ?? view }]}>
        <span className="text-[12.5px] text-mute"><span className="figure text-[15px] text-ink">{total.toLocaleString("en-IN")}</span> {total === 1 ? "lead" : "leads"}</span>
        <a href={`/leads/export${qsNow ? `?${qsNow}` : ""}`} className="btn-quiet">Export</a>
        {manage && <Link href="/leads/import" className="btn-quiet">Import</Link>}
        <Link href="/leads/new" className="btn"><span className="text-[15px] leading-none">+</span> Add lead</Link>
      </PageHeader>
      <Page>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        {one(sp.notice) && <Notice tone="ok">{one(sp.notice)}</Notice>}

        <div className="flex flex-wrap items-center gap-1.5">
          {views.map(([k, label, e]) => (
            <Link key={k} href={qs({ view: k === "all" ? undefined : k, page: undefined })} className="chip" aria-current={view === k && !one(sp.sv) ? "true" : undefined}><Emoji name={e} size={13} />{label}</Link>
          ))}
          {savedViews.map((v) => {
            const p = new URLSearchParams({ ...v.params, sv: v.id });
            return <Link key={v.id} href={`/leads?${p}`} className="chip" aria-current={one(sp.sv) === v.id ? "true" : undefined}><Emoji name="pin" size={13} />{v.name}{v.is_public && <span className="text-[10px] text-faint">team</span>}</Link>;
          })}
        </div>

        <form method="get" className="panel p-4">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
            <div className="col-span-2 sm:col-span-4 lg:col-span-1"><label className="label" htmlFor="q">Search name, phone or owner</label><input id="q" name="q" defaultValue={one(sp.q)} className="input" placeholder="Customer, 98765… or agent" /></div>
            <Select name="stage" label="Stage" value={one(sp.stage)} options={refs.stages} />
            <Select name="project" label="Project" value={one(sp.project)} options={refs.projects} />
            <Select name="assignee" label="Assigned to" value={one(sp.assignee)} options={[{ id: "none", name: "Unassigned" }, ...refs.staff.map((x) => ({ id: x.id, name: x.full_name }))]} />
            <div className="flex items-end gap-2">
              <button className="btn" type="submit">Filter</button>
              {filtered && <Link href={view === "all" ? "/leads" : `/leads?view=${view}`} className="btn-ghost">Clear</Link>}
            </div>
          </div>
          <details className="group mt-2" open={["source", "temp", "priority", "from", "to", "fu_from", "fu_to", "sort", "channel", "vendor", "campaign", "qual", "tag", "interest"].some((k) => one(sp[k]))}>
            <summary className="btn-ghost -ml-3 cursor-pointer list-none text-[12.5px]">More filters and sorting <span className="transition group-open:rotate-180">▾</span></summary>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              <Select name="source" label="Lead source" value={one(sp.source)} options={refs.sources} />
              <Select name="channel" label="Channel" value={one(sp.channel)} options={[{ id: "meta", name: "Facebook / Instagram" }, { id: "google_ads", name: "Google Ads" }, { id: "google_forms", name: "Google Forms" }, { id: "linkedin", name: "LinkedIn" }, { id: "website", name: "Website" }, { id: "webhook", name: "Other webhook" }]} />
              <div><label className="label" htmlFor="campaign">Campaign, ad set or ad</label><input id="campaign" name="campaign" defaultValue={one(sp.campaign)} className="input" placeholder="e.g. Diwali" /></div>
              <Select name="qual" label="Qualification" value={one(sp.qual)} options={["Qualified", "Non-qualified", "Diverted"].map((v) => ({ id: v, name: v }))} />
              <Select name="tag" label="Tag" value={one(sp.tag)} options={(refs.picklists.lead_tag ?? []).map((v) => ({ id: v, name: v }))} />
              <Select name="interest" label="Also interested in" value={one(sp.interest)} options={[...(refs.picklists.interest ?? []), ...refs.projects.map((p) => p.name)].map((v) => ({ id: v, name: v }))} />
              <Select name="temp" label="Temperature" value={one(sp.temp)} options={[{ id: "hot", name: "Hot" }, { id: "warm", name: "Warm" }, { id: "cold", name: "Cold" }]} />
              <Select name="priority" label="Priority" value={one(sp.priority)} options={(refs.picklists.priority ?? []).map((p) => ({ id: p, name: p }))} />
              <Select name="sort" label="Sort by" value={one(sp.sort)} options={Object.entries(SORTS).map(([id, s]) => ({ id, name: s.label }))} all={false} />
              <div><label className="label" htmlFor="from">Created from</label><input id="from" name="from" type="date" defaultValue={one(sp.from)} className="input" /></div>
              <div><label className="label" htmlFor="to">Created to</label><input id="to" name="to" type="date" defaultValue={one(sp.to)} className="input" /></div>
              <div><label className="label" htmlFor="fu_from">Follow-up from</label><input id="fu_from" name="fu_from" type="date" defaultValue={one(sp.fu_from)} className="input" /></div>
              <div><label className="label" htmlFor="fu_to">Follow-up to</label><input id="fu_to" name="fu_to" type="date" defaultValue={one(sp.fu_to)} className="input" /></div>
            </div>
          </details>
        </form>
        <form action={saveView} className="-mt-2 flex flex-wrap items-center justify-end gap-2 text-[12.5px]">
          <input type="hidden" name="qs" value={qsNow} />
          <input name="name" placeholder="Name this view" aria-label="View name" className="input h-8 w-44" />
          <label className="flex items-center gap-1.5 text-mute"><input type="checkbox" name="is_public" className="accent-[rgb(var(--accent))]" />Share with team</label>
          <button className="btn-quiet h-8" type="submit">Save view</button>
          {one(sp.sv) && savedViews.find((v) => v.id === one(sp.sv) && v.owner_id === profile.id) && (
            <><input type="hidden" name="id" value={one(sp.sv)} /><button formAction={deleteView} className="btn-ghost h-8 text-bad">Delete this view</button></>
          )}
        </form>

        {error && <Notice>Could not load leads: {error.message}</Notice>}

        <form action={bulkUpdate} className="space-y-3">
          <input type="hidden" name="return" value={ret} />
          <BulkBar>
            <select name="b_stage" className="input h-8 w-auto" aria-label="Set stage" defaultValue="">
              <option value="">Stage…</option>{refs.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select name="b_reason" className="input h-8 w-auto" aria-label="Lost reason" defaultValue="">
              <option value="">Lost reason…</option>{refs.reasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {lead && (
              <select name="b_assignee" className="input h-8 w-auto" aria-label="Assign to" defaultValue="">
                <option value="">Assign to…</option>{manage && <option value="none">Unassigned</option>}
                {refs.assignable.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            )}
            <select name="b_priority" className="input h-8 w-auto" aria-label="Set priority" defaultValue="">
              <option value="">Priority…</option>{(refs.picklists.priority ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select name="b_temp" className="input h-8 w-auto" aria-label="Set temperature" defaultValue="">
              <option value="">Temperature…</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
            </select>
            <button className="btn h-8" type="submit" name="op" value="update">Apply</button>
            {profile.role === "admin" && <ConfirmButton className="btn-ghost h-8" name="op" value="delete">Delete</ConfirmButton>}
          </BulkBar>

          <div className="panel overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th w-8"><SelectAll /></th>
                <th className="th">Lead</th><th className="th">Stage</th><th className="th">Project</th><th className="th">Assigned</th><th className="th">Next follow-up</th><th className="th text-right">Age · activity</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7}><Empty emoji="thinking">No leads match these filters.</Empty></td></tr>}
                {rows.map((l, i) => {
                  const overdue = l.next_followup_at && new Date(l.next_followup_at) < new Date() && l.stage?.kind === "open";
                  const owner = l.assigned_to ? refs.staffName.get(l.assigned_to) ?? "–" : null;
                  const [age, ageTone] = ageing(l.created_at);
                  const nav = new URLSearchParams(qsNow); nav.set("i", String((page - 1) * PAGE + i));
                  return (
                    <tr key={l.id} className="row">
                      <td className="td w-8"><input type="checkbox" name="ids" value={l.id} aria-label={`Select ${l.person.full_name ?? l.person.phone_e164}`} className="h-4 w-4 accent-[rgb(var(--accent))]" /></td>
                      <td className="td">
                        <div className="flex items-center gap-3">
                          <Avatar name={l.person.full_name || l.person.phone_e164} size={30} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Link href={`/leads/${l.id}?${nav}`} className="truncate font-medium hover:underline">{l.person.full_name || "No name"}</Link>
                              <TempBadge t={l.temperature} />
                              {l.priority === "High" && <span className="rounded-full bg-accent/15 px-1.5 text-[10.5px] font-semibold text-accent-2">HIGH</span>}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-mute">
                              <span className="tabular-nums">{l.person.phone_e164}</span>
                              {l.person.city && <span>· {l.person.city}</span>}
                              {l.reenquiry_count > 0 && <span className="text-warn">· re-enquired ×{l.reenquiry_count}</span>}
                              {!l.first_contacted_at && l.stage?.kind === "open" && <span className="text-bad">· never contacted</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="td">{l.stage && <StageBadge name={l.stage.name} kind={l.stage.kind} />}</td>
                      <td className="td"><div className="whitespace-nowrap">{l.project?.name ?? "–"}</div><div className="whitespace-nowrap text-[12px] text-mute">{l.source?.name ?? "No source"}</div></td>
                      <td className="td">{owner ? <span className="flex items-center gap-2 whitespace-nowrap"><Avatar name={owner} size={20} />{owner}</span> : <span className="text-bad">Unassigned</span>}</td>
                      <td className={`td whitespace-nowrap ${overdue ? "font-medium text-bad" : ""}`}>{dateTime(l.next_followup_at)}</td>
                      <td className="td whitespace-nowrap text-right"><span className={`text-[12px] font-semibold ${ageTone}`}>{age}</span><div className="text-[12px] text-mute">{ago(l.last_activity_at)}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>

        <div className="flex items-center justify-between text-[12.5px]">
          <span className="text-mute">Page {page} of {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className="btn-quiet" href={qs({ page: String(page - 1) })}>Previous</Link>}
            {page < pages && <Link className="btn-quiet" href={qs({ page: String(page + 1) })}>Next</Link>}
          </div>
        </div>
      </Page>
    </>
  );
}

function Select({ name, label, value, options, all = true }: { name: string; label: string; value?: string; options: { id: string; name: string }[]; all?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={value ?? ""} className="input">
        {all && <option value="">All</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}
