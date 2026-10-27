import { cache } from "react";
import { canManage, getStaff } from "@/lib/session";
import type { Named, Stage, Staff } from "@/lib/types";

export type Picklists = Record<string, string[]>;

// Reference data used across forms, loaded once per request.
export const getRefs = cache(async () => {
  const { sb, profile, reports } = await getStaff();
  const [stages, projects, sources, staff, reasons, picks, teams, vendors] = await Promise.all([
    sb.from("stages").select("id,name,kind,position").order("position"),
    sb.from("projects").select("id,name").eq("active", true).order("name"),
    sb.from("sources").select("id,name").eq("active", true).order("name"),
    sb.from("staff_directory").select("id,full_name,role,team_id,active").order("full_name"),
    sb.from("lost_reasons").select("id,name").eq("active", true).order("name"),
    sb.from("picklist_values").select("list,value,position").eq("active", true).order("position"),
    sb.from("teams").select("id,name").order("name"),
    sb.from("vendors").select("id,name").eq("active", true).order("name"),
  ]);
  const picklists: Picklists = {};
  for (const p of (picks.data ?? []) as { list: string; value: string }[]) (picklists[p.list] ??= []).push(p.value);
  const staffList = (staff.data ?? []) as Pick<Staff, "id" | "full_name" | "role" | "team_id" | "active">[];
  return {
    stages: (stages.data ?? []) as Stage[],
    projects: (projects.data ?? []) as Named[],
    sources: (sources.data ?? []) as Named[],
    reasons: (reasons.data ?? []) as Named[],
    teams: (teams.data ?? []) as Named[],
    vendors: (vendors.data ?? []) as Named[],
    staff: staffList,
    staffName: new Map(staffList.map((s) => [s.id, s.full_name])),
    // Admins and team leaders can hand leads to any active agent or team leader; a sub-lead only to themselves
    // and the people under them (the database enforces the same rule).
    assignable: staffList.filter((s) => s.active && ["agent", "manager"].includes(s.role)
      && (canManage(profile.role) || s.id === profile.id || reports.includes(s.id))),
    picklists,
  };
});
