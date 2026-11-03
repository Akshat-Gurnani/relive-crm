import Link from "next/link";
import { redirect } from "next/navigation";
import { canLead, canWorkLeads, getStaff } from "@/lib/session";
import { ago, dateTime, one, todayIST } from "@/lib/format";
import { Avatar, Emoji, Page, PageHeader, TempBadge, type EmojiName } from "@/components/ui";
import { AfterCallPrompt, CallButton } from "@/components/client";
import { logCall } from "../leads/[id]/actions";
import type { LeadRow, Stage } from "@/lib/types";

type Search = Promise<Record<string, string | string[] | undefined>>;
const RECENT_DAYS = 30;
const SELECT = "id,temperature,assigned_to,next_followup_at,next_followup_note,last_activity_at,created_at,first_contacted_at,reenquiry_count,stage_id,stage:stages(name,kind),project:projects(name),source:sources(name),person:people!inner(full_name,phone_e164,city)";

export default async function FollowUps({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { sb, profile, reports } = await getStaff();
  if (!canWorkLeads(profile.role)) redirect("/");
  const scopeAll = canLead(profile.role, reports) && one(sp.scope) !== "mine";

  const { data: st } = await sb.from("stages").select("id,kind").eq("kind", "open");
  const openIds = ((st ?? []) as Pick<Stage, "id" | "kind">[]).map((s) => s.id);

  // The queue is ordered by what needs a person now. Leads from the Cratio import carry old dates, so they are kept in
  // their own "backlog" sections instead of pushing today's leads out of a capped list. Totals are always the true counts.
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const recentIso = new Date(now - RECENT_DAYS * 86_400_000).toISOString();
  const endOfToday = new Date(`${todayIST()}T23:59:59.999+05:30`);
  const endIso = endOfToday.toISOString();
  const base = () => {
    const q = sb.from("leads").select(SELECT, { count: "exact" }).in("stage_id", openIds);
    return scopeAll ? q : q.eq("assigned_to", profile.id);
  };
  const [freshRes, oldFreshRes, overdueRes, backlogRes, todayRes, laterRes] = await Promise.all([
    base().is("first_contacted_at", null).gte("created_at", recentIso).order("created_at", { ascending: false }).limit(100),
    base().is("first_contacted_at", null).lt("created_at", recentIso).order("created_at", { ascending: false }).limit(25),
    base().gte("next_followup_at", recentIso).lt("next_followup_at", nowIso).order("next_followup_at", { ascending: true }).limit(200),
    base().lt("next_followup_at", recentIso).order("next_followup_at", { ascending: false }).limit(25),
    base().gte("next_followup_at", nowIso).lte("next_followup_at", endIso).order("next_followup_at", { ascending: true }).limit(200),
    base().gt("next_followup_at", endIso).order("next_followup_at", { ascending: true }).limit(25),
  ]);
  const rows = (r: { data: unknown }) => (r.data ?? []) as unknown as LeadRow[];
  const newLeads = rows(freshRes), oldNew = rows(oldFreshRes), overdue = rows(overdueRes), backlog = rows(backlogRes), today = rows(todayRes), later = rows(laterRes);
  const total = (r: { count: number | null }, fallback: number) => r.count ?? fallback;
  const tNew = total(freshRes, newLeads.length), tOldNew = total(oldFreshRes, oldNew.length), tOverdue = total(overdueRes, overdue.length);
  const tBacklog = total(backlogRes, backlog.length), tToday = total(todayRes, today.length), tLater = total(laterRes, later.length);

  return (
    <>
      <PageHeader crumbs={[{ label: "Follow-up queue" }]}>
        {canLead(profile.role, reports) && (
          <div className="flex gap-1.5">
            <Link href="/followups?scope=mine" className="chip" aria-current={!scopeAll ? "true" : undefined}>Mine</Link>
            <Link href="/followups" className="chip" aria-current={scopeAll ? "true" : undefined}>Team</Link>
          </div>
        )}
      </PageHeader>
      <Page>
        <p className="text-mute">{scopeAll ? "Everyone you can see" : "Your leads"}. Work top to bottom: first calls, then overdue, then today.</p>
        <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
          {([["Never contacted", tNew, "zap", "text-bad"], ["Overdue", tOverdue, "clock", "text-bad"], ["Due today", tToday, "bell", ""], ["Coming up", tLater, "calendar", "text-mute"]] as [string, number, EmojiName, string][]).map(([l, n, e, tone]) => (
            <a key={l} href={`#${l.replace(/ /g, "-").toLowerCase()}`} className="panel lift flex items-center justify-between p-4">
              <div><div className="text-[12px] text-mute">{l}</div><div className={`figure mt-1 text-[28px] leading-none ${n ? tone : "text-faint"}`}>{n}</div></div>
              <Emoji name={e} size={22} />
            </a>
          ))}
        </div>
        <Group title="Never contacted" emoji="zap" tone="bad" rows={newLeads} total={tNew} when="created" empty="Nothing waiting for a first call." />
        <Group title="Overdue" emoji="clock" tone="bad" rows={overdue} total={tOverdue} when="followup" empty="No overdue follow-ups from the last 30 days." />
        <Group title="Due today" emoji="bell" tone="ink" rows={today} total={tToday} when="followup" empty="Nothing else due today." />
        <Group title="Coming up" emoji="calendar" tone="mute" rows={later} total={tLater} when="followup" empty="No upcoming follow-ups scheduled." />
        <Group title="Older, never contacted" emoji="zap" tone="mute" rows={oldNew} total={tOldNew} when="created" empty="No older leads are waiting for a first call." note="Leads that arrived more than 30 days ago, newest first. Mostly from the Cratio import." />
        <Group title="Backlog, overdue over 30 days" emoji="clock" tone="mute" rows={backlog} total={tBacklog} when="followup" empty="No old overdue follow-ups." note="Follow-ups missed more than 30 days ago, most recent first. Reschedule or close them in bulk from Leads." />
      </Page>
      <AfterCallPrompt action={logCall} outcomes={["Connected, interested", "Connected, call later", "Connected, not interested", "No answer", "Busy", "Switched off"]} />
    </>
  );
}

function Group({ title, emoji, rows, total, when, tone, empty, note }: { title: string; emoji: EmojiName; rows: LeadRow[]; total: number; when: "created" | "followup"; tone: "bad" | "ink" | "mute"; empty: string; note?: string }) {
  const color = tone === "bad" ? "text-bad" : tone === "ink" ? "text-ink" : "text-mute";
  return (
    <section id={title.replace(/ /g, "-").toLowerCase()} className="panel scroll-mt-20">
      <div className="panel-head">
        <h2 className={`panel-title flex items-center gap-2 ${rows.length ? color : "text-mute"}`}><Emoji name={emoji} size={15} />{title}</h2>
        <span className="text-[12px] text-mute">{total > rows.length ? `showing ${rows.length} of ${total}` : total}</span>
      </div>
      {note && <p className="px-4 pt-2 text-[12px] text-mute">{note}</p>}
      {rows.length === 0 ? <p className="px-4 py-3 text-mute">{empty}</p> : (
        <ul>
          {rows.map((l) => (
            <li key={l.id} className="row grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 md:grid-cols-[auto_14rem_8rem_1fr_auto]">
              <Avatar name={l.person.full_name || l.person.phone_e164} size={28} />
              <div className="min-w-0">
                <Link href={`/leads/${l.id}`} className="block truncate font-medium hover:underline">{l.person.full_name || "No name"}</Link>
                <span className="text-[12px] tabular-nums text-mute">{l.person.phone_e164}</span>
              </div>
              <div className="hidden md:block"><TempBadge t={l.temperature} /></div>
              <div className="hidden min-w-0 md:block">
                <div className="truncate text-[12.5px]">{l.project?.name ?? "No project"} <span className="text-mute">· {l.source?.name ?? "No source"}</span>{l.reenquiry_count > 0 && <span className="text-warn"> · re-enquired ×{l.reenquiry_count}</span>}</div>
                {l.next_followup_note && when === "followup" && <div className="truncate text-[12px] text-mute">{l.next_followup_note}</div>}
              </div>
              <span className="flex items-center justify-end gap-2"><span className={`whitespace-nowrap text-right text-[12.5px] ${tone === "bad" ? "text-bad" : "text-mute"}`}>{when === "created" ? `arrived ${ago(l.created_at)}` : dateTime(l.next_followup_at)}</span><CallButton leadId={l.id} phone={l.person.phone_e164} className="btn-quiet h-8 px-3" /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
