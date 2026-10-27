"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { listLiveAds, listPageForms } from "@/lib/integrations/meta";

const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v === "" ? null : v; };
const back = (p: Record<string, string> = {}): never => { revalidatePath("/admin/routing"); redirect(`/admin/routing?${new URLSearchParams(p)}`); };
async function admin() {
  const s = await getStaff();
  if (s.profile.role !== "admin") redirect("/admin?error=" + encodeURIComponent("Only admins can change routing."));
  return s;
}
const ids = (f: FormData, k: string, extra?: string) => {
  const out = new Set<string>();
  for (const v of f.getAll(k)) if (String(v).trim()) out.add(String(v).trim());
  for (const v of String(f.get(extra ?? k + "_extra") ?? "").split(/[\s,;]+/)) if (v) out.add(v);
  return [...out];
};

// "Vejiya", "Vejiya 30", "Vejiya - 30%": names in the order given, optional percentage-style share.
type Parsed = { id: string; name: string; share: number };
async function parseNames(sb: Awaited<ReturnType<typeof admin>>["sb"], text: string): Promise<{ ok: Parsed[]; missing: string[] }> {
  const { data } = await sb.from("profiles").select("id,full_name").eq("active", true);
  const staff = (data ?? []) as { id: string; full_name: string }[];
  const ok: Parsed[] = []; const missing: string[] = [];
  for (const raw of text.split(/\r?\n|;/)) {
    const line = raw.trim(); if (!line) continue;
    const m = line.match(/^(.*?)[\s,:|-]+(\d+(?:\.\d+)?)\s*%?$/);
    const name = (m ? m[1] : line).trim(); const share = m ? Number(m[2]) : 1;
    const lc = name.toLowerCase();
    const exact = staff.filter((s) => s.full_name.toLowerCase() === lc);
    const pref = exact.length ? exact : staff.filter((s) => s.full_name.toLowerCase().startsWith(lc));
    if (pref.length !== 1 || !(share > 0)) { missing.push(name + (pref.length > 1 ? " (more than one match)" : "")); continue; }
    if (!ok.some((o) => o.id === pref[0].id)) ok.push({ id: pref[0].id, name: pref[0].full_name, share });
  }
  return { ok, missing };
}

export async function createList(formData: FormData) {
  const { sb } = await admin();
  const name = str(formData, "name");
  if (!name) back({ error: "Give the list a name." });
  const { ok, missing } = await parseNames(sb, String(formData.get("members") ?? ""));
  if (missing.length) back({ error: `Could not find an active person for: ${missing.join(", ")}. Nothing was created.` });
  if (!ok.length) back({ error: "Add at least one person, one per line, in rotation order." });
  const { data, error } = await sb.from("routing_rules").insert({
    name, position: Number(str(formData, "position") ?? 100),
    form_ids: ids(formData, "form_ids"), campaign_ids: ids(formData, "campaign_ids"), adset_ids: ids(formData, "adset_ids"), ad_ids: ids(formData, "ad_ids"),
    name_contains: str(formData, "name_contains"), match_project_id: str(formData, "match_project_id"),
    set_project_id: str(formData, "set_project_id"), set_source_id: str(formData, "set_source_id"), set_priority: str(formData, "set_priority"),
    note: str(formData, "note"),
  }).select("id").single();
  if (error || !data) back({ error: error?.message ?? "Could not create the list." });
  const { error: e2 } = await sb.from("routing_members").insert(ok.map((o, i) => ({ rule_id: data!.id, user_id: o.id, position: i + 1, share: o.share })));
  back(e2 ? { error: e2.message } : { notice: `"${name}" created with ${ok.length} people.` });
}

export async function saveList(formData: FormData) {
  const { sb } = await admin();
  const id = String(formData.get("id"));
  const { error } = await sb.from("routing_rules").update({
    name: str(formData, "name") ?? "Untitled", position: Number(str(formData, "position") ?? 100), active: formData.get("active") === "on",
    form_ids: ids(formData, "form_ids"), campaign_ids: ids(formData, "campaign_ids"), adset_ids: ids(formData, "adset_ids"), ad_ids: ids(formData, "ad_ids"),
    name_contains: str(formData, "name_contains"), match_project_id: str(formData, "match_project_id"),
    set_project_id: str(formData, "set_project_id"), set_source_id: str(formData, "set_source_id"), set_priority: str(formData, "set_priority"),
    note: str(formData, "note"), updated_at: new Date().toISOString(),
  }).eq("id", id);
  back(error ? { error: error.message } : { notice: "Saved. Applies to leads that arrive from now on." });
}

export async function deleteList(formData: FormData) {
  const { sb } = await admin();
  const { error } = await sb.from("routing_rules").delete().eq("id", String(formData.get("id")));
  back(error ? { error: error.message } : { notice: "List deleted. Leads already handed out stay where they are." });
}

