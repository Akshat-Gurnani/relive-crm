import Link from "next/link";
import { redirect } from "next/navigation";
import { canLead, canWorkLeads, getStaff } from "@/lib/session";
import { dateTime, daysAgoIST, minutes, one, pct, todayIST } from "@/lib/format";
import { getRefs } from "@/lib/refs";
import { Avatar, Empty, Page, PageHeader } from "@/components/ui";

type Row = { id: string; lead_id: string | null; agent_id: string | null; direction: string; status: string; started_at: string; duration_seconds: number; phone_e164: string | null; outcome: string | null; provider: string | null; person: { full_name: string | null } | null };

// Call history and analytics, the replacement for Cratio's Call History, Call Analytics and Call Toppers.
export default async function Calls({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { sb, profile, reports } = await getStaff();
  if (!canWorkLeads(profile.role)) redirect("/");
  const refs = await getRefs();
  const from = one(sp.from) ?? daysAgoIST(6), to = one(sp.to) ?? todayIST();
  const agent = one(sp.agent) ?? "", dir = one(sp.dir) ?? "", status = one(sp.status) ?? "";
  let q = sb.from("calls").select("id,lead_id,agent_id,direction,status,started_at,duration_seconds,phone_e164,outcome,provider,person:people(full_name)")
    .gte("started_at", `${from}T00:00:00+05:30`).lte("started_at", `${to}T23:59:59.999+05:30`).order("started_at", { ascending: false }).limit(2000);
  if (agent) q = q.eq("agent_id", agent);
  if (dir) q = q.eq("direction", dir);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];
  const connected = rows.filter((r) => r.status === "connected");
  const talk = connected.reduce((n, r) => n + r.duration_seconds, 0);
  const byAgent = new Map<string, { dialed: number; connected: number; talk: number; incoming: number; missed: number; longest: number }>();
  for (const r of rows) {
    const k = r.agent_id ?? "none";
    const a = byAgent.get(k) ?? { dialed: 0, connected: 0, talk: 0, incoming: 0, missed: 0, longest: 0 };
    if (r.direction === "outgoing") a.dialed++; else a.incoming++;
    if (r.status === "connected") { a.connected++; a.talk += r.duration_seconds; a.longest = Math.max(a.longest, r.duration_seconds); }
    if (r.status === "missed") a.missed++;
    byAgent.set(k, a);
  }
  const toppers = [...byAgent.entries()].sort((a, b) => b[1].talk - a[1].talk);
  const tiles = [
    ["Calls", rows.length.toLocaleString("en-IN")], ["Connected", `${pct(connected.length, rows.length)}`], ["Talk time", minutes(talk / 60)],
    ["Avg connected call", connected.length ? minutes(talk / connected.length / 60) : "–"], ["Incoming", String(rows.filter((r) => r.direction === "incoming").length)],
    ["Missed", String(rows.filter((r) => r.status === "missed").length)],
  ];
  return (
    <>
      <PageHeader crumbs={[{ label: "Calls" }]}>
        <form method="get" className="flex flex-wrap items-center gap-1.5">
          <input type="date" name="from" defaultValue={from} className="input w-[9rem]" aria-label="From" />
          <span className="text-faint">to</span>
          <input type="date" name="to" defaultValue={to} className="input w-[9rem]" aria-label="To" />
          {canLead(profile.role, reports) && (
            <select name="agent" defaultValue={agent} className="input w-40" aria-label="Agent"><option value="">Everyone</option>{refs.assignable.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
          )}
          <select name="dir" defaultValue={dir} className="input w-32" aria-label="Direction"><option value="">In and out</option><option value="outgoing">Outgoing</option><option value="incoming">Incoming</option></select>
          <select name="status" defaultValue={status} className="input w-36" aria-label="Status"><option value="">Any result</option><option value="connected">Connected</option><option value="not_connected">Not connected</option><option value="missed">Missed</option></select>
          <button className="btn" type="submit">Apply</button>
        </form>
      </PageHeader>
      <Page>
        <section className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {tiles.map(([l, v]) => <div key={l} className="panel lift p-4"><div className="text-[12px] text-mute">{l}</div><div className="figure mt-2 text-[26px] leading-none">{v}</div></div>)}
        </section>
        {toppers.length > 0 && (
          <section className="panel overflow-x-auto">
            <div className="panel-head"><h2 className="panel-title">Call toppers</h2><span className="text-[12px] text-mute">by talk time</span></div>
            <table className="w-full">
              <thead><tr><th className="th">Agent</th><th className="th text-right">Dialed</th><th className="th text-right">Connected</th><th className="th text-right">Talk time</th><th className="th text-right">Longest</th><th className="th text-right">Incoming</th><th className="th text-right">Missed</th></tr></thead>
              <tbody>{toppers.map(([k, a], i) => {
                const nm = k === "none" ? "Unknown" : refs.staffName.get(k) ?? "Unknown";
                return (
                  <tr key={k} className="row">
                    <td className="td"><span className="flex items-center gap-2">{i < 3 && <span className="w-4 text-center">{["🥇", "🥈", "🥉"][i]}</span>}<Avatar name={nm} size={22} />{nm}</span></td>
                    <td className="td text-right tabular-nums">{a.dialed}</td>
                    <td className="td text-right tabular-nums">{a.connected} <span className="text-mute">({pct(a.connected, a.dialed + a.incoming)})</span></td>
                    <td className="td text-right tabular-nums">{minutes(a.talk / 60)}</td>
                    <td className="td text-right tabular-nums">{minutes(a.longest / 60)}</td>
                    <td className="td text-right tabular-nums">{a.incoming}</td>
                    <td className="td text-right tabular-nums text-bad">{a.missed || ""}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </section>
        )}
        <section className="panel overflow-x-auto">
          <div className="panel-head"><h2 className="panel-title">Call history</h2><span className="text-[12px] text-mute">{rows.length} calls</span></div>
          {rows.length === 0 ? <Empty emoji="call">No calls in this period.</Empty> : (
            <table className="w-full">
              <thead><tr><th className="th">When</th><th className="th">Customer</th><th className="th">Agent</th><th className="th">Type</th><th className="th text-right">Duration</th><th className="th">Outcome</th></tr></thead>
              <tbody>{rows.slice(0, 300).map((r) => (
                <tr key={r.id} className="row">
                  <td className="td whitespace-nowrap">{dateTime(r.started_at)}</td>
                  <td className="td">{r.lead_id ? <Link href={`/leads/${r.lead_id}?tab=calls`} className="hover:underline">{r.person?.full_name ?? r.phone_e164}</Link> : <span className="text-mute">{r.phone_e164 ?? "Unknown"} <span className="text-[11px] text-faint">not a lead</span></span>}</td>
                  <td className="td">{r.agent_id ? refs.staffName.get(r.agent_id) : "–"}</td>
                  <td className="td"><span className={r.status === "connected" ? "text-won" : r.status === "missed" ? "text-bad" : "text-mute"}>{r.direction === "incoming" ? "In" : "Out"} · {r.status.replace("_", " ")}</span>{r.provider === "android" && <span className="ml-1 text-[11px] text-faint">phone</span>}</td>
                  <td className="td text-right tabular-nums">{Math.floor(r.duration_seconds / 60)}:{String(r.duration_seconds % 60).padStart(2, "0")}</td>
                  <td className="td text-mute">{r.outcome ?? ""}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </Page>
    </>
  );
}
