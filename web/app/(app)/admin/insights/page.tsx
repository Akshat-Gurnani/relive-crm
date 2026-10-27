import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { dateTime, one, pct } from "@/lib/format";
import { aiConfig } from "@/lib/ai";
import { PERIODS, periodRange, type Bucket, type Driver, type Snapshot } from "@/lib/insights";
import { Emoji, Notice, Page, PageHeader } from "@/components/ui";
import { askInsights, testAiKeys } from "./actions";
import { PendingButton } from "@/components/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUGGESTIONS = [
  "Give me a brief of this period: what is working, what is not, and what to fix first.",
  "Which lead sources should get more budget, and which should be cut?",
  "Which roads, budgets and property types turn into site visits most often?",
  "How much does first-call speed matter, and which owners are slow?",
  "Why are leads being lost, by source?",
  "Which projects are worth pushing, and which campaign is underperforming?",
];
const TABLES = ["Lead source", "Project", "Road / location", "Budget", "Property type", "BHK", "City", "Owner", "Campaign",
  "Channel", "Tag", "Also interested in", "Day lead arrived", "Time lead arrived", "Qualification"];
// speed, arrival time and weekday carry a sort prefix ("1 Under 5 min"); other values are shown as they are
const SORTED = new Set(["First-call speed", "Time lead arrived", "Day lead arrived"]);
const clean = (v: string, dim: string) => (SORTED.has(dim) ? v.replace(/^\d /, "") : v);

