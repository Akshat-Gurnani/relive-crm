"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canLead, getStaff } from "@/lib/session";
import { fromLocalInput } from "@/lib/format";

// Every action runs under the signed-in user's session, so row level security is the real gate.
// Errors come back through the query string so the page can show them next to the form.
function done(leadId: string, error?: string): never {
  revalidatePath(`/leads/${leadId}`);
  redirect(error ? `/leads/${leadId}?error=${encodeURIComponent(error)}` : `/leads/${leadId}`);
}
const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v === "" ? null : v;
};

export async function changeStage(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const stageId = str(formData, "stage_id");
  if (!stageId) done(leadId, "Pick a stage.");
  const { sb } = await getStaff();
  const { data: stage } = await sb.from("stages").select("kind").eq("id", stageId!).single();
  const patch: Record<string, unknown> = { stage_id: stageId };
  if (stage?.kind === "lost") {
    const reason = str(formData, "lost_reason_id");
    if (!reason) done(leadId, "A lost lead needs a reason.");
    patch.lost_reason_id = reason;
    patch.lost_remarks = str(formData, "lost_remarks");
    patch.next_followup_at = null;
    patch.next_followup_note = null;
  }
  if (stage?.kind === "won") { patch.next_followup_at = null; patch.next_followup_note = null; }
  const { error } = await sb.from("leads").update(patch).eq("id", leadId);
  done(leadId, error?.message);
}

export async function setTemperature(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const { sb } = await getStaff();
  const { error } = await sb.from("leads").update({ temperature: String(formData.get("temperature")) }).eq("id", leadId);
  done(leadId, error?.message);
}

export async function logActivity(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const { sb, profile } = await getStaff();
  const type = String(formData.get("type") ?? "note");
  const now = new Date().toISOString();
  const { error } = await sb.from("activities").insert({
    lead_id: leadId,
    type,
    outcome: str(formData, "outcome"),
    notes: str(formData, "notes"),
    assigned_to: profile.id,
    created_by: profile.id,
    completed_at: now,
  });
  if (error) done(leadId, error.message);

  // Optional next step, set in the same submit so a call is never logged without a follow-up decision.
  const next = fromLocalInput(str(formData, "next_followup_at"));
  const upd: Record<string, unknown> = { last_activity_at: now };
  if (next) { upd.next_followup_at = next; upd.next_followup_note = str(formData, "next_followup_note"); }
  const res = await sb.from("leads").update(upd).eq("id", leadId);
  done(leadId, res.error?.message);
}

export async function setFollowUp(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const { sb } = await getStaff();
  const when = fromLocalInput(str(formData, "next_followup_at"));
  const { error } = await sb.from("leads").update({ next_followup_at: when, next_followup_note: when ? str(formData, "next_followup_note") : null }).eq("id", leadId);
  done(leadId, error?.message);
}

export async function reassign(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const { sb, profile, reports } = await getStaff();
  if (!canLead(profile.role, reports)) done(leadId, "Only team leaders and admins can reassign leads.");
  const to = str(formData, "assigned_to");
  const { error } = await sb.from("leads").update({ assigned_to: to }).eq("id", leadId);
  done(leadId, error?.message);
}

export async function saveDetails(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const { sb } = await getStaff();
  const num = (k: string) => { const v = str(formData, k); return v == null ? null : Number(v.replace(/,/g, "")); };
  const min = num("budget_min"), max = num("budget_max");
  if ((min != null && Number.isNaN(min)) || (max != null && Number.isNaN(max))) done(leadId, "Budget must be a number.");
  if (min != null && max != null && min > max) done(leadId, "Minimum budget is above the maximum.");
  const { error } = await sb.from("leads").update({
    budget_min: min, budget_max: max,
    unit_size: str(formData, "unit_size"), location_pref: str(formData, "location_pref"), possession_pref: str(formData, "possession_pref"),
  }).eq("id", leadId);
  done(leadId, error?.message);
}

export async function scheduleVisit(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const { sb } = await getStaff();
  const when = fromLocalInput(str(formData, "scheduled_at"));
  if (!when) done(leadId, "Pick a date and time for the visit.");
  const { data: lead } = await sb.from("leads").select("project_id").eq("id", leadId).single();
  const { error } = await sb.from("site_visits").insert({ lead_id: leadId, project_id: lead?.project_id ?? null, scheduled_at: when, notes: str(formData, "notes") });
  if (error) done(leadId, error.message);
  const { data: stage } = await sb.from("stages").select("id").eq("name", "Site Visit Scheduled").maybeSingle();
  const upd: Record<string, unknown> = { next_followup_at: when, next_followup_note: "Site visit" };
  if (stage) upd.stage_id = stage.id;
  const res = await sb.from("leads").update(upd).eq("id", leadId);
  done(leadId, res.error?.message);
}

