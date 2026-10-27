import Link from "next/link";
import { Avatar, Emoji, Notice, Page, PageHeader, type EmojiName } from "@/components/ui";
import { getStaff } from "@/lib/session";
import { daysAgoIST, minutes, one, pct, todayIST } from "@/lib/format";
import type { DashboardStats, Named, Stage, Staff } from "@/lib/types";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Dashboard({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const from = one(sp.from) ?? daysAgoIST(30);
  const to = one(sp.to) ?? todayIST();
  const { sb, profile, reports } = await getStaff();

  const [{ data: raw, error }, stagesRes, sourcesRes, projectsRes, staffRes] = await Promise.all([
    sb.rpc("dashboard_stats", { p_from: from, p_to: to }),
    sb.from("stages").select("id,name,kind,position").order("position"),
    sb.from("sources").select("id,name"),
    sb.from("projects").select("id,name"),
    sb.from("staff_directory").select("id,full_name"),
  ]);
  if (error) return <><PageHeader crumbs={[{ label: "Funnel of sales" }]} /><Page><Notice>Could not load the dashboard: {error.message}</Notice></Page></>;

  const s = raw as DashboardStats;
  const stages = (stagesRes.data ?? []) as Stage[];
  const sources = new Map(((sourcesRes.data ?? []) as Named[]).map((x) => [x.id, x.name]));
  const projects = new Map(((projectsRes.data ?? []) as Named[]).map((x) => [x.id, x.name]));
  const staff = new Map(((staffRes.data ?? []) as Pick<Staff, "id" | "full_name">[]).map((x) => [x.id, x.full_name]));
  const stageCount = new Map(s.pipeline_by_stage.map((x) => [x.stage_id, x.leads]));
  const maxStage = Math.max(1, ...stages.map((st) => stageCount.get(st.id) ?? 0));

  const t = s.totals;
  const scope = profile.role === "agent" ? (reports.length ? "Your leads and the people under you" : "Your leads") : profile.role === "manager" ? "Your team's leads" : ["marketing", "viewer"].includes(profile.role) ? "Aggregates only, no personal details" : "All leads";
  const days = Math.round((+new Date(to) - +new Date(from)) / 86400000) + 1;
  // marketing and viewers see totals only; everyone else can open the leads behind a number
  const open = !["marketing", "viewer"].includes(profile.role);
  const list = (p: Record<string, string>) => (open ? `/leads?${new URLSearchParams({ ...p, from, to })}` : undefined);
  const tiles: { label: string; value: string; note: string; emoji: EmojiName; href?: string; tone?: string }[] = [
    { label: "Contacted", value: pct(t.contacted, t.leads), note: `${t.contacted.toLocaleString("en-IN")} of ${t.leads.toLocaleString("en-IN")} new leads`, emoji: "call", href: list({ view: "contacted" }) },
    { label: "Speed to first call", value: minutes(t.avg_minutes_to_first_contact), note: "average, contacted leads", emoji: "zap", href: list({ view: "contacted" }) },
    { label: "Converted", value: t.converted.toLocaleString("en-IN"), note: `${pct(t.converted, t.leads)} of new leads`, emoji: "party", href: list({ view: "converted" }) },
    ...(t.lost != null ? [{ label: "Lost", value: t.lost.toLocaleString("en-IN"), note: `${pct(t.lost, t.leads)} of new leads`, emoji: "cold" as EmojiName, href: list({ view: "lost" }) }] : []),
    ...(s.overdue_followups != null ? [{ label: "Overdue follow-ups", value: s.overdue_followups.toLocaleString("en-IN"), note: "open leads past due, any date", emoji: "clock" as EmojiName, href: open ? "/leads?view=overdue&sort=followup" : undefined, tone: s.overdue_followups > 0 ? "text-bad" : "" }] : []),
    ...(t.reenquiries != null ? [{ label: "Re-enquiries", value: t.reenquiries.toLocaleString("en-IN"), note: "repeat interest in period", emoji: "recycle" as EmojiName, href: list({ view: "reenquiry" }) }] : []),
  ];
  const openTotal = stages.filter((st) => st.kind === "open").reduce((n, st) => n + (stageCount.get(st.id) ?? 0), 0);

  return (
    <>
      <PageHeader crumbs={[{ label: "Funnel of sales" }]}>
        <form className="flex items-center gap-1.5" method="get">
          <label className="sr-only" htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={from} className="input w-[8.5rem]" />
          <span className="text-faint">to</span>
          <label className="sr-only" htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={to} className="input w-[8.5rem]" />
          <button className="btn" type="submit">Apply</button>
        </form>
      </PageHeader>
      <Page>
        <div className="stagger grid gap-4 lg:grid-cols-12">
          <section className="panel relative flex flex-col justify-between overflow-hidden p-7 lg:col-span-5">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-navy/60 blur-3xl" />
            <div className="flex items-center justify-between">
              <span className="eyebrow">{scope}</span>
              <span className="text-[12px] text-mute">{days} days</span>
            </div>
            <div className="mt-6">
              {open ? <Link href={list({})!} className="figure grad block text-[72px] leading-none hover:opacity-90">{t.leads.toLocaleString("en-IN")}</Link>
                : <div className="figure grad text-[72px] leading-none">{t.leads.toLocaleString("en-IN")}</div>}
              <div className="mt-2 text-[15px] text-mute">new leads, {from} to {to}</div>
            </div>
            <p className="mt-6 max-w-sm text-[13.5px] leading-relaxed text-ink/75">
              {t.leads === 0 ? "No leads arrived in this period." : <>
                <b className="font-semibold">{pct(t.contacted, t.leads)}</b> got a first call{t.avg_minutes_to_first_contact != null && <>, on average after <b className="font-semibold">{minutes(t.avg_minutes_to_first_contact)}</b></>}.{" "}
                <b className="font-semibold">{t.converted}</b> have booked so far.
              </>}
            </p>
          </section>

          <section className="stagger grid grid-cols-2 gap-4 lg:col-span-7 xl:grid-cols-3">
            {tiles.map((x) => {
              const body = (
                <div className="panel lift h-full p-4">
                  <div className="flex items-center justify-between"><span className="text-[12px] text-mute">{x.label}</span><Emoji name={x.emoji} size={18} /></div>
                  <div className={`figure mt-3 text-[30px] leading-none ${x.tone ?? ""}`}>{x.value}</div>
                  <div className="mt-1.5 text-[12px] text-mute">{x.note}</div>
                </div>
              );
              return x.href ? <Link key={x.label} href={x.href}>{body}</Link> : <div key={x.label}>{body}</div>;
            })}
          </section>

          <section className="panel lg:col-span-7">
            <div className="panel-head"><h2 className="panel-title">Pipeline now, by stage</h2><span className="text-[12px] text-mute">{openTotal.toLocaleString("en-IN")} open</span></div>
            <div className="space-y-2.5 p-4">
              {stages.map((st) => {
                const n = stageCount.get(st.id) ?? 0;
                const bar = st.kind === "won" ? "bg-won shadow-[0_0_12px_rgb(var(--won)/.6)]" : st.kind === "lost" ? "bg-white/15" : "bg-gradient-to-r from-sky/70 to-accent shadow-[0_0_12px_rgb(var(--accent)/.45)]";
                return (
                  <Link href={profile.role === "marketing" || profile.role === "viewer" ? "#" : `/leads?stage=${st.id}`} key={st.id} className="-mx-2 grid grid-cols-[9.5rem_1fr_3rem] items-center gap-3 rounded-lg px-2 py-0.5 transition hover:bg-white/[.04]">
                    <div className={`truncate text-[12.5px] ${st.kind === "lost" ? "text-mute" : ""}`}>{st.name}</div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-white/[.06]"><div className={`bar h-2.5 rounded-full ${bar}`} style={{ width: `${Math.max(n ? 2 : 0, (n / maxStage) * 100)}%` }} /></div>
                    <div className="figure text-right text-[14px]">{n.toLocaleString("en-IN")}</div>
                  </Link>
                );
              })}
            </div>
          </section>

          <div className="stagger grid gap-4 lg:col-span-5">
            <Bars title="By source" rows={s.by_source.map((r) => ({ name: r.source_id ? sources.get(r.source_id) ?? "Unknown" : "No source", href: list({ source: r.source_id ?? "none" }), ...r }))} />
            <Bars title="By project" rows={s.by_project.map((r) => ({ name: r.project_id ? projects.get(r.project_id) ?? "Unknown" : "No project", href: list({ project: r.project_id ?? "none" }), ...r }))} />
          </div>

          {s.by_agent.length > 0 && (
            <section className="panel overflow-x-auto lg:col-span-12">
              <div className="panel-head"><h2 className="panel-title">By agent</h2><span className="text-[12px] text-mute">leads created in period</span></div>
              <table className="w-full">
                <thead><tr><th className="th">Agent</th><th className="th text-right">Leads</th><th className="th">Contacted</th><th className="th text-right">Converted</th><th className="th text-right">Avg time to first call</th></tr></thead>
                <tbody>
                  {[...s.by_agent].sort((a, b) => b.leads - a.leads).map((a) => {
                    const nm = a.agent_id ? staff.get(a.agent_id) ?? "Unknown" : "Unassigned";
                    const c = a.leads ? a.contacted / a.leads : 0;
                    return (
                      <tr key={a.agent_id ?? "none"} className="row">
                        <td className="td"><Link href={list({ assignee: a.agent_id ?? "none" })!} className="flex items-center gap-2.5 hover:underline"><Avatar name={nm} size={24} />{nm}</Link></td>
                        <td className="td figure text-right text-[14px]">{a.leads}</td>
                        <td className="td"><span className="flex items-center gap-2"><span className="h-1.5 w-28 rounded-full bg-white/[.06]"><span className={`bar block h-1.5 rounded-full ${c < 0.6 ? "bg-bad/80" : "bg-gradient-to-r from-sky/70 to-accent"}`} style={{ width: `${c * 100}%` }} /></span><span className="tabular-nums text-mute">{pct(a.contacted, a.leads)}</span></span></td>
                        <td className="td figure text-right text-[14px]">{a.converted}</td>
                        <td className="td text-right tabular-nums">{minutes(a.avg_minutes)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </div>
        <p className="text-[12px] text-mute">Live from the database, not a cached snapshot.</p>
      </Page>
    </>
  );
}

function Bars({ title, rows }: { title: string; rows: { name: string; href?: string; leads: number; contacted: number; converted: number }[] }) {
  const sorted = [...rows].sort((a, b) => b.leads - a.leads);
  const max = Math.max(1, ...sorted.map((r) => r.leads));
  return (
    <section className="panel">
      <div className="panel-head"><h2 className="panel-title">{title}</h2><span className="text-[12px] text-mute">leads · converted</span></div>
      {sorted.length === 0 ? <p className="px-4 py-3 text-mute">No leads in this period.</p> : (
        <ul className="space-y-2 p-4">
          {sorted.map((r) => (
            <li key={r.name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[12.5px]">
              {r.href ? <Link href={r.href} className="truncate hover:underline">{r.name}</Link> : <span className="truncate">{r.name}</span>}
              <span className="h-2 rounded-full bg-white/[.06]"><span className="bar block h-2 rounded-full bg-gradient-to-r from-accent/60 to-accent" style={{ width: `${(r.leads / max) * 100}%` }} /></span>
              <span className="whitespace-nowrap tabular-nums text-mute"><span className="text-ink">{r.leads}</span> · {r.converted} <span className="text-faint">({pct(r.converted, r.leads)})</span></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
