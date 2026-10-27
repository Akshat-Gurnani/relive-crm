"use server";

import { randomBytes } from "node:crypto";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { getStaff } from "@/lib/session";
import { appUrl } from "@/lib/server/service";
import { parseStaff, type StaffRole } from "@/lib/staff-bulk";

export type BulkLine = { line: number; name: string; email: string; role: StaffRole; team: string; status: "ready" | "problem" | "exists" | "created" | "failed" | "link"; note: string; leads?: number; link?: string };
export type BulkState = { mode?: "check" | "create" | "links"; lines: BulkLine[]; error?: string; summary?: string };

async function ctx() {
  const s = await getStaff();
  if (s.profile.role !== "admin") return { error: "Only admins can add staff." } as const;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { error: "Adding users needs SUPABASE_SERVICE_ROLE_KEY on the server." } as const;
  const svc = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return { sb: s.sb, svc } as const;
}

async function existingEmails(svc: SupabaseClient) {
  const set = new Map<string, string>();
  for (let page = 1; page <= 10; page++) {
    const { data } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    for (const u of data?.users ?? []) if (u.email) set.set(u.email.toLowerCase(), u.id);
    if ((data?.users.length ?? 0) < 1000) break;
  }
  return set;
}

async function analyse(c: { sb: SupabaseClient; svc: SupabaseClient }, text: string): Promise<BulkLine[]> {
  const rows = parseStaff(text);
  const [emails, owners, profiles] = await Promise.all([
    existingEmails(c.svc),
    c.sb.rpc("import_owners"),
    c.sb.from("profiles").select("full_name"),
  ]);
  const leadsBy = new Map(((owners.data ?? []) as { cratio_name: string; leads: number }[]).map((o) => [o.cratio_name.trim().toLowerCase(), o.leads]));
  const names = new Set(((profiles.data ?? []) as { full_name: string }[]).map((p) => p.full_name.trim().toLowerCase()));
  return rows.map((r) => {
    const leads = leadsBy.get(r.name.toLowerCase());
    const base = { line: r.line, name: r.name, email: r.email, role: r.role, team: r.team, leads };
    if (r.problem) return { ...base, status: "problem" as const, note: r.problem };
    if (emails.has(r.email)) return { ...base, status: "exists" as const, note: "A login with this email already exists. Skipped." };
    if (names.has(r.name.toLowerCase())) return { ...base, status: "problem" as const, note: "A staff member with this exact name already exists." };
    return { ...base, status: "ready" as const, note: leads === undefined ? "No Cratio owner has exactly this name, so no old leads will be linked." : `Will take over ${leads} imported Cratio leads.` };
  });
}

export async function checkStaff(_: BulkState, fd: FormData): Promise<BulkState> {
  const c = await ctx();
  if ("error" in c) return { lines: [], error: c.error };
  const text = String(fd.get("rows") ?? "");
  if (!text.trim()) return { lines: [], error: "Paste the rows first." };
  const lines = await analyse(c, text);
  const ok = lines.filter((l) => l.status === "ready").length;
  return { mode: "check", lines, summary: `${ok} of ${lines.length} rows are ready. Nothing has been created yet.` };
}

export async function createStaff(_: BulkState, fd: FormData): Promise<BulkState> {
  const c = await ctx();
  if ("error" in c) return { lines: [], error: c.error };
  const text = String(fd.get("rows") ?? "");
  const lines = await analyse(c, text);
  const teams = ((await c.sb.from("teams").select("id,name")).data ?? []) as { id: string; name: string }[];
  const phones = new Map(parseStaff(text).map((r) => [r.line, r.phone]));
  let made = 0;
  for (const l of lines) {
    if (l.status !== "ready") continue;
    const password = randomBytes(18).toString("base64url"); // never shown, nobody knows it; each person sets their own through a link
    const { data, error } = await c.svc.auth.admin.createUser({ email: l.email, password, email_confirm: true });
    if (error || !data.user) { l.status = "failed"; l.note = error?.message ?? "Could not create the login."; continue; }
    const team = teams.find((t) => t.name.toLowerCase() === l.team.toLowerCase());
    const { error: e2 } = await c.sb.from("profiles").insert({ id: data.user.id, full_name: l.name, role: l.role, team_id: team?.id ?? null, phone: phones.get(l.line) || null });
    if (e2) { await c.svc.auth.admin.deleteUser(data.user.id); l.status = "failed"; l.note = e2.message; continue; }
    l.status = "created"; l.note = "Login created. No email sent."; made++;
  }
  return { mode: "create", lines, summary: `${made} logins created. No emails were sent. Next: make set-password links.` };
}

// Makes one-time set-password links for the pasted people. Does not email anyone; the admin shares each link.
export async function makeLinks(_: BulkState, fd: FormData): Promise<BulkState> {
  const c = await ctx();
  if ("error" in c) return { lines: [], error: c.error };
  const rows = parseStaff(String(fd.get("rows") ?? "")).filter((r) => !r.problem);
  const lines: BulkLine[] = [];
  for (const r of rows) {
    const base = { line: r.line, name: r.name, email: r.email, role: r.role, team: r.team };
    const { data, error } = await c.svc.auth.admin.generateLink({ type: "recovery", email: r.email });
    const hash = data?.properties?.hashed_token;
    if (error || !hash) { lines.push({ ...base, status: "failed", note: error?.message ?? "No login exists for this email yet." }); continue; }
    lines.push({ ...base, status: "link", note: "Valid for one use; expires in about an hour.", link: `${appUrl()}/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=recovery&next=/set-password` });
  }
  return { mode: "links", lines, summary: `${lines.filter((l) => l.link).length} links made. Nothing was emailed.` };
}
