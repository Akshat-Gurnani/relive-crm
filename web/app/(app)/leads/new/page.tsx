import { redirect } from "next/navigation";
import { canManage, canWorkLeads, getStaff } from "@/lib/session";
import { one } from "@/lib/format";
import { getRefs } from "@/lib/refs";
import { Notice, Page, PageHeader } from "@/components/ui";
import { LeadFields } from "@/components/lead-form";
import { createLead } from "../actions";

export default async function NewLead({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { profile } = await getStaff();
  if (!canWorkLeads(profile.role)) redirect("/");
  const refs = await getRefs();
  return (
    <>
      <PageHeader crumbs={[{ label: "Leads", href: "/leads" }, { label: "Add lead" }]} />
      <Page>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        {one(sp.notice) && <Notice tone="ok">{one(sp.notice)}</Notice>}
        <form action={createLead} className="space-y-5">
          <LeadFields refs={refs} mode="new" manage={canManage(profile.role)} />
          <div className="flex flex-wrap gap-2">
            <button className="btn" type="submit">Save lead</button>
            <button className="btn-quiet" type="submit" name="again" value="1">Save and add another</button>
          </div>
        </form>
      </Page>
    </>
  );
}