export async function markVisitDone(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const visitId = String(formData.get("visit_id"));
  const { sb, profile } = await getStaff();
  const { error } = await sb.from("site_visits").update({ done_at: new Date().toISOString(), accompanied_by: profile.id }).eq("id", visitId);
  if (error) done(leadId, error.message);
  const { data: stage } = await sb.from("stages").select("id").eq("name", "Site Visit Done").maybeSingle();
  if (stage) {
    const res = await sb.from("leads").update({ stage_id: stage.id }).eq("id", leadId);
    done(leadId, res.error?.message);
  }
  done(leadId);
}

// ---------------------------------------------------------------- full edit
export async function saveLead(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const personId = String(formData.get("person_id"));
  const { sb } = await getStaff();
  const num = (k: string) => { const v = str(formData, k); return v == null ? null : Number(v.replace(/[,\s]/g, "")); };
  const min = num("budget_min"), max = num("budget_max");
  if ((min != null && Number.isNaN(min)) || (max != null && Number.isNaN(max))) redirect(`/leads/${leadId}/edit?error=${encodeURIComponent("Budget must be a number.")}`);
  const person: Record<string, unknown> = {};
  for (const k of ["full_name", "email", "alt_phone", "city", "company", "designation", "street", "state", "pincode", "birthday", "anniversary", "spouse_birthday"]) person[k] = str(formData, k);
  const p1 = await sb.from("people").update(person).eq("id", personId);
  if (p1.error) redirect(`/leads/${leadId}/edit?error=${encodeURIComponent(p1.error.message)}`);
  const lead: Record<string, unknown> = { budget_min: min, budget_max: max };
  for (const k of ["project_id", "source_id", "priority", "temperature", "lead_type", "budget_band", "unit_size", "possession_pref", "location_pref", "description", "property_type", "bhk", "qualification"]) lead[k] = str(formData, k);
  const list = (k: string) => [...new Set((str(formData, k) ?? "").split(",").map((v) => v.trim()).filter(Boolean))];
  lead.interests = list("interests"); lead.tags = list("tags");
  lead.priority ??= "Medium"; lead.temperature ??= "warm";
  const p2 = await sb.from("leads").update(lead).eq("id", leadId);
  if (p2.error) redirect(`/leads/${leadId}/edit?error=${encodeURIComponent(p2.error.message)}`);
  done(leadId);
}

// ---------------------------------------------------------------- calls, tasks, notes
export async function logCall(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const { sb } = await getStaff();
  const p = {
    lead_id: leadId, phone: str(formData, "phone"), direction: str(formData, "direction") ?? "outgoing",
    duration_seconds: Number(str(formData, "duration_seconds") ?? 0) || 0, outcome: str(formData, "outcome"),
    notes: str(formData, "notes"), provider: "manual", status: str(formData, "status"),
  };
  const { error } = await sb.rpc("log_call", { p });
  if (error) done(leadId, error.message);
  const next = fromLocalInput(str(formData, "next_followup_at"));
  if (next) {
    const res = await sb.from("leads").update({ next_followup_at: next, next_followup_note: str(formData, "next_followup_note") ?? p.outcome }).eq("id", leadId);
    if (res.error) done(leadId, res.error.message);
  }
  done(leadId);
}

export async function addTask(formData: FormData) {
  const leadId = str(formData, "lead_id");
  const ret = str(formData, "return") ?? (leadId ? `/leads/${leadId}?tab=tasks` : "/tasks");
  const { sb, profile } = await getStaff();
  const title = str(formData, "title");
  if (!title) redirect(`${ret}${ret.includes("?") ? "&" : "?"}error=${encodeURIComponent("Write what needs doing.")}`);
  const { error } = await sb.from("tasks").insert({
    lead_id: leadId, title, category: str(formData, "category"), due_at: fromLocalInput(str(formData, "due_at")),
    assigned_to: str(formData, "assigned_to") ?? profile.id, created_by: profile.id,
  });
  revalidatePath("/tasks");
  redirect(error ? `${ret}${ret.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}` : ret);
}

export async function setTaskStatus(formData: FormData) {
  const { sb } = await getStaff();
  const ret = str(formData, "return") ?? "/tasks";
  await sb.from("tasks").update({ status: String(formData.get("status")) === "done" ? "done" : "open" }).eq("id", String(formData.get("task_id")));
  revalidatePath("/tasks");
  redirect(ret);
}

export async function addNote(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const { sb, profile } = await getStaff();
  const body = str(formData, "body");
  if (!body) done(leadId, "Write the note first.");
  const { error } = await sb.from("lead_notes").insert({ lead_id: leadId, body, created_by: profile.id });
  if (error) done(leadId, error.message);
  revalidatePath(`/leads/${leadId}`);
  redirect(`/leads/${leadId}?tab=notes`);
}

export async function deleteNote(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const { sb } = await getStaff();
  await sb.from("lead_notes").delete().eq("id", String(formData.get("note_id")));
  revalidatePath(`/leads/${leadId}`);
  redirect(`/leads/${leadId}?tab=notes`);
}

// The rep confirms they have read the re-enquiry / returning-customer note.
export async function ackAttention(formData: FormData) {
  const leadId = String(formData.get("lead_id"));
  const { sb } = await getStaff();
  const { error } = await sb.rpc("ack_attention", { p_lead: leadId });
  done(leadId, error?.message);
}
