import { sb } from "./supabase";

export type Stage = { id: string; name: string; kind: "open" | "won" | "lost"; position: number };
export type LeadRow = {
  id: string; temperature: "hot" | "warm" | "cold"; priority: string; assigned_to: string | null; next_followup_at: string | null; next_followup_note: string | null;
  last_activity_at: string; created_at: string; first_contacted_at: string | null; reenquiry_count: number; stage_id: string;
  stage: { name: string; kind: "open" | "won" | "lost" } | null; project: { name: string } | null; source: { name: string } | null;
  person: { full_name: string | null; phone_e164: string; city: string | null };
};
export const LEAD_SELECT = "id,temperature,priority,assigned_to,next_followup_at,next_followup_note,last_activity_at,created_at,first_contacted_at,reenquiry_count,stage_id,stage:stages(name,kind),project:projects(name),source:sources(name),person:people!inner(full_name,phone_e164,city)";

let refsCache: Awaited<ReturnType<typeof loadRefs>> | null = null;
async function loadRefs() {
  const c = await sb();
  const [stages, projects, sources, reasons, picks, staff, templates] = await Promise.all([
    c.from("stages").select("id,name,kind,position").order("position"),
    c.from("projects").select("id,name").eq("active", true).order("name"),
    c.from("sources").select("id,name").eq("active", true).order("name"),
    c.from("lost_reasons").select("id,name").eq("active", true).order("name"),
    c.from("picklist_values").select("list,value").eq("active", true).order("position"),
    c.from("staff_directory").select("id,full_name,role,active").order("full_name"),
    c.from("message_templates").select("id,channel,name,subject,body").eq("active", true).order("name"),
  ]);
  const picklists: Record<string, string[]> = {};
  for (const p of (picks.data ?? []) as { list: string; value: string }[]) (picklists[p.list] ??= []).push(p.value);
  const staffList = (staff.data ?? []) as { id: string; full_name: string; role: string; active: boolean }[];
  return {
    stages: (stages.data ?? []) as Stage[],
    projects: (projects.data ?? []) as { id: string; name: string }[],
    sources: (sources.data ?? []) as { id: string; name: string }[],
    reasons: (reasons.data ?? []) as { id: string; name: string }[],
    picklists,
    staff: staffList,
    staffName: new Map(staffList.map((x) => [x.id, x.full_name])),
    templates: (templates.data ?? []) as { id: string; channel: string; name: string; subject: string | null; body: string }[],
  };
}
export async function refs(force = false) {
  if (!refsCache || force) refsCache = await loadRefs();
  return refsCache;
}
export function clearRefs() { refsCache = null; }

export async function openStageIds() {
  return (await refs()).stages.filter((s) => s.kind === "open").map((s) => s.id);
}

// The agent's day, same order as the web follow-up queue: first calls, overdue, due today, coming up.
export async function myQueue(userId: string) {
  const c = await sb();
  const open = await openStageIds();
  const [fresh, due] = await Promise.all([
    c.from("leads").select(LEAD_SELECT).eq("assigned_to", userId).is("first_contacted_at", null).in("stage_id", open).order("created_at", { ascending: true }).limit(100),
    c.from("leads").select(LEAD_SELECT).eq("assigned_to", userId).not("next_followup_at", "is", null).in("stage_id", open).order("next_followup_at", { ascending: true }).limit(300),
  ]);
  const scheduled = (due.data ?? []) as unknown as LeadRow[];
  const now = Date.now();
  const endToday = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())}T23:59:59.999+05:30`).getTime();
  return {
    fresh: (fresh.data ?? []) as unknown as LeadRow[],
    overdue: scheduled.filter((l) => +new Date(l.next_followup_at!) < now),
    today: scheduled.filter((l) => { const t = +new Date(l.next_followup_at!); return t >= now && t <= endToday; }),
    later: scheduled.filter((l) => +new Date(l.next_followup_at!) > endToday).slice(0, 30),
  };
}

export async function searchLeads(opts: { q?: string; mine?: string | null; page: number; view?: string }) {
  const c = await sb();
  const text = opts.q?.trim().toLowerCase().replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
  // search covers customer name, phone, assigned owner and owner in Cratio (lead_search table)
  let q = c.from("leads").select(text ? `${LEAD_SELECT},lead_search!inner(search_text)` : LEAD_SELECT, { count: "exact" }).order("last_activity_at", { ascending: false }).range(opts.page * 30, opts.page * 30 + 29);
  if (opts.mine) q = q.eq("assigned_to", opts.mine);
  if (opts.view === "open") q = q.in("stage_id", await openStageIds());
  if (opts.view === "hot") q = q.eq("temperature", "hot").in("stage_id", await openStageIds());
  if (text) {
    const digits = text.replace(/[\s+-]/g, "");
    q = q.ilike("lead_search.search_text", `%${/^\d{4,}$/.test(digits) ? digits : text}%`);
  }
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as LeadRow[], count: count ?? 0 };
}
