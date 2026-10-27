"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getStaff } from "@/lib/session";

const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v === "" ? null : v; };
const back = (tab: string, p: Record<string, string>) => { revalidatePath("/admin"); redirect(`/admin?tab=${tab}&${new URLSearchParams(p)}`); };
async function admin() {
  const s = await getStaff();
  if (s.profile.role !== "admin") redirect("/admin?error=" + encodeURIComponent("Only admins can change settings."));
  return s;
}

// Only admins can write profiles (row level security enforces it; the check here gives a clear message).
export async function setStaffFlag(formData: FormData) {
  const { sb } = await admin();
  const field = String(formData.get("field"));
  if (!["active", "accepting_leads"].includes(field)) return;
  await sb.from("profiles").update({ [field]: String(formData.get("value")) === "true" }).eq("id", String(formData.get("id")));
  revalidatePath("/admin");
}

export async function updateStaff(formData: FormData) {
  const { sb } = await admin();
  const { error } = await sb.from("profiles").update({
    role: str(formData, "role"), team_id: str(formData, "team_id"), manager_id: str(formData, "manager_id"), phone: str(formData, "phone"),
  }).eq("id", String(formData.get("id")));
  back("staff", error ? { error: error.message } : { notice: "Saved." });
}

export async function addUser(formData: FormData) {
  const { sb } = await admin();
  const email = str(formData, "email"), password = str(formData, "password"), name = str(formData, "full_name");
  if (!email || !password || !name) back("staff", { error: "Name, email and a starting password are required." });
  if (password!.length < 8) back("staff", { error: "Use a starting password of at least 8 characters." });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) back("staff", { error: "Adding users needs SUPABASE_SERVICE_ROLE_KEY on the server." });
  const svc = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await svc.auth.admin.createUser({ email: email!, password: password!, email_confirm: true });
  if (error || !data.user) back("staff", { error: error?.message ?? "Could not create the login." });
  const { error: e2 } = await sb.from("profiles").insert({
    id: data.user!.id, full_name: name, role: str(formData, "role") ?? "agent", team_id: str(formData, "team_id"), phone: str(formData, "phone"),
  });
  back("staff", e2 ? { error: e2.message } : { notice: `${name} can now sign in with ${email}.` });
}

export async function saveRotation(formData: FormData) {
  const { sb } = await admin();
  const value = {
    enabled: formData.get("enabled") === "on",
    minutes: Math.max(5, Number(str(formData, "minutes") ?? 30)),
    max_rotations: Math.max(1, Number(str(formData, "max_rotations") ?? 5)),
    only_new_within_hours: Math.max(1, Number(str(formData, "only_new_within_hours") ?? 24)),
    work_start: str(formData, "work_start") ?? "09:00",
    work_end: str(formData, "work_end") ?? "21:00",
  };
  const r1 = await sb.from("app_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", "rotation");
  const rem = { followup_minutes: Number(str(formData, "followup_minutes") ?? 15), task_minutes: Number(str(formData, "task_minutes") ?? 30) };
  const r2 = await sb.from("app_settings").update({ value: rem, updated_at: new Date().toISOString() }).eq("key", "reminders");
  back("rules", r1.error || r2.error ? { error: (r1.error ?? r2.error)!.message } : { notice: "Rules saved." });
}

export async function addListValue(formData: FormData) {
  const { sb } = await admin();
  const kind = String(formData.get("kind"));
  const value = str(formData, "value");
  if (!value) back("lists", { error: "Type a value first." });
  let error;
  if (kind === "projects") ({ error } = await sb.from("projects").insert({ name: value, city: str(formData, "city") }));
  else if (kind === "sources") ({ error } = await sb.from("sources").insert({ name: value }));
  else if (kind === "lost_reasons") ({ error } = await sb.from("lost_reasons").insert({ name: value }));
  else ({ error } = await sb.from("picklist_values").insert({ list: kind, value, position: 99 }));
  back("lists", error ? { error: error.message } : { notice: `Added "${value}".` });
}

export async function toggleListValue(formData: FormData) {
  const { sb } = await admin();
  const table = String(formData.get("table"));
  if (!["projects", "sources", "lost_reasons", "picklist_values"].includes(table)) return;
  await sb.from(table).update({ active: String(formData.get("value")) === "true" }).eq("id", String(formData.get("id")));
  back("lists", {});
}

export async function saveTemplate(formData: FormData) {
  const { sb, profile } = await getStaff();
  if (!["admin", "manager"].includes(profile.role)) redirect("/admin");
  const row = { channel: str(formData, "channel") ?? "whatsapp", name: str(formData, "name"), subject: str(formData, "subject"), body: str(formData, "body") };
  if (!row.name || !row.body) back("templates", { error: "A template needs a name and a message." });
  const id = str(formData, "id");
  const { error } = id ? await sb.from("message_templates").update(row).eq("id", id) : await sb.from("message_templates").insert(row);
  back("templates", error ? { error: error.message } : { notice: "Template saved." });
}

export async function deleteTemplate(formData: FormData) {
  const { sb } = await getStaff();
  await sb.from("message_templates").delete().eq("id", String(formData.get("id")));
  back("templates", {});
}

// Imported (Cratio) leads still waiting for their owner: hand them to a staff member. No alerts are sent.
export async function linkImportOwner(formData: FormData) {
  const { sb } = await admin();
  const { data, error } = await sb.rpc("link_import_owner", { p_name: str(formData, "name"), p_profile: str(formData, "profile_id") });
  back("imported", error ? { error: error.message } : { notice: `${data ?? 0} leads linked to their owner.` });
}
