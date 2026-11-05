import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canLead, canManage, canWorkLeads, getStaff } from "@/lib/session";
import { ago, dateOnly, dateTime, minutes, money, one } from "@/lib/format";
import { getRefs } from "@/lib/refs";
import { applyLeadFilters, listQueryString, openStageIds, searchSelect } from "@/lib/leads-query";
import { fillTemplate, mailLink, waLink } from "@/lib/templates";
import { Avatar, Emoji, Empty, Notice, PageHeader, StageBadge, TempBadge, type EmojiName } from "@/components/ui";
import { AfterCallPrompt, CallButton, ConfirmButton } from "@/components/client";
import { TaskList } from "@/components/task-list";
import type { Call, LeadDetail, Person, Task, Template } from "@/lib/types";
import {
  ackAttention, addNote, addTask, changeStage, deleteNote, logActivity, logCall, logVisit, reassign, scheduleVisit, setFollowUp, setTemperature, updateVisit,
} from "./actions";

type SP = Record<string, string | string[] | undefined>;
type Activity = { id: string; type: string; outcome: string | null; notes: string | null; created_by: string | null; created_at: string };
type History = { id: number; from_stage_id: string | null; to_stage_id: string; changed_by: string | null; changed_at: string };
type Assignment = { id: number; from_user: string | null; to_user: string | null; reason: string; changed_by: string | null; at: string };
type Enquiry = { id: string; status: string; answer: string | null; received_at: string };
type Visit = { id: string; scheduled_at: string; done_at: string | null; notes: string | null; kind: string; status: string; outcome: string | null; feedback: string | null; location: string | null; created_by: string | null; accompanied_by: string | null };
type Note = { id: string; body: string; created_by: string | null; created_at: string };
type Change = { at: string; actor: string | null; field: string; old_value: string | null; new_value: string | null };
type View = { user_id: string; first_at: string; last_at: string; views: number };
const VISIT_KIND: Record<string, string> = { site_visit: "Site visit", meeting: "Meeting", office_visit: "Office visit", video_call: "Video call" };
const VISIT_STATUS: Record<string, string> = { planned: "Planned", done: "Done", cancelled: "Cancelled", no_show: "Customer didn't come" };
const FIELD: Record<string, string> = {
  stage_id: "Stage", assigned_to: "Owner", project_id: "Project", source_id: "Lead source", temperature: "Temperature", priority: "Priority",
  next_followup_at: "Next follow-up", next_followup_note: "Follow-up note", lost_reason_id: "Lost reason", lost_remarks: "Lost remarks",
  description: "Description", budget_min: "Budget from", budget_max: "Budget up to", budget_band: "Budget", unit_size: "Size", location_pref: "Location",
  possession_pref: "Possession", property_type: "Property type", bhk: "BHK", qualification: "Qualification", lead_type: "Lead type", tags: "Tags",
  interests: "Also interested in", attention: "Attention note", created_at: "Created", ad_id: "Ad", ad_name: "Ad", provider: "Channel", campaign_name: "Campaign", form_name: "Form", pool_rule_id: "Open pool", routing_rule_id: "Distribution rule", vendor_id: "Vendor",
};

