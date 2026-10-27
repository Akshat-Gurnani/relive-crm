// Periods for AI Insights. Dates are India time (yyyy-mm-dd); null means "from the start" / "until today".
export const PERIODS: [string, string][] = [["all", "All time"], ["365", "Last 12 months"], ["90", "Last 90 days"], ["30", "Last 30 days"]];

export function periodRange(p: string): { from: string | null; to: string | null; label: string } {
  const label = PERIODS.find(([k]) => k === p)?.[1] ?? "All time";
  const days = Number(p);
  if (!Number.isFinite(days) || days <= 0) return { from: null, to: null, label };
  const ist = new Date(Date.now() + 5.5 * 3600_000 - days * 86400_000);
  return { from: ist.toISOString().slice(0, 10), to: null, label };
}

export type Bucket = { value: string; leads: number; contacted: number; visited: number; booked: number; lost: number;
  calls: number; connected_calls: number; visit_pct: number | null; booked_pct: number | null; lost_pct: number | null };
export type Driver = { dim: string; val: string; n: number; visited: number; visit_pct: number; overall_pct: number; lift: number; low_pct: number; high_pct: number };
export type Snapshot = {
  totals: { n: number; contacted: number; visited: number; booked: number; lost: number; calls: number; connected: number };
  by: Record<string, Bucket[]>;
  drivers_up: Driver[]; drivers_down: Driver[];
  monthly: { month: string; leads: number; contacted: number; visited: number; booked: number; lost: number }[];
  lost_reasons: { reason: string; leads: number }[];
  pipeline_now: { stage: string; leads: number }[];
  remark_words: { in_lost_leads: { word: string; leads: number }[]; in_visited_leads: { word: string; leads: number }[] };
};
