import Link from "next/link";
import { redirect } from "next/navigation";
import { canLead, canWorkLeads, getStaff } from "@/lib/session";
import { ago, dateTime, one, todayIST } from "@/lib/format";
import { Avatar, Emoji, Page, PageHeader, TempBadge, type EmojiName } from "@/components/ui";
import { AfterCallPrompt, CallButton } from "@/components/client";
import { logCall } from "../leads/[id]/actions";
import type { LeadRow, Stage } from "@/lib/types";

type Search = Promise<Record<string, string | string[] | undefined>>;
const SELECT = "id,temperature,assigned_to,next_followup_at,next_followup_note,last_activity_at,created_at,first_contacted_at,reenquiry_count,stage_id,stage:stages(name,kind),project:projects(name),source:sources(name),person:people!inner(full_name,phone_e164,city)";

export default async function FollowUps({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { sb, profile, reports } = await getStaff();
  if (!canWorkLeads(profile.role)) redirect("/");
  const scopeAll = canLead(profile.role, reports) && one(sp.scope) !== "mine";

  const { data: st } = await sb.from("stages").select("id,kind").eq("kind", "open");
  const openIds = ((st ?? []) as Pick<Stage, "id" | "kind">[]).map((s) => s.id);

  let fresh = sb.from("leads").select(SELECT).is("first_contacted_at", null).in("stage_id", openIds).order("created_at", { ascending: true }).limit(100);
  let due = sb.from("leads").select(SELECT).not("next_followup_at", "is", null).in("stage_id", openIds).order("next_followup_at", { ascending: true }).limit(300);
  if (!scopeAll) { fresh = fresh.eq("assigned_to", profile.id); due = due.eq("assigned_to", profile.id); }

  const [freshRes, dueRes] = await Promise.all([fresh, due]);
  const newLeads = (freshRes.data ?? []) as unknown as LeadRow[];
  const scheduled = (dueRes.data ?? []) as unknown as LeadRow[];

  const endOfToday = new Date(`${todayIST()}T23:59:59.999+05:30`);
  const now = Date.now();
  const overdue = scheduled.filter((l) => new Date(l.next_followup_at!).getTime() < now);
  const today = scheduled.filter((l) => { const t = new Date(l.next_followup_at!).getTime(); return t >= now && t <= endOfToday.getTime(); });
  const later = scheduled.filter((l) => new Date(l.next_followup_at!).getTime() > endOfToday.getTime()).slice(0, 25);

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
          {([["Never contacted", newLeads.length, "zap", "text-bad"], ["Overdue", overdue.length, "clock", "text-bad"], ["Due today", today.length, "bell", ""], ["Coming up", later.length, "calendar", "text-mute"]] as [string, number, EmojiName, string][]).map(([l, n, e, tone]) => (
            <a key={l} href={`#${l.replace(/ /g, "-").toLowerCase()}`} className="panel lift flex items-center justify-between p-4">
              <div><div className="text-[12px] text-mute">{l}</div><div className={`figure mt-1 text-[28px] leading-none ${n ? tone : "text-faint"}`}>{n}</div></div>
              <Emoji name={e} size={22} />
            </a>
          ))}
        </div>
        <Group title="Never contacted" emoji="zap" tone="bad" rows={newLeads} when="created" empty="Nothing waiting for a first call." />
        <Group title="Overdue" emoji="clock" tone="bad" rows={overdue} when="followup" empty="No overdue follow-ups." />
        <Group title="Due today" emoji="bell" tone="ink" rows={today} when="followup" empty="Nothing else due today." />
        <Group title="Coming up" emoji="calendar" tone="mute" rows={later} when="followup" empty="No upcoming follow-ups scheduled." />
      </Page>
      <AfterCallPrompt action={logCall} outcomes={["Connected, interested", "Connected, call later", "Connected, not interested", "No answer", "Busy", "Switched off"]} />
    </>
  );
}

function Group({ title, emoji, rows, when, tone, empty }: { title: string; emoji: EmojiName; rows: LeadRow[]; when: "created" | "followup"; tone: "bad" | "ink" | "mute"; empty: string }) {
  const color = tone === "bad" ? "text-bad" : tone === "ink" ? "text-ink" : "text-mute";
  return (
    <section id={title.replace(/ /g, "-").toLowerCase()} className="panel scroll-mt-20">
      <div className="panel-head">
        <h2 className={`panel-title flex items-center gap-2 ${rows.length ? color : "text-mute"}`}><Emoji name={emoji} size={15} />{title}</h2>
        <span className="text-[12px] text-mute">{rows.length}</span>
      </div>
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
