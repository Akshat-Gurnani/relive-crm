const TZ = "Asia/Kolkata";
export function dateTime(iso?: string | null) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}
export function ago(iso?: string | null) {
  if (!iso) return "–";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 0) { const m = -mins; return m < 60 ? `in ${m}m` : m < 2880 ? `in ${Math.round(m / 60)}h` : `in ${Math.round(m / 1440)}d`; }
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 2880) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
export function mmss(sec: number) { return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; }
export function todayIST() { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()); }
// Follow-up presets in India time
export function preset(kind: "1h" | "eve" | "tom" | "3d" | "week"): string {
  const now = new Date();
  const ist = (d: Date, h: number, m = 0) => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
    return new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`).toISOString();
  };
  const plus = (days: number) => new Date(now.getTime() + days * 86400000);
  if (kind === "1h") return new Date(now.getTime() + 3600000).toISOString();
  if (kind === "eve") return ist(now, 18);
  if (kind === "tom") return ist(plus(1), 11);
  if (kind === "3d") return ist(plus(3), 11);
  return ist(plus(7), 11);
}
export const PRESETS: [Parameters<typeof preset>[0], string][] = [["1h", "In 1 hour"], ["eve", "This evening"], ["tom", "Tomorrow 11 am"], ["3d", "In 3 days"], ["week", "Next week"]];
export function waLink(phone: string, text?: string) {
  return `https://wa.me/${phone.replace("+", "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
export function fillTemplate(body: string, v: Record<string, string | null | undefined>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (v[k] ?? "").toString());
}