export async function saveMember(formData: FormData) {
  const { sb } = await admin();
  const share = Number(str(formData, "share") ?? 1);
  if (!(share > 0)) back({ error: "Share must be above zero." });
  const { error } = await sb.from("routing_members").update({
    share, position: Number(str(formData, "position") ?? 0), active: formData.get("active") === "on",
  }).eq("rule_id", String(formData.get("rule_id"))).eq("user_id", String(formData.get("user_id")));
  back(error ? { error: error.message } : { notice: "Saved." });
}

export async function removeMember(formData: FormData) {
  const { sb } = await admin();
  const { error } = await sb.from("routing_members").delete().eq("rule_id", String(formData.get("rule_id"))).eq("user_id", String(formData.get("user_id")));
  back(error ? { error: error.message } : { notice: "Removed from the list." });
}

export async function addMembers(formData: FormData) {
  const { sb } = await admin();
  const rule = String(formData.get("rule_id"));
  const { ok, missing } = await parseNames(sb, String(formData.get("members") ?? ""));
  if (missing.length) back({ error: `Could not find an active person for: ${missing.join(", ")}.` });
  const { data: cur } = await sb.from("routing_members").select("position").eq("rule_id", rule).order("position", { ascending: false }).limit(1);
  let pos = ((cur ?? [])[0] as { position: number } | undefined)?.position ?? 0;
  const { error } = await sb.from("routing_members").upsert(ok.map((o) => ({ rule_id: rule, user_id: o.id, position: ++pos, share: o.share })), { onConflict: "rule_id,user_id" });
  back(error ? { error: error.message } : { notice: `${ok.length} added.` });
}

export async function resetCounts(formData: FormData) {
  const { sb } = await admin();
  const { error } = await sb.from("routing_members").update({ served: 0 }).eq("rule_id", String(formData.get("rule_id")));
  back(error ? { error: error.message } : { notice: "Rotation counts reset: everyone starts level." });
}

// Dry run: which list would catch a lead with these names or IDs, and who would be next. Hands nothing out.
export async function testRoute(formData: FormData) {
  const { sb } = await admin();
  const p = { form_id: str(formData, "form_id"), form_name: str(formData, "form_name"), campaign_id: str(formData, "campaign_id"), campaign_name: str(formData, "campaign_name"),
              adset_id: str(formData, "adset_id"), adset_name: str(formData, "adset_name"), ad_id: str(formData, "ad_id"), ad_name: str(formData, "ad_name") };
  const { data, error } = await sb.rpc("preview_route", { p });
  if (error) back({ error: error.message });
  const r = data as { rule: string | null; next?: string | null; project?: string | null; priority?: string | null };
  back({ test: r.rule ? `Caught by "${r.rule}". Next person: ${r.next ?? "nobody available"}.${r.project ? ` Project: ${r.project}.` : ""}${r.priority ? ` Priority: ${r.priority}.` : ""}` : "No list matches this lead. It would be saved unassigned and the admins alerted." });
}

// Reads every lead form on the connected Facebook Pages from Meta, so lists can use forms that have no leads yet.
export async function refreshForms() {
  const { sb } = await admin();
  const { data } = await sb.from("capture_endpoints").select("match_page_id").eq("provider", "meta").eq("active", true).not("match_page_id", "is", null);
  const pages = [...new Set((data ?? []).map((r) => r.match_page_id as string))];
  if (!pages.length) back({ error: "No Facebook Pages are connected under Integrations." });
  const results = await Promise.all(pages.map((p) => listPageForms(p)));
  const rows = results.flatMap((r) => r.forms.map((f) => ({ ...f, refreshed_at: new Date().toISOString() })));
  if (rows.length) {
    const { error } = await sb.from("meta_forms").upsert(rows, { onConflict: "form_id" });
    if (error) back({ error: error.message });
  }
  const bad = results.filter((r) => !r.ok);
  back(bad.length ? { error: `Read ${rows.length} forms. Problems: ${bad.map((b) => b.detail).join(" | ")}` } : { notice: `Read ${rows.length} forms from ${pages.length} Pages: ${results.map((r) => r.detail).join("; ")}.` });
}

// Reads the ads that are running now, with their ad set, campaign and lead form, from the Meta ad accounts.
export async function refreshAds() {
  const { sb } = await admin();
  const r = await listLiveAds();
  if (!r.ok) back({ error: `Could not read ads: ${r.detail}` });
  const stamp = new Date().toISOString();
  const { error: e0 } = await sb.from("meta_ads").delete().neq("ad_id", "");
  if (e0) back({ error: e0.message });
  if (r.ads.length) {
    const { error } = await sb.from("meta_ads").insert(r.ads.map((a) => ({ ...a, refreshed_at: stamp })));
    if (error) back({ error: error.message });
  }
  back({ notice: `Read ${r.ads.length} live ads (${r.ads.filter((a) => a.form_id).length} with a lead form). ${r.detail}` });
}
