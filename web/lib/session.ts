import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Staff } from "@/lib/types";

// Signed-in staff member plus a Supabase client that carries their session, so every query runs under their row level security.
export const getStaff = cache(async () => {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const [{ data }, rep] = await Promise.all([
    sb.from("profiles").select("id,full_name,role,team_id,active").eq("id", user.id).maybeSingle(),
    sb.rpc("my_reports"),
  ]);
  const profile = data as Staff | null;
  if (!profile || !profile.active) redirect("/login?error=no-access");
  // Everyone below this person in the reporting chain ("Reports to" in Admin, Staff), at any depth.
  const reports = ((rep.data as string[] | null) ?? []).filter(Boolean);
  return { sb, user, profile, reports };
});

export const canWorkLeads = (role: string) => ["admin", "manager", "agent"].includes(role);
export const canManage = (role: string) => ["admin", "manager"].includes(role);
// Leads people: admins, team leaders, and anyone with staff reporting to them. Gets reassigning and team views,
// limited by the database to the people under them. Admin settings and imports stay with canManage.
export const canLead = (role: string, reports: string[]) => canManage(role) || (reports.length > 0 && canWorkLeads(role));
