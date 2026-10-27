import { NextResponse, type NextRequest } from "next/server";
import { canWorkLeads, getStaff } from "@/lib/session";
import { applyLeadFilters, openStageIds, searchSelect } from "@/lib/leads-query";
import { getRefs } from "@/lib/refs";
import { toCsv } from "@/lib/csv";

const SELECT = "id,created_at,priority,temperature,lead_type,budget_band,unit_size,location_pref,possession_pref,assigned_to,next_followup_at,next_followup_note,first_contacted_at,last_activity_at,reenquiry_count,description,lost_remarks,provider,campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,form_name,form_id,qualification,property_type,bhk,tags,interests,stage:stages(name),project:projects(name),source:sources(name),lost:lost_reasons(name),person:people!inner(full_name,phone_e164,alt_phone,email,city,company)";

// Exports the leads matching the current list filters. Row level security limits it to what the user can see.
export async function GET(req: NextRequest) {
  const { sb, profile } = await getStaff();
  if (!canWorkLeads(profile.role)) return new NextResponse("Not allowed", { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const refs = await getRefs();
  const open = await openStageIds(sb);
  const out: unknown[][] = [["Name", "Mobile", "Alternate", "Email", "City", "Company", "Project", "Lead source", "Stage", "Priority", "Temperature",
    "Lead type", "Budget", "Size", "Location", "Possession", "Assigned to", "Next follow-up", "Follow-up note", "First contact",
    "Last activity", "Re-enquiries", "Lost reason", "Lost remarks", "Description", "Created", "Channel", "Campaign", "Ad set", "Ad", "Form", "Qualification", "Property type", "BHK", "Tags", "Also interested in", "Lead ID"]];
  const ist = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "");
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await applyLeadFilters(sb.from("leads").select(searchSelect(SELECT, sp)).range(from, from + 999), sp, { userId: profile.id, openStageIds: open });
    if (error) return new NextResponse(error.message, { status: 400 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const l of (data ?? []) as any[]) {
      out.push([l.person.full_name, l.person.phone_e164, l.person.alt_phone, l.person.email, l.person.city, l.person.company,
        l.project?.name, l.source?.name, l.stage?.name, l.priority, l.temperature, l.lead_type, l.budget_band, l.unit_size, l.location_pref,
        l.possession_pref, l.assigned_to ? refs.staffName.get(l.assigned_to) : "", ist(l.next_followup_at), l.next_followup_note,
        ist(l.first_contacted_at), ist(l.last_activity_at), l.reenquiry_count, l.lost?.name, l.lost_remarks, l.description, ist(l.created_at),
        l.provider, l.campaign_name ?? l.campaign_id, l.adset_name ?? l.adset_id, l.ad_name ?? l.ad_id, l.form_name ?? l.form_id, l.qualification, l.property_type, l.bhk, (l.tags ?? []).join(", "), (l.interests ?? []).join(", "), l.id]);
    }
    if (!data || data.length < 1000) break;
  }
  const name = `relive-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(toCsv(out), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });
}
