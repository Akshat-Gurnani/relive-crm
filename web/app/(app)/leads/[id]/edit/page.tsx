import { notFound, redirect } from "next/navigation";
import { canManage, canWorkLeads, getStaff } from "@/lib/session";
import { one } from "@/lib/format";
import { getRefs } from "@/lib/refs";
import { Notice, Page, PageHeader } from "@/components/ui";
import { LeadFields } from "@/components/lead-form";
import type { LeadDetail, Person } from "@/lib/types";
import Link from "next/link";
import { saveLead } from "../actions";

export default async function EditLead({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, profile } = await getStaff();
  if (!canWorkLeads(profile.role)) redirect("/");
  const { data } = await sb.from("leads").select("*, person:people(*)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const lead = data as unknown as LeadDetail & { person: Person };
  const refs = await getRefs();
  return (
    <>
      <PageHeader crumbs={[{ label: "Leads", href: "/leads" }, { label: lead.person.full_name || lead.person.phone_e164, href: `/leads/${id}` }, { label: "Edit" }]} />
      <Page>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        <form action={saveLead} className="space-y-5">
          <input type="hidden" name="lead_id" value={id} />
          <input type="hidden" name="person_id" value={lead.person.id} />
          <LeadFields refs={refs} mode="edit" lead={lead} person={lead.person} manage={canManage(profile.role)} />
          <div className="flex gap-2"><button className="btn" type="submit">Save changes</button><Link href={`/leads/${id}`} className="btn-ghost">Cancel</Link></div>
        </form>
      </Page>
    </>
  );
}