// AI Insights: top-level admins only (the page, the action and the database all check).
export default async function Insights({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { sb, profile } = await getStaff();
  if (profile.role !== "admin") redirect("/");
  const p = one(sp.p) ?? "all";
  const { from, to, label } = periodRange(p);
  const [{ data, error }, histRes, cfg] = await Promise.all([
    sb.rpc("insights_snapshot", { p_from: from, p_to: to }),
    sb.from("ai_queries").select("id,question,answer,error,model,period,created_at").order("created_at", { ascending: false }).limit(12),
    aiConfig(),
  ]);
  const hist = (histRes.data ?? []) as { id: string; question: string; answer: string | null; error: string | null; model: string | null; period: string | null; created_at: string }[];
  const shown = hist.find((h) => h.id === one(sp.a));
  let keyTest: { label: string; ok: boolean; detail: string }[] | null = null;
  try { const raw = one(sp.kt); if (raw) keyTest = JSON.parse(raw); } catch { keyTest = null; }
  if (error) return <><PageHeader crumbs={[{ label: "Admin", href: "/admin" }, { label: "AI Insights" }]} /><Page><Notice>{error.message}</Notice></Page></>;
  const s = data as Snapshot;
  const t = s.totals;

  return (
    <>
      <PageHeader crumbs={[{ label: "Admin", href: "/admin" }, { label: "AI Insights" }]}>
        <div className="flex flex-wrap gap-1.5">{PERIODS.map(([k, l]) => <Link key={k} href={`/admin/insights?p=${k}`} className="chip" aria-current={p === k ? "true" : undefined}>{l}</Link>)}</div>
      </PageHeader>
      <Page>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        <p className="text-[12.5px] text-mute">Patterns in Relive&apos;s own leads only ({label.toLowerCase()}, demo leads excluded). The AI sees counts and rates, never a customer&apos;s name, number, email or remarks; groups under 5 leads are merged. Admins only.</p>

        <section className="panel p-5">
          <h2 className="panel-title mb-3 flex items-center gap-2"><Emoji name="crystal" size={16} />Ask about your data</h2>
          {!cfg.provider && <Notice tone="warn">Add a Gemini key (or an OpenRouter key) under <Link className="underline" href="/admin/integrations">Integrations → Connections</Link> to ask questions. The patterns below work without it.</Notice>}
          <form action={askInsights} className="space-y-2">
            <input type="hidden" name="p" value={p} />
            <textarea name="question" rows={2} maxLength={1000} required className="input" placeholder="e.g. Which lead source gives the most site visits per 100 leads?" defaultValue={one(sp.q) ?? ""} aria-label="Question" />
            <div className="flex flex-wrap items-center gap-2">
              <PendingButton disabled={!cfg.provider} pending="Thinking… up to a minute">Ask</PendingButton>
              <span className="text-[12px] text-mute">{cfg.provider ? `${cfg.provider === "gemini" ? "Gemini" : "OpenRouter"} · ${cfg.model} · ${cfg.keyCount} key${cfg.keyCount > 1 ? "s" : ""} with automatic failover` : "No AI key yet"} · answers can take up to half a minute</span>
            </div>
          </form>
          {cfg.provider && (
            <form action={testAiKeys} className="mt-2"><input type="hidden" name="p" value={p} />
              <PendingButton className="btn-ghost h-8 text-[12.5px]" pending="Testing every key…">Test keys</PendingButton></form>
          )}
          {keyTest && (
            <div className="mt-2 rounded-lg bg-white/[.03] p-3 text-[12.5px]">
              <div className="eyebrow mb-1">Key test</div>
              <ul className="space-y-1">{keyTest.map((k) => <li key={k.label}><span className={k.ok ? "text-won" : "text-bad"}>{k.ok ? "Works" : "Fails"}</span> · {k.label}{!k.ok && <div className="text-mute">{k.detail}</div>}</li>)}</ul>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">{SUGGESTIONS.map((q) => <Link key={q} href={`/admin/insights?${new URLSearchParams({ p, q })}`} className="chip text-[12px]">{q}</Link>)}</div>
          {shown && (
            <div className="mt-4 rounded-xl border border-accent/30 bg-accent/[.06] p-4">
              <div className="text-[12px] text-mute">{shown.question}</div>
              <div className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">{shown.answer ?? shown.error}</div>
              <div className="mt-2 text-[11.5px] text-faint">{shown.model} · {shown.period} · check important numbers against the tables below</div>
              {shown.answer && shown.error && <details className="mt-1 text-[11.5px] text-warn"><summary className="cursor-pointer">Some keys failed before this answer. Press Test keys to see which.</summary><div className="mt-1 text-mute">{shown.error}</div></details>}
            </div>
          )}
          {hist.filter((h) => h.id !== shown?.id).length > 0 && (
            <details className="mt-3"><summary className="cursor-pointer text-[12.5px] text-mute">Earlier questions</summary>
              <ul className="mt-2 space-y-2">{hist.filter((h) => h.id !== shown?.id).map((h) => (
                <li key={h.id}><details className="rounded-lg bg-white/[.03] p-2.5"><summary className="cursor-pointer text-[12.5px]">{h.question} <span className="text-faint">· {dateTime(h.created_at)}</span></summary>
                  <div className={`mt-2 whitespace-pre-wrap text-[13px] ${h.answer ? "" : "text-bad"}`}>{h.answer ?? h.error}</div></details></li>
              ))}</ul>
            </details>
          )}
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[["Leads", t.n.toLocaleString("en-IN"), ""], ["Contacted", pct(t.contacted, t.n), `${t.contacted.toLocaleString("en-IN")} leads`],
            ["Site visit", pct(t.visited, t.n), `${t.visited} leads`], ["Booked", pct(t.booked, t.n), `${t.booked} leads`], ["Lost", pct(t.lost, t.n), `${t.lost.toLocaleString("en-IN")} leads`]].map(([k, v, n]) => (
            <div key={k} className="panel p-4"><div className="text-[12px] text-mute">{k}</div><div className="figure mt-2 text-[26px] leading-none">{v}</div><div className="mt-1 text-[11.5px] text-mute">{n}</div></div>
          ))}
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <Drivers title="Linked to more site visits" rows={s.drivers_up} up />
          <Drivers title="Linked to fewer site visits" rows={s.drivers_down} />
        </div>

        <Table title="First-call speed" rows={s.by["First-call speed"] ?? []} sort={false} />
        <div className="grid gap-4 xl:grid-cols-2">
          {TABLES.filter((k) => (s.by[k] ?? []).length > 0).map((k) => <Table key={k} title={k} rows={s.by[k]} sort={!SORTED.has(k)} />)}
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Month by month</h2></div>
            <table className="w-full text-[12.5px]"><thead><tr><th className="th">Month</th><th className="th text-right">Leads</th><th className="th text-right">Visit</th><th className="th text-right">Booked</th></tr></thead>
              <tbody>{s.monthly.slice(-14).map((m) => <tr key={m.month} className="row"><td className="td">{m.month}</td><td className="td text-right tabular-nums">{m.leads}</td><td className="td text-right tabular-nums">{m.visited}</td><td className="td text-right tabular-nums">{m.booked}</td></tr>)}</tbody></table>
          </section>
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Lost reasons</h2></div>
            <ul className="space-y-1.5 p-4 text-[12.5px]">{s.lost_reasons.map((r) => <li key={r.reason} className="flex justify-between gap-2"><span>{r.reason}</span><span className="tabular-nums text-mute">{r.leads}</span></li>)}</ul>
          </section>
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Words in remarks</h2><span className="text-[12px] text-mute">leads mentioning</span></div>
            <div className="grid grid-cols-2 gap-3 p-4 text-[12.5px]">
              <div><div className="eyebrow mb-1">Lost leads</div>{s.remark_words.in_lost_leads.slice(0, 15).map((w) => <div key={w.word} className="flex justify-between"><span>{w.word}</span><span className="tabular-nums text-mute">{w.leads}</span></div>)}</div>
              <div><div className="eyebrow mb-1">Visited leads</div>{s.remark_words.in_visited_leads.slice(0, 15).map((w) => <div key={w.word} className="flex justify-between"><span>{w.word}</span><span className="tabular-nums text-mute">{w.leads}</span></div>)}</div>
            </div>
          </section>
        </div>
      </Page>
    </>
  );
}

function Drivers({ title, rows, up }: { title: string; rows: Driver[]; up?: boolean }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2 className="panel-title">{title}</h2><span className="text-[12px] text-mute">groups of 20+ leads, clear at 95%</span></div>
      {rows.length === 0 ? <p className="px-4 py-3 text-mute">Nothing stands out clearly yet.</p> : (
        <table className="w-full text-[12.5px]"><thead><tr><th className="th">Factor</th><th className="th text-right">Leads</th><th className="th text-right">Visit rate</th><th className="th text-right">vs overall</th></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.dim + d.val} className="row"><td className="td"><span className="text-mute">{d.dim}:</span> {clean(d.val, d.dim)}</td><td className="td text-right tabular-nums">{d.n}</td>
              <td className="td text-right tabular-nums">{d.visit_pct}% <span className="text-faint">({d.low_pct}–{d.high_pct})</span></td>
              <td className={`td text-right tabular-nums font-semibold ${up ? "text-won" : "text-bad"}`}>{d.lift}×</td></tr>
          ))}</tbody></table>
      )}
    </section>
  );
}

