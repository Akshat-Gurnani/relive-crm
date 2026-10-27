import { Suspense } from "react";
import { getStaff, canManage, canWorkLeads } from "@/lib/session";
import { Sidebar } from "@/components/sidebar";
import type { EmojiName } from "@/components/ui";

type Nav = { href: string; label: string; emoji: EmojiName; show: boolean; mobile?: boolean };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { sb, profile } = await getStaff();
  const work = canWorkLeads(profile.role);
  const { count } = await sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  const items = ([
    { href: "/", label: "Dashboard", emoji: "compass", show: true, mobile: true },
    { href: "/followups", label: "Follow-ups", emoji: "bell", show: work, mobile: true },
    { href: "/leads", label: "Leads", emoji: "house", show: work, mobile: true },
    { href: "/tasks", label: "Tasks", emoji: "check", show: work, mobile: true },
    { href: "/calls", label: "Calls", emoji: "call", show: work },
    { href: "/attendance", label: "Attendance", emoji: "pin", show: true, mobile: !work },
    { href: "/admin/insights", label: "AI Insights", emoji: "crystal", show: profile.role === "admin" },
    { href: "/admin", label: "Admin", emoji: "glasses", show: canManage(profile.role) },
  ] as Nav[]).filter((l) => l.show).map(({ show: _s, ...l }) => l);
  const views: { href: string; label: string; emoji: EmojiName }[] = work
    ? [
        { href: "/leads?view=mine", label: "My leads", emoji: "wave" },
        { href: "/leads?view=uncontacted", label: "Never contacted", emoji: "zap" },
        { href: "/leads?view=overdue", label: "Overdue", emoji: "clock" },
        { href: "/leads?view=reenquiry", label: "Re-enquired", emoji: "recycle" },
        ...(canManage(profile.role) ? [{ href: "/leads?view=unassigned", label: "Unassigned", emoji: "thinking" as EmojiName }] : []),
      ]
    : [];
  return (
    <div className="min-h-screen pb-20 md:flex md:pb-0">
      <Suspense><Sidebar name={profile.full_name} role={profile.role} items={items} views={views} unread={count ?? 0} /></Suspense>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
