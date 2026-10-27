"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { runJobs } from "@/lib/jobs/run";
import { subscribePage } from "@/lib/integrations/meta";

const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v === "" ? null : v; };
const back = (tab: string, p: Record<string, string> = {}) => {
  revalidatePath("/admin/integrations");
  redirect(`/admin/integrations?tab=${tab}&${new URLSearchParams(p)}`);
};
// Integrations are for top-level admins only. The database enforces the same rule on every table and secret.
async function admin() {
  const s = await getStaff();
  if (s.profile.role !== "admin") redirect("/admin?error=" + encodeURIComponent("Only admins can change integrations."));
  return s;
}

// ---------------------------------------------------------------- connection secrets (write-only)
const ALLOWED = /^(meta_app_secret|meta_verify_token|meta_access_token|meta_page_token:\d{5,20}|google_ads_webhook_key|google_service_account_json|resend_api_key|email_from|gemini_api_key|openrouter_api_key|ai_model)$/;

export async function saveSecret(formData: FormData) {
  const { sb } = await admin();
  let key = str(formData, "key") ?? "";
  const page = str(formData, "page_id");
  if (key === "meta_page_token") {
    if (!page || !/^\d{5,20}$/.test(page)) back("connections", { error: "Enter the Facebook Page ID (numbers only)." });
    key = `meta_page_token:${page}`;
  }
  if (!ALLOWED.test(key)) back("connections", { error: "Unknown setting." });
  const value = String(formData.get("value") ?? "").trim();
  if (key === "google_service_account_json" && value) {
    try { const j = JSON.parse(value); if (!j.client_email || !j.private_key) throw new Error(); }
    catch { back("connections", { error: "That is not a service account key file (JSON with client_email and private_key)." }); }
  }
  const { error } = await sb.rpc("integration_secret_set", { p_key: key, p_value: value });
  back("connections", error ? { error: error.message } : { notice: value ? "Saved. It cannot be shown again." : "Removed." });
}

// ---------------------------------------------------------------- lead sources
const PROVIDERS = ["meta", "google_ads", "google_forms", "linkedin", "website", "webhook", "other"];

export async function saveEndpoint(formData: FormData) {
  const { sb } = await admin();
  const id = str(formData, "id");
  const name = str(formData, "name");
  const provider = str(formData, "provider") ?? "webhook";
  if (!name) back("sources", { error: "Give the lead source a name." });
  if (!PROVIDERS.includes(provider)) back("sources", { error: "Pick a channel." });
  const forms = (str(formData, "match_form_ids") ?? "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const row = {
    name, provider,
    project_id: str(formData, "project_id"), team_id: str(formData, "team_id"),
    source_id: str(formData, "source_id"),
    assign_to: str(formData, "assign_to"),
    default_priority: ["High", "Medium", "Low"].includes(str(formData, "default_priority") ?? "") ? str(formData, "default_priority") : null,
    match_page_id: str(formData, "match_page_id"), match_form_ids: forms,
    is_default: formData.get("is_default") === "on",
  };
  if (id) {
    const { error } = await sb.from("capture_endpoints").update(row).eq("id", id);
    back("sources", error ? { error: error.message } : { notice: `${name} saved.` });
  }
  const slug = (name!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "source") + "-" + randomBytes(2).toString("hex");
  const secret = randomBytes(18).toString("base64url");
  const { error } = await sb.from("capture_endpoints").insert({ ...row, slug, secret_hash: createHash("sha256").update(secret).digest("hex") });
  if (error) back("sources", { error: error.message.includes("one_default") ? "There is already a catch-all for that channel." : error.message });
  // shown once on the next page, then gone (it is stored hashed)
  (await cookies()).set("relive_new_secret", JSON.stringify({ slug, secret }), { httpOnly: true, sameSite: "strict", maxAge: 300, path: "/admin/integrations" });
  back("sources", { notice: `${name} added.` });
}