const SELECT = "*, stage:stages(name,kind), project:projects(name), source:sources(name), vendor:vendors(name), person:people(*)";
const CHANNEL: Record<string, string> = { meta: "Facebook / Instagram", google_ads: "Google Ads", google_forms: "Google Forms", linkedin: "LinkedIn", website: "Website", webhook: "Webhook", other: "Other" };
const PLATFORM: Record<string, string> = { fb: "Facebook", ig: "Instagram", msg: "Messenger", wa: "WhatsApp", an: "Audience Network", organic: "Organic (no ad)", google: "Google" };
const TABS = ["activity", "tasks", "notes", "calls", "visits", "enquiries", "history"] as const;

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(one(sp.tab) ?? "") ? one(sp.tab)! : "activity";
  const { sb, profile, reports } = await getStaff();
  if (!canWorkLeads(profile.role)) redirect("/");

  const { data } = await sb.from("leads").select(SELECT).eq("id", id).maybeSingle();
  if (!data) notFound();
  const lead = data as unknown as LeadDetail & { person: Person };
  const person = lead.person;
  const refs = await getRefs();
  const who = (u: string | null) => (u ? refs.staffName.get(u) ?? "someone" : "system");

  // Record that this person opened the lead (at most once a minute); never blocks the page.
  await sb.rpc("touch_lead_view", { p_lead: id }).then(() => null, () => null);
  const [actRes, histRes, asgRes, enqRes, visitRes, siblingsRes, tasksRes, notesRes, callsRes, tplRes, meRes, changeRes, viewRes] = await Promise.all([
    sb.from("activities").select("id,type,outcome,notes,created_by,created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(200),
    sb.from("lead_stage_history").select("id,from_stage_id,to_stage_id,changed_by,changed_at").eq("lead_id", id).order("changed_at", { ascending: true }),
    sb.from("lead_assignments").select("id,from_user,to_user,reason,changed_by,at").eq("lead_id", id).order("at", { ascending: false }),
    sb.from("enquiries").select("id,status,answer,received_at").eq("lead_id", id).order("received_at", { ascending: false }),
    sb.from("site_visits").select("id,scheduled_at,done_at,notes,kind,status,outcome,feedback,location,created_by,accompanied_by").eq("lead_id", id).order("scheduled_at", { ascending: false }),
    sb.from("leads").select("id,project:projects(name),stage:stages(name,kind)").eq("person_id", person.id).neq("id", id),
    sb.from("tasks").select("*").eq("lead_id", id).order("status").order("due_at", { ascending: true, nullsFirst: false }),
    sb.from("lead_notes").select("id,body,created_by,created_at").eq("lead_id", id).order("created_at", { ascending: false }),
    sb.from("calls").select("id,lead_id,agent_id,direction,status,started_at,duration_seconds,provider,phone_e164,outcome,notes,recording_path").eq("lead_id", id).order("started_at", { ascending: false }).limit(200),
    sb.from("message_templates").select("id,channel,name,subject,body,active").eq("active", true).order("name"),
    sb.from("profiles").select("phone").eq("id", profile.id).maybeSingle(),
    sb.rpc("lead_history", { p_lead: id, p_limit: 300 }),
    sb.from("lead_views").select("user_id,first_at,last_at,views").eq("lead_id", id).order("last_at", { ascending: false }),
  ]);
  const changes = (changeRes.data ?? []) as Change[];
  const views = (viewRes.data ?? []) as View[];
  const stageName = new Map(refs.stages.map((s) => [s.id, s.name]));
  const history = (histRes.data ?? []) as History[];
  const assignments = (asgRes.data ?? []) as Assignment[];
  const enquiries = (enqRes.data ?? []) as Enquiry[];
  const visits = (visitRes.data ?? []) as Visit[];
  const tasks = (tasksRes.data ?? []) as Task[];
  const notes = (notesRes.data ?? []) as Note[];
  const calls = (callsRes.data ?? []) as Call[];
  const templates = (tplRes.data ?? []) as Template[];
  const siblings = (siblingsRes.data ?? []) as unknown as { id: string; project: { name: string } | null; stage: { name: string; kind: "open" | "won" | "lost" } | null }[];

  // previous and next lead in the list the agent came from
  let prev: string | null = null, next: string | null = null, pos: number | null = null, listTotal: number | null = null;
  const listQs = listQueryString(sp);
  if (one(sp.i) != null) {
    pos = Number(one(sp.i));
    const open = await openStageIds(sb);
    const from = Math.max(0, pos - 1);
    const { data: around, count } = await applyLeadFilters(sb.from("leads").select(searchSelect("id,person:people!inner(id)", sp), { count: "exact" }).range(from, pos + 1), sp, { userId: profile.id, openStageIds: open });
    const ids = ((around ?? []) as unknown as { id: string }[]).map((x) => x.id);
    const me = ids.indexOf(id);
    if (me !== -1) { prev = ids[me - 1] ?? null; next = ids[me + 1] ?? null; }
    listTotal = count ?? null;
  }
  const navHref = (target: string, delta: number) => { const p = new URLSearchParams(listQs); p.set("i", String((pos ?? 0) + delta)); return `/leads/${target}?${p}`; };
  const tabHref = (t: string) => { const p = new URLSearchParams(listQs); if (pos != null) p.set("i", String(pos)); if (t !== "activity") p.set("tab", t); const s = p.toString(); return `/leads/${id}${s ? `?${s}` : ""}`; };

  type Item = { at: string; emoji: EmojiName; label: React.ReactNode; detail?: string | null };
  const ACT: Record<string, EmojiName> = { call: "call", whatsapp: "chat", email: "envelope", meeting: "handshake", site_visit: "pin", note: "writing", re_enquiry: "recycle", system: "robot" };
  const timeline: Item[] = [
    ...((actRes.data ?? []) as Activity[]).map((a) => ({
      at: a.created_at, emoji: ACT[a.type] ?? "writing", detail: a.notes,
      label: <><b className="font-medium capitalize">{a.type.replace("_", " ")}</b>{a.created_by && <span className="text-mute"> by {who(a.created_by)}</span>}{a.outcome && <Tag>{a.outcome}</Tag>}</>,
    })),
    ...calls.map((c) => ({
      at: c.started_at, emoji: "call" as EmojiName, detail: c.notes,
      label: <><b className="font-medium">{c.direction === "incoming" ? "Incoming call" : "Call"}</b><span className="text-mute"> by {who(c.agent_id)} · {c.duration_seconds ? minutes(c.duration_seconds / 60) : c.status.replace("_", " ")}</span>{c.outcome && <Tag>{c.outcome}</Tag>}{c.provider === "android" && <Tag>logged by phone</Tag>}</>,
    })),
    ...notes.map((n) => ({ at: n.created_at, emoji: "writing" as EmojiName, detail: n.body, label: <><b className="font-medium">Note</b><span className="text-mute"> by {who(n.created_by)}</span></> })),
    ...history.map((h) => ({
      at: h.changed_at, emoji: "point-right" as EmojiName,
      label: <><span className="text-mute">Stage</span> {h.from_stage_id ? stageName.get(h.from_stage_id) ?? "?" : "created"} → {stageName.get(h.to_stage_id) ?? "?"}{h.changed_by && <span className="text-mute"> by {who(h.changed_by)}</span>}</>,
    })),
    ...assignments.filter((a) => a.reason !== "create" && a.reason !== "capture").map((a) => ({
      at: a.at, emoji: (a.reason === "rotation" ? "recycle" : "handshake") as EmojiName,
      label: <>{a.reason === "rotation" ? <><b className="font-medium">Passed on</b><span className="text-mute"> (not called in time) from {who(a.from_user)} to </span>{who(a.to_user)}</> : <><span className="text-mute">Assigned to</span> {who(a.to_user)}{a.changed_by && <span className="text-mute"> by {who(a.changed_by)}</span>}</>}</>,
    })),
    ...enquiries.map((e) => ({ at: e.received_at, emoji: "mailbox" as EmojiName, detail: e.answer ? `Answer: ${e.answer}` : null, label: <b className="font-medium">{e.status === "invalid_phone" ? "Enquiry received (phone needed fixing)" : "Enquiry received"}</b> })),
    ...visits.map((v) => ({
      at: v.done_at ?? v.scheduled_at, emoji: (v.kind === "meeting" || v.kind === "office_visit" ? "handshake" : "pin") as EmojiName,
      detail: [v.outcome, v.feedback, v.notes].filter(Boolean).join(" · ") || null,
      label: <><b className="font-medium">{VISIT_KIND[v.kind] ?? "Site visit"} {v.status === "done" ? "done" : v.status === "planned" ? "planned" : (VISIT_STATUS[v.status] ?? v.status).toLowerCase()}</b>{(v.accompanied_by ?? v.created_by) && <span className="text-mute"> by {who(v.accompanied_by ?? v.created_by)}</span>}</>,
    })),
    ...changes.filter((c) => !["stage_id", "assigned_to"].includes(c.field)).map((c) => ({
      at: c.at, emoji: "writing" as EmojiName,
      label: <><span className="text-mute">{FIELD[c.field] ?? c.field.replace(/_/g, " ")} changed</span>{c.actor && <span className="text-mute"> by {who(c.actor)}</span>}</>,
      detail: null,
    })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));

  const isLost = lead.stage?.kind === "lost";
  const manage = canLead(profile.role, reports);
  const overdue = !!lead.next_followup_at && new Date(lead.next_followup_at) < new Date() && lead.stage?.kind === "open";
  const owner = lead.assigned_to ? refs.staffName.get(lead.assigned_to) ?? "–" : null;
  const vars = { name: person.full_name?.split(" ")[0] ?? "", project: lead.project?.name ?? "our projects", agent: profile.full_name, agent_phone: (meRes.data as { phone: string | null } | null)?.phone ?? "" };
  const outcomes = refs.picklists.call_outcome ?? [];
  const openTasks = tasks.filter((t) => t.status === "open").length;
  const talk = calls.reduce((n, c) => n + c.duration_seconds, 0);
  // time spent in each stage, from the stage history
  const stageSpans = history.map((h, i) => ({ ...h, until: history[i + 1]?.changed_at ?? null }));
  const tabsMeta: [string, string, number][] = [["activity", "Activity", timeline.length], ["tasks", "Tasks", openTasks], ["notes", "Notes", notes.length], ["calls", "Calls", calls.length], ["visits", "Meetings & visits", visits.length], ["enquiries", "Enquiries", enquiries.length], ["history", "History", history.length + assignments.length + changes.length]];
  const visitsDone = visits.filter((v) => v.status === "done");
  const nextVisit = visits.filter((v) => v.status === "planned").sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at))[0];
  const inPool = !lead.assigned_to && !!(lead as unknown as { pool_rule_id?: string | null }).pool_rule_id;
  const lastChange = changes[0];
  const lastViewOther = views.find((v) => v.user_id !== profile.id) ?? views[0];
  // the value shown in the change log: ids become names
  const show = (field: string, v: string | null) => {
    if (v == null || v === "" || v === "[]") return <span className="text-faint">empty</span>;
    if (field === "stage_id") return stageName.get(v) ?? "?";
    if (field === "assigned_to") return who(v);
    if (field === "project_id") return refs.projects.find((p) => p.id === v)?.name ?? "(inactive project)";
    if (field === "source_id") return refs.sources.find((s) => s.id === v)?.name ?? "(inactive source)";
    if (field === "lost_reason_id") return refs.reasons.find((r) => r.id === v)?.name ?? "?";
    if (field.endsWith("_at")) return dateTime(v);
    if (field === "pool_rule_id" || field === "routing_rule_id" || field === "vendor_id") return "set";
    if (v.startsWith("[")) { try { return (JSON.parse(v) as string[]).join(", ") || "empty"; } catch { return v; } }
    return v.length > 140 ? `${v.slice(0, 140)}…` : v;
  };

  return (
    <>
      <PageHeader crumbs={[{ label: "Leads", href: `/leads${listQs ? `?${listQs}` : ""}` }, { label: person.full_name || "No name" }]}>
        {pos != null && (
          <div className="flex items-center gap-1">
            {prev ? <Link href={navHref(prev, -1)} className="btn-quiet h-9 w-9 px-0" aria-label="Previous lead">‹</Link> : <span className="btn-quiet h-9 w-9 px-0 opacity-40">‹</span>}
            <span className="px-1 text-[12px] tabular-nums text-mute">{pos + 1}{listTotal ? ` / ${listTotal}` : ""}</span>
            {next ? <Link href={navHref(next, 1)} className="btn-quiet h-9 w-9 px-0" aria-label="Next lead">›</Link> : <span className="btn-quiet h-9 w-9 px-0 opacity-40">›</span>}
          </div>
        )}
        {manage ? (
          <form action={reassign} className="flex items-center gap-1.5">
            <input type="hidden" name="lead_id" value={id} />
            <label className="sr-only" htmlFor="assigned_to">Assigned to</label>
            <select id="assigned_to" name="assigned_to" defaultValue={lead.assigned_to ?? ""} className="input w-40">
              {canManage(profile.role) && <option value="">Unassigned</option>}
              {refs.assignable.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <button className="btn-quiet" type="submit">Save</button>
          </form>
        ) : owner && <span className="flex items-center gap-2 text-[13px]"><Avatar name={owner} size={22} />{owner}</span>}
        <Link href={`/leads/${id}/edit`} className="btn-quiet"><Emoji name="writing" size={14} />Edit</Link>
        <CallButton leadId={id} phone={person.phone_e164} />
        <Menu label="WhatsApp" emoji="chat" primary>
          <a href={waLink(person.phone_e164)} target="_blank" rel="noreferrer" className="menu-item">Open chat</a>
          {templates.filter((t) => t.channel === "whatsapp").map((t) => (
            <a key={t.id} href={waLink(person.phone_e164, fillTemplate(t.body, vars))} target="_blank" rel="noreferrer" className="menu-item">{t.name}</a>
          ))}
        </Menu>
        {person.email && (
          <Menu label="Email" emoji="envelope">
            {templates.filter((t) => t.channel === "email").map((t) => (
              <a key={t.id} href={mailLink(person.email, t.subject && fillTemplate(t.subject, vars), fillTemplate(t.body, vars))} className="menu-item">{t.name}</a>
            ))}
            <a href={mailLink(person.email)} className="menu-item">Blank email</a>
          </Menu>
        )}
      </PageHeader>

      <div className="page-in grid grid-cols-2 border-b border-line/[.08] bg-white/[.02] backdrop-blur-xl md:grid-cols-6">
        <Stat label="Stage">{lead.stage && <StageBadge name={lead.stage.name} kind={lead.stage.kind} />}</Stat>
        <Stat label="Temperature · priority"><TempBadge t={lead.temperature} /><span className="ml-2 text-[12px] text-mute">{lead.priority}</span></Stat>
        <Stat label="Next follow-up">
          <span className={overdue ? "font-medium text-bad" : ""}>{lead.next_followup_at ? dateTime(lead.next_followup_at) : <span className="text-mute">None set</span>}</span>
          {lead.next_followup_note && <span className="block truncate text-[12px] text-mute">{lead.next_followup_note}</span>}
        </Stat>
        <Stat label="Project">{lead.project?.name ?? <span className="text-mute">None</span>}</Stat>
        <Stat label="Calls · talk time">{calls.length} <span className="text-mute">· {talk ? minutes(talk / 60) : "0"}</span></Stat>
        <Stat label="Last activity">{ago(lead.last_activity_at)}{!lead.first_contacted_at && lead.stage?.kind === "open" && <span className="block text-[12px] text-bad">never contacted</span>}</Stat>
      </div>

      {(lead as unknown as { attention?: string | null }).attention && (
        <div className="px-5 pt-4 md:px-8">
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3">
            <p className="text-[13.5px]"><b className="text-warn">Needs your attention.</b> {(lead as unknown as { attention: string }).attention}</p>
            <form action={ackAttention}><input type="hidden" name="lead_id" value={lead.id} /><button className="btn-quiet h-8" type="submit">Got it</button></form>
          </div>
        </div>
      )}

      {inPool && (
        <div className="px-5 pt-4 md:px-8">
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3">
            <p className="text-[13.5px]"><b className="text-accent-2">Open lead.</b> Everyone in this distribution rule can see it. The first person to call it keeps it.</p>
            <CallButton leadId={id} phone={person.phone_e164} />
          </div>
        </div>
      )}

      {(one(sp.error) || one(sp.notice)) &&<div className="space-y-2 px-5 pt-4 md:px-8">{one(sp.error) && <Notice>{one(sp.error)}</Notice>}{one(sp.notice) && <Notice tone="warn">{one(sp.notice)}</Notice>}</div>}

      <div className="flex flex-col xl:flex-row">
        <div className="min-w-0 flex-1">
          <nav className="flex gap-5 overflow-x-auto border-b border-line/10 px-5 md:px-8" aria-label="Lead sections">
            {tabsMeta.map(([k, label, n]) => (
              <Link key={k} href={tabHref(k)} className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 py-3 text-[13px] transition-colors duration-200 ${tab === k ? "border-accent font-semibold text-ink" : "border-transparent text-mute hover:text-ink"}`}>
                {label}{n ? <span className="rounded-full bg-white/[.06] px-1.5 text-[11px] text-mute">{n}</span> : null}
              </Link>
            ))}
          </nav>

          <div className="stagger space-y-6 px-5 py-6 md:px-8">
            {tab === "activity" && <>
              <section className="panel">
                <div className="panel-head"><h2 className="panel-title">Log what happened</h2><Emoji name="writing" /></div>
                <form action={logActivity} className="grid gap-3 p-4 md:grid-cols-4">
                  <input type="hidden" name="lead_id" value={id} />
                  <div><label className="label" htmlFor="type">Type</label>
                    <select id="type" name="type" className="input" defaultValue="call">
                      <option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option>
                      <option value="meeting">Meeting</option><option value="note">Note</option>
                    </select></div>
                  <div className="md:col-span-3"><label className="label" htmlFor="outcome">Outcome</label>
                    <select id="outcome" name="outcome" className="input" defaultValue="">
                      <option value="">–</option>{outcomes.map((o) => <option key={o}>{o}</option>)}
                    </select></div>
                  <div className="md:col-span-4"><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={3} className="input" placeholder="What did they say? Budget, timing, objections…" /></div>
                  <div className="md:col-span-2"><label className="label" htmlFor="next_followup_at">Next follow-up</label><input id="next_followup_at" name="next_followup_at" type="datetime-local" className="input" /></div>
                  <div className="md:col-span-2"><label className="label" htmlFor="next_followup_note">Follow-up note</label><input id="next_followup_note" name="next_followup_note" className="input" placeholder="What to do on that call" /></div>
                  <div className="flex justify-end md:col-span-4"><button className="btn" type="submit">Save activity</button></div>
                </form>
              </section>
              <section>
                <h2 className="display mb-4 text-[17px]">Timeline</h2>
                {timeline.length === 0 ? <Empty emoji="sparkles">Nothing logged yet.</Empty> : (
                  <ol className="stagger relative space-y-5 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-gradient-to-b before:from-accent/50 before:via-white/10 before:to-transparent">
                    {timeline.map((t, i) => (
                      <li key={i} className="relative flex gap-3.5">
                        <span className="relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line/10 bg-white/[.05]"><Emoji name={t.emoji} size={14} /></span>
                        <div className="min-w-0 flex-1 pt-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <div className="text-[13px]">{t.label}</div>
                            <time className="whitespace-nowrap text-[12px] text-mute" title={dateTime(t.at)}>{ago(t.at)}</time>
                          </div>
                          {t.detail && <p className="glass mt-1.5 whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-relaxed text-ink/90">{t.detail}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>}

            {tab === "tasks" && (
              <section className="panel">
                <div className="panel-head"><h2 className="panel-title">Tasks</h2><Emoji name="check" /></div>
                <form action={addTask} className="grid gap-2 border-b border-line/10 p-4 md:grid-cols-[1fr_10rem_12rem_auto]">
                  <input type="hidden" name="lead_id" value={id} />
                  <input name="title" className="input" placeholder="What needs doing, e.g. send price sheet" aria-label="Task" required />
                  <select name="category" className="input" aria-label="Category" defaultValue=""><option value="">Category</option>{(refs.picklists.task_category ?? []).map((c) => <option key={c}>{c}</option>)}</select>
                  <input name="due_at" type="datetime-local" className="input" aria-label="Due" />
                  {manage ? (
                    <div className="flex gap-2 md:col-span-4">
                      <select name="assigned_to" className="input md:w-60" aria-label="Assign to" defaultValue={profile.id}>{refs.assignable.concat(refs.staff.filter((s) => s.id === profile.id && !refs.assignable.some((a) => a.id === s.id))).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
                      <button className="btn" type="submit">Add task</button>
                    </div>
                  ) : <button className="btn" type="submit">Add task</button>}
                </form>
                {tasks.length === 0 ? <Empty emoji="check">No tasks on this lead.</Empty> : <TaskList tasks={tasks} who={who} ret={tabHref("tasks")} />}
              </section>
            )}

            {tab === "notes" && (
              <section className="panel">
                <div className="panel-head"><h2 className="panel-title">Notes</h2><Emoji name="writing" /></div>
                <form action={addNote} className="flex flex-col gap-2 border-b border-line/10 p-4">
                  <input type="hidden" name="lead_id" value={id} />
                  <textarea name="body" rows={3} className="input" placeholder="Anything worth remembering about this person" aria-label="Note" required />
                  <button className="btn self-end" type="submit">Add note</button>
                </form>
                {notes.length === 0 ? <Empty emoji="writing">No notes yet.</Empty> : (
                  <ul>{notes.map((n) => (
                    <li key={n.id} className="row px-4 py-3">
                      <div className="flex items-center justify-between gap-3 text-[12px] text-mute">
                        <span>{who(n.created_by)} · {dateTime(n.created_at)}</span>
                        {(n.created_by === profile.id || profile.role === "admin") && (
                          <form action={deleteNote}><input type="hidden" name="lead_id" value={id} /><input type="hidden" name="note_id" value={n.id} /><ConfirmButton className="btn-ghost h-7 text-[12px]">Delete</ConfirmButton></form>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
                    </li>
                  ))}</ul>
                )}
              </section>
            )}

            {tab === "calls" && (
              <section className="panel">
                <div className="panel-head"><h2 className="panel-title">Calls</h2><span className="text-[12px] text-mute">{calls.length} calls · {talk ? minutes(talk / 60) : "0"} talk time</span></div>
                <form action={logCall} className="grid gap-2 border-b border-line/10 p-4 md:grid-cols-4">
                  <input type="hidden" name="lead_id" value={id} />
                  <select name="direction" className="input" aria-label="Direction" defaultValue="outgoing"><option value="outgoing">Outgoing</option><option value="incoming">Incoming</option></select>
                  <select name="outcome" className="input md:col-span-2" aria-label="Outcome" defaultValue=""><option value="">Outcome…</option>{outcomes.map((o) => <option key={o}>{o}</option>)}</select>
                  <input name="duration_seconds" type="number" min={0} className="input" placeholder="Talk time (seconds)" aria-label="Talk time in seconds" />
                  <input name="notes" className="input md:col-span-2" placeholder="Notes" aria-label="Call notes" />
                  <input name="next_followup_at" type="datetime-local" className="input" aria-label="Next follow-up" />
                  <button className="btn" type="submit">Log call</button>
                </form>
                {calls.length === 0 ? <Empty emoji="call">No calls yet. Calls made from the Android app appear here on their own.</Empty> : (
                  <div className="overflow-x-auto"><table className="w-full">
                    <thead><tr><th className="th">When</th><th className="th">Type</th><th className="th">By</th><th className="th text-right">Duration</th><th className="th">Outcome</th><th className="th">Recording</th></tr></thead>
                    <tbody>{calls.map((c) => (
                      <tr key={c.id} className="row">
                        <td className="td whitespace-nowrap">{dateTime(c.started_at)}</td>
                        <td className="td"><span className={c.status === "connected" ? "text-won" : c.status === "missed" ? "text-bad" : "text-mute"}>{c.direction === "incoming" ? "Incoming" : "Outgoing"} · {c.status.replace("_", " ")}</span></td>
                        <td className="td">{who(c.agent_id)}{c.provider === "android" && <span className="ml-1 text-[11px] text-faint">phone</span>}</td>
                        <td className="td text-right tabular-nums">{Math.floor(c.duration_seconds / 60)}:{String(c.duration_seconds % 60).padStart(2, "0")}</td>
                        <td className="td">{c.outcome ?? <span className="text-faint">–</span>}{c.notes && <div className="text-[12px] text-mute">{c.notes}</div>}</td>
                        <td className="td">{c.recording_path ? <a href={`/calls/recording/${c.id}`} target="_blank" rel="noreferrer" className="text-accent-2 hover:underline">▶ Play</a> : <span className="text-faint">–</span>}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
              </section>
            )}

            {tab === "visits" && <>
              <section id="log" className="panel">
                <div className="panel-head"><h2 className="panel-title">Log a meeting or site visit that happened</h2><Emoji name="handshake" /></div>
                <form action={logVisit} className="grid gap-3 p-4 md:grid-cols-4">
                  <input type="hidden" name="lead_id" value={id} />
                  <div><label className="label" htmlFor="lv_kind">Type</label>
                    <select id="lv_kind" name="kind" className="input" defaultValue="site_visit">{Object.entries(VISIT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                  <div><label className="label" htmlFor="lv_at">When</label><input id="lv_at" name="done_at" type="datetime-local" className="input" required /></div>
                  <div className="md:col-span-2"><label className="label" htmlFor="lv_loc">Where</label><input id="lv_loc" name="location" className="input" placeholder="Project site, office, customer's home…" defaultValue={lead.project?.name ?? ""} /></div>
                  <div><label className="label" htmlFor="lv_out">Outcome</label>
                    <select id="lv_out" name="outcome" className="input" defaultValue="">
                      <option value="">–</option>{(refs.picklists.visit_outcome ?? ["Liked it, wants a second visit", "Liked it, negotiating", "Booking expected", "Not interested", "Wants other options", "Family to visit"]).map((o) => <option key={o}>{o}</option>)}
                    </select></div>
                  <div className="md:col-span-3"><label className="label" htmlFor="lv_fb">What happened</label><input id="lv_fb" name="feedback" className="input" placeholder="Units seen, budget, objections, who came along" /></div>
                  <div className="md:col-span-2"><label className="label" htmlFor="lv_next">Next follow-up</label><input id="lv_next" name="next_followup_at" type="datetime-local" className="input" /></div>
                  <label className="flex items-end gap-2 pb-2 text-[13px] md:col-span-2"><input type="checkbox" name="move_stage" defaultChecked className="h-4 w-4 accent-[rgb(var(--accent))]" />Move the lead to Site Visit Done (site visits only)</label>
                  <div className="flex justify-end md:col-span-4"><button className="btn" type="submit">Save visit</button></div>
                </form>
              </section>

              <section className="panel">
                <div className="panel-head"><h2 className="panel-title">Meetings & site visits</h2><span className="text-[12px] text-mute">{visitsDone.length} done · {visits.filter((v) => v.status === "planned").length} planned</span></div>
                {visits.length === 0 ? <Empty emoji="calendar">No meeting or site visit yet.</Empty> : (
                  <ul>{visits.map((v) => (
                    <li key={v.id} className="row px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Emoji name={v.status === "done" ? "check" : v.status === "planned" ? "calendar" : "thinking"} />
                        <span className="font-medium">{VISIT_KIND[v.kind] ?? "Site visit"}</span>
                        <span className="text-mute">{dateTime(v.done_at ?? v.scheduled_at)}</span>
                        <span className={v.status === "done" ? "text-won" : v.status === "planned" ? "text-accent-2" : "text-bad"}>{VISIT_STATUS[v.status] ?? v.status}</span>
                        {(v.accompanied_by ?? v.created_by) && <span className="text-[12px] text-mute">by {who(v.accompanied_by ?? v.created_by)}</span>}
                        {v.location && <span className="text-[12px] text-mute">· {v.location}</span>}
                      </div>
                      {(v.outcome || v.feedback || v.notes) && <p className="mt-1 text-[13px] text-ink/85">{[v.outcome, v.feedback, v.notes].filter(Boolean).join(" · ")}</p>}
                      {v.status === "planned" && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[12.5px] text-accent-2 underline">Update this visit</summary>
                          <form action={updateVisit} className="mt-2 grid gap-2 md:grid-cols-4">
                            <input type="hidden" name="lead_id" value={id} /><input type="hidden" name="visit_id" value={v.id} /><input type="hidden" name="kind" value={v.kind} />
                            <select name="status" className="input" defaultValue="done" aria-label="What happened"><option value="done">It happened</option><option value="no_show">Customer didn&apos;t come</option><option value="cancelled">Cancelled</option></select>
                            <select name="outcome" className="input" defaultValue="" aria-label="Outcome"><option value="">Outcome…</option>{(refs.picklists.visit_outcome ?? ["Liked it, wants a second visit", "Liked it, negotiating", "Booking expected", "Not interested", "Wants other options", "Family to visit"]).map((o) => <option key={o}>{o}</option>)}</select>
                            <input name="feedback" className="input md:col-span-2" placeholder="What happened" aria-label="Feedback" />
                            <div className="flex justify-end md:col-span-4"><button className="btn-quiet h-8" type="submit">Save</button></div>
                          </form>
                        </details>
                      )}
                    </li>
                  ))}</ul>
                )}
                <form action={scheduleVisit} className="grid gap-2 border-t border-line/10 p-4 md:grid-cols-[10rem_13rem_1fr_auto]">
                  <input type="hidden" name="lead_id" value={id} />
                  <select name="kind" className="input" defaultValue="site_visit" aria-label="Type">{Object.entries(VISIT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <input name="scheduled_at" type="datetime-local" className="input" required aria-label="Visit time" />
                  <input name="notes" className="input" placeholder="Notes (pickup, who joins)" aria-label="Visit notes" />
                  <button className="btn" type="submit">Plan it</button>
                </form>
              </section>
            </>}

            {tab === "enquiries" && (
              <section className="panel">
                <div className="panel-head"><h2 className="panel-title">Enquiries from forms</h2><Emoji name="mailbox" /></div>
                {enquiries.length === 0 ? <Empty emoji="mailbox">No form enquiries recorded.</Empty> : (
                  <ul>{enquiries.map((e) => (
                    <li key={e.id} className="row flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="font-medium">{dateTime(e.received_at)}</span>
                      <span className="text-mute">{e.answer ?? "No answer captured"}</span>
                      {e.status === "invalid_phone" && <span className="text-warn">phone needed fixing</span>}
                    </li>
                  ))}</ul>
                )}
              </section>
            )}

            {tab === "history" && <>
              <section className="panel">
                <div className="panel-head"><h2 className="panel-title">Record</h2><Emoji name="clock" /></div>
                <dl className="grid gap-x-6 p-4 sm:grid-cols-2">
                  <div className="field"><dt>Created</dt><dd>{dateTime(lead.created_at)}{lead.created_by && <span className="text-mute"> by {who(lead.created_by)}</span>}</dd></div>
                  <div className="field"><dt>Modified</dt><dd>{dateTime(lastChange?.at ?? lead.updated_at)}{lastChange?.actor && <span className="text-mute"> by {who(lastChange.actor)}</span>}</dd></div>
                  <div className="field"><dt>Last touched</dt><dd>{lead.last_activity_at ? `${dateTime(lead.last_activity_at)} (${ago(lead.last_activity_at)})` : <span className="text-bad">Never</span>}</dd></div>
                  <div className="field"><dt>Last viewed</dt><dd>{lastViewOther ? <>{dateTime(lastViewOther.last_at)} <span className="text-mute">by {who(lastViewOther.user_id)}</span></> : "–"}</dd></div>
                </dl>
              </section>
              <section className="panel overflow-x-auto">
                <div className="panel-head"><h2 className="panel-title">Changes</h2><span className="text-[12px] text-mute">every field edit, newest first</span></div>
                {changes.length === 0 ? <Empty emoji="writing">No edits recorded yet.</Empty> : (
                  <table className="w-full">
                    <thead><tr><th className="th">When</th><th className="th">Who</th><th className="th">Field</th><th className="th">From</th><th className="th">To</th></tr></thead>
                    <tbody>{changes.map((c, i) => (
                      <tr key={i} className="row align-top">
                        <td className="td whitespace-nowrap text-mute">{dateTime(c.at)}</td>
                        <td className="td">{who(c.actor)}</td>
                        <td className="td">{FIELD[c.field] ?? c.field.replace(/_/g, " ")}</td>
                        <td className="td text-mute">{show(c.field, c.old_value)}</td>
                        <td className="td">{show(c.field, c.new_value)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </section>
              {manage && (
                <section className="panel overflow-x-auto">
                  <div className="panel-head"><h2 className="panel-title">Seen by</h2><span className="text-[12px] text-mute">who opened this lead</span></div>
                  {views.length === 0 ? <Empty emoji="glasses">Nobody has opened it since history started.</Empty> : (
                    <table className="w-full">
                      <thead><tr><th className="th">Person</th><th className="th">First opened</th><th className="th">Last opened</th><th className="th text-right">Times</th></tr></thead>
                      <tbody>{views.map((v) => (
                        <tr key={v.user_id} className="row"><td className="td">{who(v.user_id)}</td><td className="td text-mute">{dateTime(v.first_at)}</td><td className="td">{dateTime(v.last_at)}</td><td className="td text-right tabular-nums">{v.views}</td></tr>
                      ))}</tbody>
                    </table>
                  )}
                </section>
              )}
              <section className="panel overflow-x-auto">
                <div className="panel-head"><h2 className="panel-title">Stages</h2><span className="text-[12px] text-mute">time spent in each</span></div>
                <table className="w-full">
                  <thead><tr><th className="th">Stage</th><th className="th">From</th><th className="th">Time in stage</th><th className="th">Changed by</th></tr></thead>
                  <tbody>{[...stageSpans].reverse().map((h) => (
                    <tr key={h.id} className="row">
                      <td className="td">{stageName.get(h.to_stage_id)}</td>
                      <td className="td whitespace-nowrap text-mute">{dateTime(h.changed_at)}</td>
                      <td className="td">{minutes(((h.until ? +new Date(h.until) : Date.now()) - +new Date(h.changed_at)) / 60000)}{!h.until && <span className="text-[11px] text-faint"> (current)</span>}</td>
                      <td className="td">{who(h.changed_by)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </section>
              <section className="panel overflow-x-auto">
                <div className="panel-head"><h2 className="panel-title">Owners</h2><span className="text-[12px] text-mute">{lead.rotation_count ? `passed on ${lead.rotation_count} time(s)` : "never passed on"}</span></div>
                <table className="w-full">
                  <thead><tr><th className="th">When</th><th className="th">From</th><th className="th">To</th><th className="th">Why</th></tr></thead>
                  <tbody>{assignments.map((a) => (
                    <tr key={a.id} className="row">
                      <td className="td whitespace-nowrap text-mute">{dateTime(a.at)}</td>
                      <td className="td">{a.from_user ? who(a.from_user) : <span className="text-faint">–</span>}</td>
                      <td className="td">{a.to_user ? who(a.to_user) : "Unassigned"}</td>
                      <td className="td">{{ capture: "New enquiry", create: "Added by hand", manual: `Changed by ${who(a.changed_by)}`, rotation: "Not called in time", import: "Imported",
                        claim: "Called it first (open lead)", pool: "Put in the open pool", pool_timeout: "Open lead nobody called in time", fallback: "Bounced: nobody else could take it",
                        rotation_idle: "No activity for too long", rotation_ytt: "Stuck in Yet To Talk" }[a.reason] ?? a.reason}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </section>
            </>}
          </div>
        </div>

        <aside className="w-full shrink-0 border-t border-line/10 bg-white/[.02] backdrop-blur-xl xl:min-h-[calc(100vh-7.5rem)] xl:w-[22rem] xl:border-l xl:border-t-0">
          <div className="flex items-center gap-3 border-b border-line/10 px-5 py-4">
            <Avatar name={person.full_name || person.phone_e164} size={44} />
            <div className="min-w-0">
              <div className="display truncate text-[18px]">{person.full_name || "No name"}</div>
              <a href={`tel:${person.phone_e164}`} className="tabular-nums text-mute hover:text-ink">{person.phone_e164}</a>
            </div>
          </div>

          <Side title="Stage">
            <form action={changeStage} className="space-y-2">
              <input type="hidden" name="lead_id" value={id} />
              <select name="stage_id" defaultValue={lead.stage_id} className="input" aria-label="Stage">
                {refs.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <details open={isLost} className="lost-reason">
                <summary className="cursor-pointer list-none text-[12px] text-mute hover:text-ink">{isLost ? "Lost reason" : "Marking lost? Add a reason"}</summary>
                <div className="mt-2 space-y-2">
                  <select name="lost_reason_id" defaultValue={lead.lost_reason_id ?? ""} className="input" aria-label="Lost reason">
                    <option value="">Reason…</option>{refs.reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <input name="lost_remarks" defaultValue={lead.lost_remarks ?? ""} className="input" placeholder="Remarks (optional)" aria-label="Lost remarks" />
                </div>
              </details>
              <button className="btn w-full" type="submit">Update stage</button>
            </form>
            <form action={setTemperature} className="mt-2 flex gap-2">
              <input type="hidden" name="lead_id" value={id} />
              <select name="temperature" defaultValue={lead.temperature} className="input" aria-label="Temperature">
                <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
              </select>
              <button className="btn-quiet" type="submit">Set</button>
            </form>
          </Side>

          <Side title={<span className="flex items-center justify-between">Meetings & site visits <Link href={`${tabHref("visits")}#log`} className="text-[12px] font-normal text-accent-2 hover:underline">Log one</Link></span>}>
            <p className="text-[13px]">{visitsDone.length ? <><b>{visitsDone.length}</b> done · last {dateOnly(visitsDone[0].done_at)}</> : <span className="text-mute">None done yet</span>}</p>
            {nextVisit && <p className="mt-1 text-[12.5px] text-accent-2">Next: {VISIT_KIND[nextVisit.kind] ?? "Site visit"} on {dateTime(nextVisit.scheduled_at)}</p>}
          </Side>

          <Side title="Follow-up">
            <form action={setFollowUp} className="space-y-2">
              <input type="hidden" name="lead_id" value={id} />
              <input name="next_followup_at" type="datetime-local" className="input" aria-label="Follow-up time" />
              <input name="next_followup_note" defaultValue={lead.next_followup_note ?? ""} className="input" placeholder="Note" aria-label="Follow-up note" />
              <button className="btn-quiet w-full" type="submit">Set follow-up</button>
              <p className="text-[11.5px] text-faint">Leave the time empty to clear it.</p>
            </form>
          </Side>

          <Side title={<span className="flex items-center justify-between">Details <Link href={`/leads/${id}/edit`} className="text-[12px] font-normal text-accent-2 hover:underline">Edit all</Link></span>}>
            {(lead.provider || lead.campaign_name || lead.campaign_id) && (
              <div className="mb-3 rounded-lg border border-line/10 bg-white/[.03] p-2.5">
                <div className="eyebrow mb-1">Came from</div>
                <dl>
                  <Field k="Channel" v={[lead.provider ? CHANNEL[lead.provider] ?? lead.provider : null, lead.platform ? PLATFORM[lead.platform] ?? lead.platform : null].filter(Boolean).join(" · ") || null} />
                  <Field k="Campaign" v={lead.campaign_name ?? lead.campaign_id} />
                  <Field k="Ad set" v={lead.adset_name ?? lead.adset_id} />
                  <Field k="Ad" v={lead.ad_name ?? lead.ad_id} />
                  <Field k="Form" v={lead.form_name ?? lead.form_id} />
                </dl>
              </div>
            )}
            <dl>
              <Field k="Lead source" v={lead.source?.name} />
              <Field k="Qualification" v={lead.qualification} />
              <Field k="Lead type" v={lead.lead_type} />
              <Field k="Property type" v={[lead.property_type, lead.bhk].filter(Boolean).join(", ") || null} />
              <Field k="Budget" v={lead.budget_band ?? (lead.budget_max ? `up to ${money(lead.budget_max)}` : null)} />
              <Field k="Size" v={lead.unit_size} />
              <Field k="Location" v={lead.location_pref} />
              <Field k="Possession" v={lead.possession_pref} />
              <Field k="City" v={person.city} />
              <Field k="Email" v={person.email} />
              <Field k="Alternate" v={person.alt_phone} />
              <Field k="Company" v={[person.company, person.designation].filter(Boolean).join(", ") || null} />
              <Field k="Birthday" v={person.birthday} />
              <Field k="Created" v={dateTime(lead.created_at)} />
              <div className="field"><dt>First contact</dt><dd>{lead.first_contacted_at ? dateTime(lead.first_contacted_at) : <span className="text-bad">Not yet</span>}</dd></div>
              {lead.reenquiry_count > 0 && <div className="field"><dt>Re-enquired</dt><dd className="text-warn">{lead.reenquiry_count} times</dd></div>}
            </dl>
            {(lead.tags?.length > 0 || lead.interests?.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {lead.tags.map((t) => <Link key={`t${t}`} href={`/leads?tag=${encodeURIComponent(t)}`} className="rounded-full bg-accent/15 px-2 py-0.5 text-[11.5px] font-semibold text-accent-2 hover:underline">{t}</Link>)}
                {lead.interests.map((t) => <Link key={`i${t}`} href={`/leads?interest=${encodeURIComponent(t)}`} className="rounded-full border border-line/15 px-2 py-0.5 text-[11.5px] text-mute hover:underline">Also: {t}</Link>)}
              </div>
            )}
            {lead.description && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/[.03] p-2.5 text-[12.5px] text-ink/85">{lead.description}</p>}
            {lead.legacy && Object.keys(lead.legacy).length > 0 && (
              <details className="mt-3 rounded-lg border border-line/10 bg-white/[.03] p-2.5">
                <summary className="eyebrow cursor-pointer list-none">As it was in Cratio ▾</summary>
                <dl className="mt-1.5">{Object.entries(lead.legacy).map(([k, v]) => <Field key={k} k={k} v={String(v)} />)}</dl>
              </details>
            )}
            {siblings.length > 0 && (
              <div className="mt-3">
                <div className="eyebrow mb-1.5">Also interested in</div>
                <ul className="space-y-1">{siblings.map((s) => (
                  <li key={s.id}><Link className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-white/[.06]" href={`/leads/${s.id}`}><span>{s.project?.name ?? "No project"}</span>{s.stage && <StageBadge name={s.stage.name} kind={s.stage.kind} />}</Link></li>
                ))}</ul>
              </div>
            )}
          </Side>
        </aside>
      </div>
      <AfterCallPrompt action={logCall} outcomes={outcomes.slice(0, 6)} />
    </>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="ml-1.5 rounded border border-line/10 px-1.5 py-px text-[11.5px] text-mute">{children}</span>;
}
function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 border-r border-line/10 px-5 py-3 last:border-r-0 md:px-6"><div className="text-[11.5px] text-mute">{label}</div><div className="mt-1 text-[13.5px]">{children}</div></div>;
}
function Side({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return <section className="border-b border-line/10 px-5 py-4 last:border-b-0"><h3 className="mb-2.5 text-[12.5px] font-semibold">{title}</h3>{children}</section>;
}
function Field({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return <div className="field"><dt>{k}</dt><dd>{v}</dd></div>;
}
function Menu({ label, emoji, children, primary }: { label: string; emoji: EmojiName; children: React.ReactNode; primary?: boolean }) {
  return (
    <details className="relative">
      <summary className={`${primary ? "btn" : "btn-quiet"} cursor-pointer list-none`}><Emoji name={emoji} size={14} />{label}<span className="text-[10px] opacity-70">▾</span></summary>
      <div className="glass page-in absolute right-0 z-30 mt-2 flex w-64 flex-col rounded-xl p-1.5">{children}</div>
    </details>
  );
}
