"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";

const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v === "" ? null : v; };
const back = (p: Record<string, string> = {}): never => { revalidatePath("/admin/forms"); redirect(`/admin/forms?${new URLSearchParams(p)}`); };
async function admin() {
  const s = await getStaff();
  if (s.profile.role !== "admin") redirect("/admin?error=" + encodeURIComponent("Only admins can change form mappings."));
  return s;
}
const PRIORITIES = ["High", "Medium", "Low"];

export async function createMapping(formData: FormData) {
  const { sb } = await admin();
  const form_id = str(formData, "form_id"), form_name = str(formData, "form_name"), project_id = str(formData, "project_id");
  if (!form_id) back({ error: "Choose the Facebook form first." });
  if (!project_id) back({ error: "Choose the product category. Without it the lead cannot reach a distribution rule." });
  const pr = str(formData, "priority");
  const { error } = await sb.from("form_mappings").insert({
    name: str(formData, "name") ?? form_name ?? form_id, form_id, form_name, project_id,
    source_id: str(formData, "source_id"), priority: pr && PRIORITIES.includes(pr) ? pr : null, assign_to: str(formData, "assign_to"),
  });
  back(error ? { error: error.code === "23505" ? "That form already has a mapping." : error.message } : { notice: "Mapping saved. New leads from this form now take this product category and its distribution rule." });
}

export async function saveMapping(formData: FormData) {
  const { sb } = await admin();
  const id = String(formData.get("id"));
  const project_id = str(formData, "project_id");
  if (!project_id) back({ error: "A mapping needs a product category." });
  const pr = str(formData, "priority");
  const { error } = await sb.from("form_mappings").update({
    name: str(formData, "name") ?? "Mapping", project_id, source_id: str(formData, "source_id"),
    priority: pr && PRIORITIES.includes(pr) ? pr : null, assign_to: str(formData, "assign_to"), active: formData.get("active") === "on",
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  back(error ? { error: error.message } : { notice: "Saved. Applies to leads that arrive from now on." });
}

export async function deleteMapping(formData: FormData) {
  const { sb } = await admin();
  const { error } = await sb.from("form_mappings").delete().eq("id", String(formData.get("id")));
  back(error ? { error: error.message } : { notice: "Mapping removed. That form goes back to guessing its project from its name." });
}
