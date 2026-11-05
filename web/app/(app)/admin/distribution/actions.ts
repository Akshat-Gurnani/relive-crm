"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";

const back = (p: Record<string, string> = {}): never => { revalidatePath("/admin/distribution"); redirect(`/admin/distribution?${new URLSearchParams(p)}`); };
async function admin() {
  const s = await getStaff();
  if (s.profile.role !== "admin") redirect("/admin?error=" + encodeURIComponent("Only admins can change distribution rules."));
  return s;
}
const userIds = (f: FormData) => [...new Set(f.getAll("user_ids").map((v) => String(v).trim()).filter(Boolean))];

// Rows that make up one rule: the people who take turns. Existing people keep their rotation count; removed people go; new ones join the end.
async function syncMembers(sb: Awaited<ReturnType<typeof admin>>["sb"], ruleId: string, wanted: string[]) {
  const { data } = await sb.from("routing_members").select("user_id,position").eq("rule_id", ruleId);
  const have = new Map(((data ?? []) as { user_id: string; position: number }[]).map((m) => [m.user_id, m.position]));
  const drop = [...have.keys()].filter((u) => !wanted.includes(u));
  if (drop.length) {
    const { error } = await sb.from("routing_members").delete().eq("rule_id", ruleId).in("user_id", drop);
    if (error) return error;
  }
  let pos = Math.max(0, ...have.values());
  const add = wanted.filter((u) => !have.has(u)).map((u) => ({ rule_id: ruleId, user_id: u, position: ++pos, share: 1 }));
  if (add.length) {
    const { error } = await sb.from("routing_members").insert(add);
    if (error) return error;
  }
  return null;
}

export async function createRule(formData: FormData) {
  const { sb } = await admin();
  const project = String(formData.get("project_id") ?? "");
  const users = userIds(formData);
  if (!project) back({ error: "Choose the product category first." });
  if (!users.length) back({ error: "Tick at least one person." });
  const { data: p } = await sb.from("projects").select("name").eq("id", project).single();
  const { data: same } = await sb.from("routing_rules").select("id,form_ids,campaign_ids,adset_ids,ad_ids,name_contains").eq("match_project_id", project);
  const dup = ((same ?? []) as { form_ids: string[]; campaign_ids: string[]; adset_ids: string[]; ad_ids: string[]; name_contains: string | null }[])
    .filter((r) => !r.form_ids.length && !r.campaign_ids.length && !r.adset_ids.length && !r.ad_ids.length && !r.name_contains);
  if (dup.length) back({ error: `There is already a rule for ${p?.name ?? "that category"}. Edit it instead.` });
  const { data, error } = await sb.from("routing_rules").insert({ name: p?.name ?? "Rule", position: 100, match_project_id: project }).select("id").single();
  if (error || !data) back({ error: error?.message ?? "Could not create the rule." });
  const e2 = await syncMembers(sb, data!.id, users);
  back(e2 ? { error: e2.message } : { notice: `Rule created for ${p?.name}: ${users.length} people take turns.` });
}

export async function saveRule(formData: FormData) {
  const { sb } = await admin();
  const id = String(formData.get("id"));
  const users = userIds(formData);
  if (!users.length) back({ error: "A rule needs at least one person. Delete the rule instead if nobody should take these leads." });
  const e = await syncMembers(sb, id, users);
  await sb.from("routing_rules").update({ updated_at: new Date().toISOString() }).eq("id", id);
  back(e ? { error: e.message } : { notice: "Saved. Applies to leads that arrive from now on." });
}

export async function deleteRule(formData: FormData) {
  const { sb } = await admin();
  const { error } = await sb.from("routing_rules").delete().eq("id", String(formData.get("id")));
  back(error ? { error: error.message } : { notice: "Rule deleted. Leads already handed out stay where they are." });
}

// Open pool: every member of the rule is alerted and the first to call keeps the lead.
export async function setClaimMode(formData: FormData) {
  const { sb } = await admin();
  const on = formData.get("claim_mode") === "on";
  const { error } = await sb.from("routing_rules").update({ claim_mode: on, updated_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  back(error ? { error: error.message } : { notice: on ? "Open pool on: new leads for this category go to everyone in the rule; the first to call keeps it." : "Open pool off: back to taking turns." });
}

// Who gets a lead nobody else can take, and how long an open-pool lead waits before normal turns take over.
export async function saveFallback(formData: FormData) {
  const { sb } = await admin();
  const user = String(formData.get("user_id") ?? "").trim() || null;
  const mins = Math.max(0, Math.min(1440, Number(String(formData.get("timeout_minutes") ?? "60")) || 0));
  const now = new Date().toISOString();
  const r1 = await sb.from("app_settings").upsert({ key: "fallback_owner", value: { user_id: user }, updated_at: now }, { onConflict: "key" });
  if (r1.error) back({ error: r1.error.message });
  const r2 = await sb.from("app_settings").upsert({ key: "pool", value: { timeout_minutes: mins }, updated_at: now }, { onConflict: "key" });
  back(r2.error ? { error: r2.error.message } : { notice: "Saved." });
}

// Idle rotation: leads untouched for N days, or kept in Yet To Talk for M days, move to the next person in their rule.
export async function saveIdle(formData: FormData) {
  const { sb } = await admin();
  const { data } = await sb.from("app_settings").select("value").eq("key", "rotation").single();
  const cur = ((data?.value ?? {}) as Record<string, unknown>);
  const n = (k: string, d: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(String(formData.get(k) ?? d)) || d));
  const value = { ...cur, idle_enabled: formData.get("idle_enabled") === "on", idle_days: n("idle_days", 15, 2, 120), ytt_days: n("ytt_days", 5, 1, 60),
                  followup_grace_days: n("followup_grace_days", 15, 0, 120), idle_max: n("idle_max", 10, 1, 50) };
  const { error } = await sb.from("app_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", "rotation");
  back(error ? { error: error.message } : { notice: value.idle_enabled ? "Idle rotation is on. It moves up to 25 leads a minute during working hours." : "Idle rotation settings saved (switched off)." });
}

// "Untouched lead distribution": only the on/off switch and the minutes are changed here; the other rotation settings stay as they are.
export async function saveUntouched(formData: FormData) {
  const { sb } = await admin();
  const { data } = await sb.from("app_settings").select("value").eq("key", "rotation").single();
  const cur = ((data?.value ?? {}) as Record<string, unknown>);
  const minutes = Math.max(5, Number(String(formData.get("minutes") ?? "30")) || 30);
  const { error } = await sb.from("app_settings").update({ value: { ...cur, enabled: formData.get("enabled") === "on", minutes }, updated_at: new Date().toISOString() }).eq("key", "rotation");
  back(error ? { error: error.message } : { notice: "Untouched lead setting saved." });
}
