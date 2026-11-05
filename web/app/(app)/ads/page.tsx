import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { dateTime, one, pct } from "@/lib/format";
import { Empty, Notice, Page, PageHeader } from "@/components/ui";
import { PendingButton } from "@/components/client";
import { refreshSpend } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Outcome = { crm_leads: number; contacted: number; visited: number; won: number };
type Totals = Outcome & { spend: number; impressions: number; clicks: number; meta_leads: number; currency: string | null; unattributed_spend: number };
type Account = Outcome & { account_id: string; name: string; spend: number; impressions: number; clicks: number; meta_leads: number; main_source: string | null };
type Campaign = Outcome & { campaign_id: string; name: string; account: string; spend: number; clicks: number; meta_leads: number };
type Ad = Outcome & { ad_id: string; name: string; adset_name: string | null; campaign_name: string | null; account: string; spend: number; clicks: number; meta_leads: number; lost: number };
type Dim = { name: string; leads: number; contacted: number; visited: number; won: number; spend: number | null };
type Report = { totals: Totals; accounts: Account[]; campaigns: Campaign[]; ads: Ad[]; by_source: Dim[]; by_project: Dim[]; by_owner: Dim[]; last_refresh: string | null; days_loaded: number };

const PERIODS: [string, string][] = [["7", "7 days"], ["14", "14 days"], ["30", "30 days"], ["90", "90 days"]];
const ist = (daysAgo: number) => new Date(Date.now() + 5.5 * 3600_000 - daysAgo * 86400_000).toISOString().slice(0, 10);
const inr = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "–" : `₹${Math.round(n).toLocaleString("en-IN")}`);
const per = (spend: number | null | undefined, n: number) => (n > 0 && spend ? inr(spend / n) : "–");

// How each ad account, campaign and ad performs, from Meta's spend to what the team did with the leads.
export default async function Ads({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { sb, profile } = await getStaff();
  if (!["admin", "marketing"].includes(profile.role)) redirect("/");
  const p = one(sp.p) ?? "30";
  const days = Number(p) || 30;
  const { data, error } = await sb.rpc("ads_report", { p_from: ist(days - 1), p_to: ist(0) });
  const r = data as Report | null;
  const t = r?.totals;
  const empty = !r || (r.accounts.length === 0 && (t?.spend ?? 0) === 0);

  return (
    <>
      <PageHeader crumbs={[{ label: "Meta ads" }]}>
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODS.map(([k, l]) => <Link key={k} href={`/ads?p=${k}`} className="chip" aria-current={p === k ? "true" : undefined}>{l}</Link>)}
          <form action={refreshSpend}><input type="hidden" name="p" value={p} /><input type="hidden" name="days" value={Math.max(30, days)} /><PendingButton className="btn-quiet h-8" pending="Reading Meta…">Refresh from Meta</PendingButton></form>
        </div>
      </PageHeader>
      <Page>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        {one(sp.notice) && <Notice tone="ok">{one(sp.notice)}</Notice>}
        {error && <Notice>{error.message}</Notice>}
        <p className="text-[12.5px] text-mute">Spend, clicks and Meta&apos;s lead count come from Meta (refreshed every 6 hours{r?.last_refresh ? `, last ${dateTime(r.last_refresh)}` : ""}). Contacted, visited and booked come from the CRM, matched by ad. An ad&apos;s spend is shared equally across the CRM leads it brought, so spend can be added up by lead source, project and person. Leads imported from Cratio carry no ad, so only leads that arrived through the direct Facebook connection count here.</p>

        {empty ? (
          <Empty emoji="gem">No ad spend loaded yet. Press &ldquo;Refresh from Meta&rdquo;. It needs the system user token with ads_read and the ad accounts assigned to it.</Empty>
        ) : t && <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Kpi label="Spend" v={inr(t.spend)} />
            <Kpi label="Meta leads" v={String(t.meta_leads)} sub={`${per(t.spend, t.meta_leads)} each`} />
            <Kpi label="Leads in CRM" v={String(t.crm_leads)} sub={`${per(t.spend, t.crm_leads)} each`} />
            <Kpi label="Contacted" v={pct(t.contacted, t.crm_leads)} sub={`${t.contacted} leads`} />
            <Kpi label="Site visits" v={String(t.visited)} sub={`${per(t.spend, t.visited)} per visit`} />
            <Kpi label="Booked" v={String(t.won)} sub={`${per(t.spend, t.won)} per booking`} />
            <Kpi label="Clicks" v={t.clicks.toLocaleString("en-IN")} sub={`${per(t.spend, t.clicks)} per click`} />
            <Kpi label="Spend with no CRM lead" v={inr(t.unattributed_spend)} sub={pct(t.unattributed_spend, t.spend)} warn={t.unattributed_spend > t.spend * 0.3} />
          </section>
          {t.meta_leads > 0 && t.crm_leads < t.meta_leads * 0.8 && (
            <Notice tone="warn">Meta counts {t.meta_leads} leads but only {t.crm_leads} reached the CRM with their ad. Leads still arriving through Cratio or Zapier lose the ad, so cost per visit and per booking look worse than they are until the direct Facebook connection carries every form.</Notice>
          )}

          <Table title="Ad accounts" note="the main lead source is the most common source among each account's CRM leads"
            head={["Account", "Main source", "Spend", "Meta leads", "CRM leads", "Contacted", "Visits", "Booked", "Per lead", "Per visit"]}
            rows={r!.accounts.map((a) => [a.name ?? a.account_id, a.main_source ?? "–", inr(a.spend), a.meta_leads, a.crm_leads, pct(a.contacted, a.crm_leads), a.visited, a.won || "–", per(a.spend, a.crm_leads || a.meta_leads), per(a.spend, a.visited)])} />

          <div className="grid gap-6 xl:grid-cols-2">
            <DimTable title="By lead source" rows={r!.by_source} />
            <DimTable title="By project" rows={r!.by_project} />
          </div>
          <DimTable title="By person" rows={r!.by_owner} note="who received the ad leads, and what they made of them" />

          <Table title="Campaigns" head={["Campaign", "Account", "Spend", "Meta leads", "CRM leads", "Contacted", "Visits", "Booked", "Per lead", "Per visit"]}
            rows={r!.campaigns.map((c) => [c.name ?? c.campaign_id, c.account, inr(c.spend), c.meta_leads, c.crm_leads, pct(c.contacted, c.crm_leads), c.visited, c.won || "–", per(c.spend, c.crm_leads || c.meta_leads), per(c.spend, c.visited)])} />

          <Table title="Ads" note="top 60 by spend · an ad with spend and no visits is the first place to cut"
            head={["Ad", "Ad set · campaign", "Spend", "Meta leads", "CRM leads", "Contacted", "Visits", "Booked", "Lost", "Per lead"]}
            rows={r!.ads.map((a) => [a.name ?? a.ad_id, [a.adset_name, a.campaign_name].filter(Boolean).join(" · "), inr(a.spend), a.meta_leads, a.crm_leads, pct(a.contacted, a.crm_leads), a.visited, a.won || "–", a.lost || "–", per(a.spend, a.crm_leads || a.meta_leads)])} />
        </>}
      </Page>
    </>
  );
}

