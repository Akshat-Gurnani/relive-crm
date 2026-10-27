"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canLead, canManage, getStaff } from "@/lib/session";
import { fromLocalInput } from "@/lib/format";
import { parseCsv, parseLooseDate } from "@/lib/csv";
import { IMPORT_FIELDS } from "@/lib/import-fields";

const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v === "" ? null : v; };
const back = (path: string, params: Record<string, string>) => {
  const u = new URLSearchParams(params);
  redirect(`${path}${path.includes("?") ? "&" : "?"}${u.toString()}`);
};

// ---------------------------------------------------------------- manual lead entry
export async function createLead(formData: FormData) {
  const { sb } = await getStaff();
  const p: Record<string, unknown> = {};
  for (const k of ["phone", "full_name", "email", "alt_phone", "city", "company", "designation", "project_id", "source_id", "stage_id",
    "priority", "temperature", "lead_type", "budget_band", "budget_min", "budget_max", "unit_size", "possession_pref", "location_pref",
    "description", "next_followup_note", "assigned_to", "team_id"]) p[k] = str(formData, k);
  p.next_followup_at = fromLocalInput(str(formData, "next_followup_at"));
  p.round_robin = formData.get("round_robin") === "on";
  for (const k of ["budget_min", "budget_max"]) if (p[k]) p[k] = String(p[k]).replace(/[,\s]/g, "");
  const { data, error } = await sb.rpc("create_lead", { p });
  if (error) back("/leads/new", { error: error.message });
  const r = data as { status: string; lead_id: string; owner?: string; visible?: boolean };
  revalidatePath("/leads");
  if (r.status === "exists") {
    if (r.visible) redirect(`/leads/${r.lead_id}?notice=${encodeURIComponent("This person already had an open lead for this project. It is marked as a re-enquiry.")}`);
    back("/leads/new", { notice: `Already an open lead, owned by ${r.owner ?? "a colleague"}. They have been told about this enquiry.` });
  }
  if (formData.get("again") === "1") back("/leads/new", { notice: "Lead saved. Add the next one." });
  redirect(`/leads/${r.lead_id}`);
}

// ---------------------------------------------------------------- bulk actions on the list
export async function bulkUpdate(formData: FormData) {
  const { sb, profile, reports } = await getStaff();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const ret = String(formData.get("return") || "/leads");
  if (!ids.length) back(ret, { error: "Tick at least one lead first." });
  const op = String(formData.get("op") ?? "update");
  if (op === "delete") {
    if (profile.role !== "admin") back(ret, { error: "Only admins can delete leads." });
    const { error } = await sb.from("leads").delete().in("id", ids);
    revalidatePath("/leads");
    back(ret, error ? { error: error.message } : { notice: `${ids.length} lead(s) deleted.` });
  }
  const patch: Record<string, unknown> = {};
  const stage = str(formData, "b_stage"), assignee = str(formData, "b_assignee"), prio = str(formData, "b_priority"), temp = str(formData, "b_temp");
  if (stage) {
    const { data: s } = await sb.from("stages").select("kind").eq("id", stage).single();
    if (s?.kind === "lost") {
      const reason = str(formData, "b_reason");
      if (!reason) back(ret, { error: "Pick a lost reason to mark leads as lost." });
      patch.lost_reason_id = reason; patch.next_followup_at = null; patch.next_followup_note = null;
    }
    patch.stage_id = stage;
  }
  if (assignee) {
    if (!canLead(profile.role, reports)) back(ret, { error: "Only team leaders and admins can reassign leads." });
    patch.assigned_to = assignee === "none" ? null : assignee;
  }
  if (prio) patch.priority = prio;
  if (temp) patch.temperature = temp;
  if (!Object.keys(patch).length) back(ret, { error: "Choose what to change for the selected leads." });
  const { data, error } = await sb.from("leads").update(patch).in("id", ids).select("id");
  revalidatePath("/leads");
  back(ret, error ? { error: error.message } : { notice: `${(data ?? []).length} lead(s) updated.` });
}

// ---------------------------------------------------------------- saved views
export async function saveView(formData: FormData) {
  const { sb } = await getStaff();
  const name = str(formData, "name");
  const qs = String(formData.get("qs") ?? "");
  if (!name) back(`/leads?${qs}`, { error: "Give the view a name." });
  const params = Object.fromEntries(new URLSearchParams(qs).entries());
  const { error } = await sb.from("saved_views").insert({ name, params, is_public: formData.get("is_public") === "on" });
  revalidatePath("/leads");
  back(`/leads?${qs}`, error ? { error: error.message } : { notice: `View "${name}" saved.` });
}
export async function deleteView(formData: FormData) {
  const { sb } = await getStaff();
  await sb.from("saved_views").delete().eq("id", String(formData.get("id")));
  revalidatePath("/leads");
  redirect("/leads");
}

// ---------------------------------------------------------------- import

export async function runImport(formData: FormData) {
  const { sb, profile } = await getStaff();
  if (!canManage(profile.role)) redirect("/leads");
  const csv = String(formData.get("csv") ?? "");
  const rows = parseCsv(csv);
  if (rows.length < 2) back("/leads/import", { error: "The file has no data rows." });
  const header = rows[0];
  const map: Record<string, number> = {};
  for (const f of IMPORT_FIELDS) {
    const col = str(formData, `map_${f.key}`);
    if (col != null) map[f.key] = Number(col);
  }
  if (map.phone == null) back("/leads/import", { error: "Choose which column holds the mobile number." });
  const records = rows.slice(1).map((r) => {
    const o: Record<string, string | null> = {};
    for (const [k, i] of Object.entries(map)) o[k] = (r[i] ?? "").trim() || null;
    if (o.project) o.project = o.project.split(",")[0].trim();
    if (o.created_at) o.created_at = parseLooseDate(o.created_at);
    if (o.next_followup_at) o.next_followup_at = parseLooseDate(o.next_followup_at);
    return o;
  });
  const options = {
    on_duplicate: String(formData.get("on_duplicate") ?? "skip"),
    team_id: str(formData, "team_id"),
    create_missing: formData.get("create_missing") === "on",
    file_name: str(formData, "file_name") ?? "upload.csv",
  };
  const total = { inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] as { row: number; error: string }[] };
  for (let i = 0; i < records.length; i += 500) {
    const { data, error } = await sb.rpc("import_leads", { p_rows: records.slice(i, i + 500), p_options: options });
    if (error) back("/leads/import", { error: error.message });
    const r = data as typeof total;
    total.inserted += r.inserted; total.updated += r.updated; total.skipped += r.skipped; total.failed += r.failed;
    total.errors.push(...r.errors.map((e) => ({ row: e.row + i + 1, error: e.error })));
  }
  revalidatePath("/leads");
  back("/leads/import", {
    done: JSON.stringify({ ...total, errors: total.errors.slice(0, 50), columns: header.length, rows: records.length }),
  });
}