function Table({ title, rows, sort = true }: { title: string; rows: Bucket[]; sort?: boolean }) {
  const list = sort && !SORTED.has(title) ? [...rows].sort((a, b) => b.leads - a.leads) : [...rows].sort((a, b) => a.value.localeCompare(b.value));
  return (
    <section className="panel overflow-x-auto">
      <div className="panel-head"><h2 className="panel-title">{title}</h2></div>
      <table className="w-full text-[12.5px]">
        <thead><tr><th className="th">{title}</th><th className="th text-right">Leads</th><th className="th text-right">Contacted</th><th className="th text-right">Site visit</th><th className="th text-right">Booked</th><th className="th text-right">Lost</th></tr></thead>
        <tbody>{list.slice(0, 15).map((r) => (
          <tr key={r.value} className="row"><td className="td">{clean(r.value, title)}</td><td className="td text-right tabular-nums">{r.leads}</td>
            <td className="td text-right tabular-nums">{pct(r.contacted, r.leads)}</td><td className="td text-right tabular-nums">{r.visit_pct ?? 0}%</td>
            <td className="td text-right tabular-nums">{r.booked}</td><td className="td text-right tabular-nums text-mute">{r.lost_pct ?? 0}%</td></tr>
        ))}</tbody>
      </table>
      {list.length > 15 && <p className="px-4 py-2 text-[11.5px] text-faint">{list.length - 15} more not shown; ask the AI about them.</p>}
    </section>
  );
}
