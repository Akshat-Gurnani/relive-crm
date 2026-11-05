import Link from "next/link";
import { redirect } from "next/navigation";
import { canWorkLeads, getStaff } from "@/lib/session";
import { minutes, one, pct } from "@/lib/format";
import { Empty, Notice, Page, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type Row = {
  id: string; name: string; role: string; assigned: number; contacted: number; median_first_call_min: number | null; within_5: number; within_60: number;
  calls: number; connected: number; talk_seconds: number; leads_called: number; active_days: number; visits_planned: number; visits_done: number;
  won: number; lost: number; rotated_away: number; claimed: number; open_now: number; overdue: number; never_contacted: number; idle: number;
};
type Funnel = { name: string; leads: number; contacted: number; visited: number; won: number; lost: number; open: number; avg_first_contact_min: number | null };

const PERIODS: [string, string][] = [["today", "Today"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["month", "This month"]];
function range(p: string): { from: Date; to: Date } {
  const now = new Date();
  const istMidnight = (d: Date) => new Date(new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) + "T00:00:00+05:30");
  if (p === "today") return { from: istMidnight(now), to: now };
  if (p === "month") { const t = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 7); return { from: new Date(`${t}-01T00:00:00+05:30`), to: now }; }
  const days = Number(p) || 30;
  return { from: istMidnight(new Date(now.getTime() - (days - 1) * 86400_000)), to: now };
}
const SORTS: Record<string, (r: Row) => number> = {
  name: () => 0, assigned: (r) => r.assigned, speed: (r) => -(r.median_first_call_min ?? 1e9), calls: (r) => r.calls, talk: (r) => r.talk_seconds,
  visits: (r) => r.visits_done, won: (r) => r.won, overdue: (r) => r.overdue, idle: (r) => r.idle, open: (r) => r.open_now,
};