function Kpi({ label, v, sub, warn }: { label: string; v: string; sub?: string; warn?: boolean }) {
  return <div className="panel px-4 py-3"><div className="text-[11.5px] text-mute">{label}</div><div className={`mt-1 text-[18px] font-semibold tabular-nums ${warn ? "text-warn" : ""}`}>{v}</div>{sub && <div className="text-[11.5px] text-faint">{sub}</div>}</div>;
}
function Table({ title, note, head, rows }: { title: string; note?: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <section className="panel overflow-x-auto">
      <div className="panel-head"><h2 className="panel-title">{title}</h2>{note && <span className="text-[12px] text-mute">{note}</span>}</div>
      {rows.length === 0 ? <Empty emoji="thinking">Nothing in this period.</Empty> : (
        <table className="w-full text-[13px]">
          <thead><tr>{head.map((h, i) => <th key={h} className={`th whitespace-nowrap ${i > 1 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((row, i) => <tr key={i} className="row">{row.map((c, j) => <td key={j} className={`td ${j > 1 ? "text-right tabular-nums" : ""} ${j === 0 ? "max-w-[22rem] truncate" : ""}`}>{c}</td>)}</tr>)}</tbody>
        </table>
      )}
    </section>
  );
}
function DimTable({ title, rows, note }: { title: string; rows: Dim[]; note?: string }) {
  return <Table title={title} note={note} head={["Name", "Spend share", "Leads", "Contacted", "Visits", "Booked", "Per lead", "Per visit", "Per booking"]}
    rows={rows.map((d) => [d.name, inr(d.spend), d.leads, pct(d.contacted, d.leads), d.visited, d.won || "–", per(d.spend, d.leads), per(d.spend, d.visited), per(d.spend, d.won)])} />;
}
