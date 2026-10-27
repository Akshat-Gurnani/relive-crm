import { getStaff } from "@/lib/session";
import { ago } from "@/lib/format";
import { Emoji, Empty, Page, PageHeader, type EmojiName } from "@/components/ui";
import { PushToggle } from "@/components/push-toggle";
import { markAllRead, saveAlertSettings } from "./actions";
import { EMAIL_KINDS } from "@/lib/alerts";

const ICON: Record<string, EmojiName> = { lead_assigned: "wave", lead_rotated: "recycle", followup_due: "clock", task_due: "bell", task_assigned: "check", reenquiry: "mailbox", lead_unassigned: "thinking", lead_new: "sparkles", lead_invalid: "zap", integration_failed: "zap" };
const DEFAULT_KINDS = ["lead_assigned", "lead_unassigned", "reenquiry", "lead_invalid"];

export default async function Notifications() {
  const { sb, profile } = await getStaff();
  const { data: setRow } = await sb.from("notification_settings").select("push_enabled,email_enabled,email_kinds,all_new_leads").eq("user_id", profile.id).maybeSingle();
  const st = (setRow as { push_enabled: boolean; email_enabled: boolean; email_kinds: string[]; all_new_leads: boolean } | null) ?? { push_enabled: true, email_enabled: true, email_kinds: DEFAULT_KINDS, all_new_leads: false };
  const lead = ["admin", "manager"].includes(profile.role);
  const { data } = await sb.from("notifications").select("id,kind,title,body,created_at,read_at").order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as { id: string; kind: string; title: string; body: string | null; created_at: string; read_at: string | null }[];
  const unread = rows.filter((r) => !r.read_at).length;
  return (
    <>
      <PageHeader crumbs={[{ label: "Notifications" }]}>
        {unread > 0 && <form action={markAllRead}><button className="btn-quiet" type="submit">Mark all read</button></form>}
      </PageHeader>
      <Page>
        <PushToggle vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
        <details className="panel group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3"><span className="panel-title flex items-center gap-2"><Emoji name="envelope" size={15} />Alert settings</span><span className="text-[12.5px] text-mute">{st.email_enabled ? `Email on for ${st.email_kinds.length} kinds` : "Email off"} · {st.push_enabled ? "push on" : "push off"} <span className="transition group-open:rotate-180">▾</span></span></summary>
          <form action={saveAlertSettings} className="grid gap-4 border-t border-line/10 p-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="flex items-center gap-2"><input type="checkbox" name="push_enabled" defaultChecked={st.push_enabled} /> Push alerts on this phone app and browser</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="email_enabled" defaultChecked={st.email_enabled} /> Email alerts</label>
              {lead && <label className="flex items-center gap-2"><input type="checkbox" name="all_new_leads" defaultChecked={st.all_new_leads} /> Tell me about every new lead in my {profile.role === "admin" ? "company" : "team"}</label>}
              <p className="text-[12px] text-mute">The bell here always shows everything. Push is the fastest; email is a backup for when you are away from the CRM.</p>
            </div>
            <fieldset className="space-y-1.5"><legend className="label">Send me an email when</legend>
              {EMAIL_KINDS.filter(([k]) => lead || !["lead_unassigned", "lead_new", "lead_invalid"].includes(k)).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={`k_${k}`} defaultChecked={st.email_kinds.includes(k)} /> {l}</label>
              ))}
            </fieldset>
            <div className="md:col-span-2"><button className="btn" type="submit">Save alert settings</button></div>
          </form>
        </details>
        <section className="panel">
          {rows.length === 0 ? <Empty emoji="bell">Nothing yet. New leads, follow-ups and tasks show up here.</Empty> : (
            <ul>{rows.map((n) => (
              <li key={n.id}>
                <a href={`/notifications/open/${n.id}`} className={`row flex items-start gap-3 px-4 py-3 ${n.read_at ? "opacity-60" : ""}`}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line/10 bg-white/[.05]"><Emoji name={ICON[n.kind] ?? "bell"} size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3"><span className="font-medium">{n.title}</span><span className="whitespace-nowrap text-[12px] text-mute">{ago(n.created_at)}</span></div>
                    {n.body && <div className="truncate text-[12.5px] text-mute">{n.body}</div>}
                  </div>
                  {!n.read_at && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent))]" />}
                </a>
              </li>
            ))}</ul>
          )}
        </section>
      </Page>
    </>
  );
}