// Team performance: one row per person for the period, then where leads come from and how far they get.
export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { sb, profile, reports } = await getStaff();
  if (!canWorkLeads(profile.role)) redirect("/");
  const p = one(sp.p) ?? "30";
  const sort = one(sp.sort) ?? "assigned";
  const { from, to } = range(p);
  const args = { p_from: from.toISOString(), p_to: new Date(to.getTime() + 1000).toISOString() };
  const [teamRes, srcRes, projRes] = await Promise.all([
    sb.rpc("team_report", args),
    sb.rpc("funnel_report", { ...args, p_by: "source" }),
    sb.rpc("funnel_report", { ...args, p_by: "project" }),
  ]);
  const err = teamRes.error ?? srcRes.error ?? projRes.error;
  const rows = ((teamRes.data ?? []) as Row[]).filter((r) => r.role !== "admin" || r.assigned + r.calls + r.open_now > 0);
  const key = SORTS[sort] ?? SORTS.assigned;
  rows.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : key(b) - key(a)));
  const sum = (k: keyof Row) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const team = rows.length > 1 || profile.role === "admin" || reports.length > 0;
  const href = (o: Record<string, string>) => `/reports?${new URLSearchParams({ p, sort, ...o })}`;
  const Th = ({ k, children, right = true }: { k: string; children: React.ReactNode; right?: boolean }) => (
    <th className={`th whitespace-nowrap ${right ? "text-right" : ""}`}><Link href={href({ sort: k })} className={sort === k ? "text-ink underline" : "hover:text-ink"}>{children}</Link></th>
  );

  // the few things worth acting on this week
  const flags: string[] = [];
  const slow = rows.filter((r) => r.assigned >= 5 && (r.median_first_call_min ?? 0) > 60).map((r) => r.name);
  if (slow.length) flags.push(`Slow first call (median over an hour): ${slow.join(", ")}.`);
  const overdue = [...rows].sort((a, b) => b.overdue - a.overdue).filter((r) => r.overdue >= 20).slice(0, 3);
  if (overdue.length) flags.push(`Most overdue follow-ups: ${overdue.map((r) => `${r.name} (${r.overdue})`).join(", ")}.`);
  const idle = [...rows].sort((a, b) => b.idle - a.idle).filter((r) => r.idle >= 20).slice(0, 3);
  if (idle.length) flags.push(`Most leads untouched 15+ days: ${idle.map((r) => `${r.name} (${r.idle})`).join(", ")}.`);
  const noCalls = rows.filter((r) => r.role === "agent" && r.open_now > 0 && r.calls === 0).map((r) => r.name);
  if (noCalls.length && p !== "today") flags.push(`No calls logged in this period: ${noCalls.join(", ")}.`);

  return (
    <>
      <PageHeader crumbs={[{ label: "Reports" }]}>
        <div className="flex flex-wrap gap-1.5">{PERIODS.map(([k, l]) => <Link key={k} href={`/reports?${new URLSearchParams({ p: k, sort })}`} className="chip" aria-current={p === k ? "true" : undefined}>{l}</Link>)}</div>
      </PageHeader>
      <Page>
        {err && <Notice>{err.message}</Notice>}
        {flags.length > 0 && (
          <section className="panel p-5">
            <h2 className="panel-title mb-2">Worth a look</h2>
            <ul className="list-disc space-y-1 pl-5 text-[13px]">{flags.map((f) => <li key={f}>{f}</li>)}</ul>
          </section>
        )}

        <section className="panel overflow-x-auto">
          <div className="panel-head"><h2 className="panel-title">{team ? "Team performance" : "My performance"}</h2><span className="text-[12px] text-mute">Click a column to sort. &ldquo;Now&rdquo; columns are today&apos;s state, not the period.</span></div>
          {rows.length === 0 ? <Empty emoji="thinking">No activity in this period.</Empty> : (
            <table className="w-full text-[13px]">
              <thead><tr>
                <Th k="name" right={false}>Person</Th>
                <Th k="assigned">Leads got</Th>
                <th className="th text-right whitespace-nowrap">Called</th>
                <Th k="speed">First call (median)</Th>
                <th className="th text-right whitespace-nowrap">≤ 5 min</th>
                <Th k="calls">Calls · connected</Th>
                <Th k="talk">Talk time</Th>
                <Th k="visits">Visits done</Th>
                <Th k="won">Booked</Th>
                <th className="th text-right">Lost</th>
                <th className="th text-right whitespace-nowrap">Taken away</th>
                <th className="th text-right whitespace-nowrap">Claimed first</th>
                <Th k="open">Open now</Th>
                <Th k="overdue">Overdue now</Th>
                <Th k="idle">Untouched 15d+</Th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="row">
                    <td className="td whitespace-nowrap"><Link href={`/leads?assignee=${r.id}`} className="font-medium hover:underline">{r.name}</Link>{r.role !== "agent" && <span className="ml-1 text-[11px] text-faint">{r.role === "manager" ? "team leader" : r.role}</span>}</td>
                    <td className="td text-right tabular-nums">{r.assigned}</td>
                    <td className="td text-right tabular-nums">{pct(r.contacted, r.assigned)}</td>
                    <td className={`td text-right tabular-nums ${(r.median_first_call_min ?? 0) > 60 ? "text-bad" : ""}`}>{r.median_first_call_min == null ? "–" : minutes(r.median_first_call_min)}</td>
                    <td className="td text-right tabular-nums">{pct(r.within_5, r.assigned)}</td>
                    <td className="td text-right tabular-nums">{r.calls} <span className="text-mute">· {r.connected}</span></td>
                    <td className="td text-right tabular-nums">{r.talk_seconds ? minutes(r.talk_seconds / 60) : "–"}</td>
                    <td className="td text-right tabular-nums">{r.visits_done}{r.visits_planned ? <span className="text-mute"> / {r.visits_planned} planned</span> : null}</td>
                    <td className="td text-right tabular-nums text-won">{r.won || "–"}</td>
                    <td className="td text-right tabular-nums text-mute">{r.lost || "–"}</td>
                    <td className={`td text-right tabular-nums ${r.rotated_away ? "text-warn" : "text-faint"}`}>{r.rotated_away || "–"}</td>
                    <td className="td text-right tabular-nums">{r.claimed || <span className="text-faint">–</span>}</td>
                    <td className="td text-right tabular-nums">{r.open_now}</td>
                    <td className={`td text-right tabular-nums ${r.overdue ? "text-bad" : ""}`}><Link href={`/leads?view=overdue&assignee=${r.id}`} className="hover:underline">{r.overdue}</Link></td>
                    <td className={`td text-right tabular-nums ${r.idle ? "text-warn" : ""}`}>{r.idle}</td>
                  </tr>
                ))}
                {rows.length > 1 && (
                  <tr className="border-t border-line/15 font-semibold">
                    <td className="td">Total</td>
                    <td className="td text-right tabular-nums">{sum("assigned")}</td>
                    <td className="td text-right tabular-nums">{pct(sum("contacted"), sum("assigned"))}</td>
                    <td className="td text-right">–</td>
                    <td className="td text-right tabular-nums">{pct(sum("within_5"), sum("assigned"))}</td>
                    <td className="td text-right tabular-nums">{sum("calls")} <span className="text-mute">· {sum("connected")}</span></td>
                    <td className="td text-right tabular-nums">{minutes(sum("talk_seconds") / 60)}</td>
                    <td className="td text-right tabular-nums">{sum("visits_done")}</td>
                    <td className="td text-right tabular-nums text-won">{sum("won")}</td>
                    <td className="td text-right tabular-nums">{sum("lost")}</td>
                    <td className="td text-right tabular-nums">{sum("rotated_away")}</td>
                    <td className="td text-right tabular-nums">{sum("claimed")}</td>
                    <td className="td text-right tabular-nums">{sum("open_now")}</td>
                    <td className="td text-right tabular-nums">{sum("overdue")}</td>
                    <td className="td text-right tabular-nums">{sum("idle")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          <p className="px-4 pb-3 text-[11.5px] text-faint">Leads got: leads handed to the person in the period (new, rotated, claimed or reassigned). First call: time from getting the lead to their first logged call. Taken away: leads moved off them by rotation. Claimed first: open-pool leads they called before anyone else.</p>
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <FunnelTable title="Lead sources" rows={(srcRes.data ?? []) as Funnel[]} />
          <FunnelTable title="Projects" rows={(projRes.data ?? []) as Funnel[]} />
        </div>
      </Page>
    </>
  );
}

function FunnelTable({ title, rows }: { title: string; rows: Funnel[] }) {
  return (
    <section className="panel overflow-x-auto">
      <div className="panel-head"><h2 className="panel-title">{title}</h2><span className="text-[12px] text-mute">leads that arrived in the period, and how far they got</span></div>
      {rows.length === 0 ? <Empty emoji="mailbox">No leads in this period.</Empty> : (
        <table className="w-full text-[13px]">
          <thead><tr><th className="th">Name</th><th className="th text-right">Leads</th><th className="th text-right">Contacted</th><th className="th text-right">Visited</th><th className="th text-right">Booked</th><th className="th text-right">Lost</th><th className="th text-right whitespace-nowrap">Avg first contact</th></tr></thead>
          <tbody>{rows.slice(0, 25).map((r) => (
            <tr key={r.name} className="row">
              <td className="td">{r.name}</td>
              <td className="td text-right tabular-nums">{r.leads}</td>
              <td className="td text-right tabular-nums">{pct(r.contacted, r.leads)}</td>
              <td className="td text-right tabular-nums">{r.visited} <span className="text-mute">({pct(r.visited, r.leads)})</span></td>
              <td className="td text-right tabular-nums text-won">{r.won || "–"}</td>
              <td className="td text-right tabular-nums text-mute">{pct(r.lost, r.leads)}</td>
              <td className="td text-right tabular-nums">{r.avg_first_contact_min == null ? "–" : minutes(r.avg_first_contact_min)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}