export async function rotateEndpointSecret(formData: FormData) {
  const { sb } = await admin();
  const id = String(formData.get("id"));
  const secret = randomBytes(18).toString("base64url");
  const { data, error } = await sb.from("capture_endpoints").update({ secret_hash: createHash("sha256").update(secret).digest("hex") }).eq("id", id).select("slug").single();
  if (error) back("sources", { error: error.message });
  (await cookies()).set("relive_new_secret", JSON.stringify({ slug: data!.slug, secret }), { httpOnly: true, sameSite: "strict", maxAge: 300, path: "/admin/integrations" });
  back("sources", { notice: "New secret made. Update it wherever the old one was used." });
}

export async function toggleEndpoint(formData: FormData) {
  const { sb } = await admin();
  await sb.from("capture_endpoints").update({ active: formData.get("active") === "true" }).eq("id", String(formData.get("id")));
  back("sources");
}

// ---------------------------------------------------------------- Google Sheets
export async function saveSheet(formData: FormData) {
  const { sb } = await admin();
  const link = str(formData, "spreadsheet") ?? "";
  const id = link.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/)?.[1] ?? (/^[a-zA-Z0-9_-]{20,}$/.test(link) ? link : null);
  if (!id) back("sheets", { error: "Paste the Google Sheet's link (it contains /spreadsheets/d/...)." });
  const scope = str(formData, "scope") ?? "all";
  const scopeId = scope === "all" ? null : str(formData, `scope_${scope}`);
  if (scope !== "all" && !scopeId) back("sheets", { error: "Pick which one this sheet is for." });
  const { data, error } = await sb.from("sheet_targets").insert({
    name: str(formData, "name") ?? "Leads", spreadsheet_id: id, tab_name: str(formData, "tab_name") ?? "Leads",
    scope, scope_id: scopeId, include_tests: formData.get("include_tests") === "on",
  }).select("id").single();
  if (error) back("sheets", { error: error.message });
  await sb.rpc("sheet_resync", { p_target: data!.id });
  await runJobs(["sheets"]).catch(() => null);
  back("sheets", { notice: "Sheet added. Existing leads are being written to it now." });
}

export async function sheetAction(formData: FormData) {
  const { sb } = await admin();
  const id = String(formData.get("id"));
  const what = String(formData.get("what"));
  if (what === "pause") await sb.from("sheet_targets").update({ active: false }).eq("id", id);
  if (what === "resume") await sb.from("sheet_targets").update({ active: true }).eq("id", id);
  if (what === "resync") { await sb.rpc("sheet_resync", { p_target: id }); await runJobs(["sheets"]).catch(() => null); }
  if (what === "remove") await sb.from("sheet_targets").delete().eq("id", id);
  back("sheets", { notice: what === "remove" ? "Sheet disconnected. The spreadsheet itself was not touched." : "Done." });
}

export async function runNow() {
  await admin();
  const r = await runJobs();
  back(String("log"), { notice: `Ran: ${JSON.stringify(r).slice(0, 300)}` });
}

// ---------------------------------------------------------------- connect Facebook Pages to the app
// One press connects every Page listed under Forms and webhooks (Facebook entries with a Page ID).
export async function connectMetaPages() {
  const { sb } = await admin();
  const { data } = await sb.from("capture_endpoints").select("match_page_id").eq("provider", "meta").eq("active", true).not("match_page_id", "is", null);
  const pages = [...new Set((data ?? []).map((r) => r.match_page_id as string))];
  if (!pages.length) back("connections", { error: "No Facebook Page IDs found under Forms and webhooks." });
  const results = [];
  for (const p of pages) results.push(await subscribePage(p));
  const bad = results.filter((r) => !r.ok);
  back("connections", bad.length
    ? { error: `Connected ${results.length - bad.length} of ${results.length} Pages. ${bad.map((b) => b.detail).join(" | ")}` }
    : { notice: `All ${results.length} Pages connected: ${results.map((r) => r.detail.split(":")[0]).join(", ")}.` });
}
