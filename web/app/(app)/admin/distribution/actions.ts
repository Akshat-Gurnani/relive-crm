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

// "Untouched lead distribution": only the on/off switch and the minutes are changed here; the other rotation settings stay as they are.
export async function saveUntouched(formData: FormData) {
  const { sb } = await admin();
  const { data } = await sb.from("app_settings").select("value").eq("key", "rotation").single();
  const cur = ((data?.value ?? {}) as Record<string, unknown>);
  const minutes = Math.max(5, Number(String(formData.get("minutes") ?? "30")) || 30);
  const { error } = await sb.from("app_settings").update({ value: { ...cur, enabled: formData.get("enabled") === "on", minutes }, updated_at: new Date().toISOString() }).eq("key", "rotation");
  back(error ? { error: error.message } : { notice: "Untouched lead setting saved." });
}
