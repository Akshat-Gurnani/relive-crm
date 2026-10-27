import type { SupabaseClient } from "@supabase/supabase-js";
import { one } from "@/lib/format";

export type SP = Record<string, string | string[] | undefined>;
export const LIST_SELECT =
  "id,temperature,priority,assigned_to,next_followup_at,next_followup_note,last_activity_at,created_at,first_contacted_at,reenquiry_count,stage_id,rotation_count,stage:stages(name,kind),project:projects(name),source:sources(name),person:people!inner(full_name,phone_e164,city,email)";

export const SORTS: Record<string, { col: string; asc: boolean; label: string }> = {
  activity: { col: "last_activity_at", asc: false, label: "Last activity" },
  newest: { col: "created_at", asc: false, label: "Newest first" },
  oldest: { col: "created_at", asc: true, label: "Oldest first" },
  followup: { col: "next_followup_at", asc: true, label: "Next follow-up" },
};

// The filters a list URL can carry. Used by the list, the export and previous/next on a lead.
export const FILTER_KEYS = ["q", "view", "stage", "project", "source", "assignee", "temp", "priority", "from", "to", "fu_from", "fu_to", "sort", "channel", "vendor", "campaign", "qual", "tag", "interest"];

export function applyLeadFilters<T>(query: T, sp: SP, ctx: { userId: string; openStageIds: string[] }): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  const view = one(sp.view) ?? "all";
  for (const [param, col] of [["stage", "stage_id"], ["project", "project_id"], ["source", "source_id"], ["assignee", "assigned_to"], ["temp", "temperature"], ["priority", "priority"], ["channel", "provider"], ["vendor", "vendor_id"], ["qual", "qualification"]] as const) {
    const v = one(sp[param]);
    if (v) q = v === "none" && ["assignee", "project", "source"].includes(param) ? q.is(col, null) : q.eq(col, v);
  }
  const ist = (d: string, end = false) => `${d}T${end ? "23:59:59.999" : "00:00:00"}+05:30`;
  const from = one(sp.from), to = one(sp.to), fuFrom = one(sp.fu_from), fuTo = one(sp.fu_to);
  if (from) q = q.gte("created_at", ist(from));
  if (to) q = q.lte("created_at", ist(to, true));
  if (fuFrom) q = q.gte("next_followup_at", ist(fuFrom));
  if (fuTo) q = q.lte("next_followup_at", ist(fuTo, true));
  if (view === "unassigned") q = q.is("assigned_to", null);
  if (view === "uncontacted") q = q.is("first_contacted_at", null).in("stage_id", ctx.openStageIds);
  if (view === "overdue") q = q.lt("next_followup_at", new Date().toISOString()).in("stage_id", ctx.openStageIds);
  if (view === "reenquiry") q = q.gt("reenquiry_count", 0);
  // the dashboard tiles open these (same rules as the counts there)
  if (view === "contacted") q = q.not("first_contacted_at", "is", null);
  if (view === "converted") q = q.not("converted_at", "is", null);
  if (view === "lost") q = q.not("lost_at", "is", null);
  if (view === "mine") q = q.eq("assigned_to", ctx.userId);
  if (view === "open") q = q.in("stage_id", ctx.openStageIds);
  // campaign, ad set or ad name contains the text (from Facebook / Google ads)
  const camp = one(sp.campaign)?.replace(/[,()%*]/g, " ").trim();
  if (camp) q = q.or(`campaign_name.ilike.%${camp}%,adset_name.ilike.%${camp}%,ad_name.ilike.%${camp}%,form_name.ilike.%${camp}%`);
  const tag = one(sp.tag), interest = one(sp.interest);
  if (tag) q = q.contains("tags", [tag]);
  if (interest) q = q.contains("interests", [interest]);
  // customer name, phone, assigned owner, or owner in Cratio (needs searchSelect() in the select)
  const text = one(sp.q)?.trim().toLowerCase().replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
  if (text) {
    const digits = text.replace(/[\s+-]/g, "");
    q = q.ilike("lead_search.search_text", `%${/^\d{4,}$/.test(digits) ? digits : text}%`);
  }
  const sort = SORTS[one(sp.sort) ?? "activity"] ?? SORTS.activity;
  q = q.order(sort.col, { ascending: sort.asc, nullsFirst: false }).order("id");
  return q as T;
}

// Adds the search index to a select when the list is being searched.
export function searchSelect(select: string, sp: SP) {
  return one(sp.q)?.trim() ? `${select},lead_search!inner(search_text)` : select;
}

export async function openStageIds(sb: SupabaseClient) {
  const { data } = await sb.from("stages").select("id").eq("kind", "open");
  return ((data ?? []) as { id: string }[]).map((s) => s.id);
}

export function listQueryString(sp: SP) {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) { const v = one(sp[k]); if (v) p.set(k, v); }
  return p.toString();
}
