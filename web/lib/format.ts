const TZ = "Asia/Kolkata";

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}
export function dateOnly(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}
export function ago(iso: string | null | undefined) {
  if (!iso) return "–";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
export function minutes(m: number | null | undefined) {
  if (m == null) return "–";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} d`;
}
export function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}
export function money(n: number | null | undefined) {
  if (n == null) return "";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}
// The form's datetime-local value is the user's wall-clock time; the team works in India time.
export function fromLocalInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.length === 16 ? `${value}:00` : value;
  return `${v}+05:30`;
}
export function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
export function daysAgoIST(days: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() - days * 86400000));
}
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
