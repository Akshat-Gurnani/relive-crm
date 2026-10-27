import Link from "next/link";
import { redirect } from "next/navigation";
import { canManage, getStaff } from "@/lib/session";
import { dateOnly, one } from "@/lib/format";
import type { Named, Role, Template } from "@/lib/types";
import { Avatar, Emoji, Notice, Page, PageHeader } from "@/components/ui";
import { BulkStaff } from "./bulk-staff";
import { addListValue, addUser, deleteTemplate, linkImportOwner, saveRotation, saveTemplate, setStaffFlag, toggleListValue, updateStaff } from "./actions";

type StaffRow = { id: string; full_name: string; phone: string | null; role: Role; team_id: string | null; manager_id: string | null; active: boolean; accepting_leads: boolean; last_assigned_at: string | null };
const ROLES: Role[] = ["admin", "manager", "agent", "marketing", "viewer"];
const LISTS: [string, string][] = [["priority", "Priority"], ["budget", "Budget"], ["unit_size", "Size"], ["possession", "Possession"], ["location", "Location"], ["lead_type", "Lead type"], ["task_category", "Task category"], ["call_outcome", "Call outcome"], ["property_type", "Property type"], ["bhk", "BHK"], ["lead_tag", "Lead tags"], ["interest", "Interest"]];

export default async function Admin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { sb, profile } = await getStaff();
  if (!canManage(profile.role)) redirect("/");
  const isAdmin = profile.role === "admin";
  const tab = one(sp.tab) ?? "staff";

  const [staffRes, teamsRes, ownersRes, settingsRes, picksRes, projRes, srcRes, reasonsRes, tplRes] = await Promise.all([
    sb.from("profiles").select("id,full_name,phone,role,team_id,manager_id,active,accepting_leads,last_assigned_at").order("full_name"),
    sb.from("teams").select("id,name").order("name"),
    isAdmin && tab === "imported" ? sb.rpc("import_owners") : Promise.resolve({ data: [] }),
    sb.from("app_settings").select("key,value"),
    sb.from("picklist_values").select("id,list,value,active,position").order("position"),
    sb.from("projects").select("id,name,city,active").order("name"),
    sb.from("sources").select("id,name,active").order("name"),
    sb.from("lost_reasons").select("id,name,active").order("name"),
    sb.from("message_templates").select("id,channel,name,subject,body,active").order("channel").order("name"),
  ]);
  const staff = (staffRes.data ?? []) as StaffRow[];
  const teams = (teamsRes.data ?? []) as Named[];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const owners = (ownersRes.data ?? []) as { cratio_name: string; leads: number; waiting: number; linked_to: string | null }[];
  const settings = Object.fromEntries(((settingsRes.data ?? []) as { key: string; value: Record<string, unknown> }[]).map((s) => [s.key, s.value]));
  const rot = (settings.rotation ?? {}) as Record<string, string | number | boolean>;
  const rem = (settings.reminders ?? {}) as Record<string, number>;
  const picks = (picksRes.data ?? []) as { id: string; list: string; value: string; active: boolean }[];
  const templates = (tplRes.data ?? []) as Template[];
  // "Reports to" can be any active admin, team leader or agent: an agent with people under them becomes a sub-lead.
  const managers = staff.filter((s) => s.active && ["admin", "manager", "agent"].includes(s.role));
  const tabs: [string, string][] = [["staff", "Staff"], ["rules", "Lead rules"], ["lists", "Lists"], ["templates", "Templates"], ...(isAdmin ? [["imported", "Imported owners"] as [string, string]] : [])];

  return (
    <>
      <PageHeader crumbs={[{ label: "Admin" }]}>
        <span className="text-[12.5px] text-mute"><span className="figure text-[15px] text-ink">{staff.filter((s) => s.role === "agent" && s.active && s.accepting_leads).length}</span> agents taking leads</span>
      </PageHeader>
      <Page>
        <div className="flex flex-wrap gap-1.5">{tabs.map(([k, l]) => <Link key={k} href={`/admin?tab=${k}`} className="chip" aria-current={tab === k ? "true" : undefined}>{l}</Link>)}{isAdmin && <Link href="/admin/routing" className="chip">Lead routing →</Link>}{isAdmin && <Link href="/admin/integrations" className="chip">Integrations →</Link>}</div>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        {one(sp.notice) && <Notice tone="ok">{one(sp.notice)}</Notice>}

        {tab === "staff" && <>
          <section className="panel overflow-x-auto">
            <div className="panel-head"><h2 className="panel-title flex items-center gap-2"><Emoji name="handshake" size={15} />Staff</h2><span className="text-[12px] text-mute">{isAdmin ? "Change a row and press Save" : "Only admins can change staff"}</span></div>
            <p className="border-b border-line/10 px-4 py-2.5 text-[12.5px] text-mute">New leads go round robin to active agents who are accepting leads, within each form&apos;s team. Untouched leads move on as set under Lead rules.</p>
            <table className="w-full">
              <thead><tr><th className="th">Name</th><th className="th">Role</th><th className="th">Team</th><th className="th">Reports to</th><th className="th">Phone</th><th className="th">Active</th><th className="th">Takes leads</th><th className="th text-right">Last lead</th><th className="th" /></tr></thead>
              <tbody>{staff.map((s) => (
                <tr key={s.id} className="row">
                  <td className="td"><span className="flex items-center gap-2.5 font-medium"><Avatar name={s.full_name} size={26} />{s.full_name}</span></td>
                  {isAdmin ? <>
                    <td className="td"><select form={`st-${s.id}`} name="role" defaultValue={s.role} className="input h-8 w-28 capitalize" aria-label="Role">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></td>
                    <td className="td"><select form={`st-${s.id}`} name="team_id" defaultValue={s.team_id ?? ""} className="input h-8 w-36" aria-label="Team"><option value="">–</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
                    <td className="td"><select form={`st-${s.id}`} name="manager_id" defaultValue={s.manager_id ?? ""} className="input h-8 w-36" aria-label="Reports to"><option value="">–</option>{managers.filter((m) => m.id !== s.id).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></td>
                    <td className="td"><input form={`st-${s.id}`} name="phone" defaultValue={s.phone ?? ""} className="input h-8 w-32" aria-label="Phone" /></td>
                  </> : <>
                    <td className="td capitalize text-mute">{s.role}</td><td className="td">{s.team_id ? teamName.get(s.team_id) : "–"}</td><td className="td">{staff.find((m) => m.id === s.manager_id)?.full_name ?? "–"}</td><td className="td">{s.phone ?? "–"}</td>
                  </>}
                  <td className="td"><Flag disabled={!isAdmin} id={s.id} field="active" on={s.active} /></td>
                  <td className="td">{s.role === "agent" ? <Flag disabled={!isAdmin} id={s.id} field="accepting_leads" on={s.accepting_leads} /> : <span className="text-faint">–</span>}</td>
                  <td className="td text-right text-mute">{dateOnly(s.last_assigned_at)}</td>
                  <td className="td">{isAdmin && <form id={`st-${s.id}`} action={updateStaff}><input type="hidden" name="id" value={s.id} /><button className="btn-quiet h-8" type="submit">Save</button></form>}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
          {isAdmin && <BulkStaff />}
          {isAdmin && (
            <section className="panel p-5">
              <h2 className="panel-title mb-3">Add a person</h2>
              <form action={addUser} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
                <input name="full_name" className="input lg:col-span-2" placeholder="Full name" aria-label="Full name" required />
                <input name="email" type="email" className="input lg:col-span-2" placeholder="Work email" aria-label="Email" required />
                <input name="password" className="input" placeholder="Starting password" aria-label="Starting password" required minLength={8} />
                <input name="phone" className="input" placeholder="Mobile" aria-label="Mobile" />
                <select name="role" className="input capitalize" defaultValue="agent" aria-label="Role">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
                <select name="team_id" className="input lg:col-span-2" defaultValue="" aria-label="Team"><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                <button className="btn" type="submit">Add person</button>
              </form>
              <p className="mt-2 text-[12px] text-mute">Share the starting password privately. The phone number is used in message templates as {"{{agent_phone}}"}.</p>
            </section>
          )}
        </>}

        {tab === "rules" && (
          <form action={saveRotation} className="grid gap-4 lg:grid-cols-2">
            <section className="panel p-5">
              <h2 className="panel-title mb-1 flex items-center gap-2"><Emoji name="recycle" size={15} />Untouched lead rotation</h2>
              <p className="mb-4 text-[12.5px] text-mute">If the agent does nothing with a new lead (no call, note, task or stage change), it moves to the next agent in the team. Cratio did this every 30 minutes.</p>
              <label className="mb-3 flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={!!rot.enabled} className="h-4 w-4 accent-[rgb(var(--accent))]" disabled={!isAdmin} />Rotation is on</label>
              <div className="grid grid-cols-2 gap-3">
                <Num name="minutes" label="Move after (minutes)" v={rot.minutes} dis={!isAdmin} />
                <Num name="max_rotations" label="Stop after this many moves" v={rot.max_rotations} dis={!isAdmin} />
                <Num name="only_new_within_hours" label="Only leads newer than (hours)" v={rot.only_new_within_hours} dis={!isAdmin} />
                <div />
                <div><label className="label" htmlFor="work_start">Working hours from</label><input id="work_start" name="work_start" type="time" defaultValue={String(rot.work_start ?? "09:00")} className="input" disabled={!isAdmin} /></div>
                <div><label className="label" htmlFor="work_end">to</label><input id="work_end" name="work_end" type="time" defaultValue={String(rot.work_end ?? "21:00")} className="input" disabled={!isAdmin} /></div>
              </div>
            </section>
            <section className="panel p-5">
              <h2 className="panel-title mb-1 flex items-center gap-2"><Emoji name="bell" size={15} />Reminders</h2>
              <p className="mb-4 text-[12.5px] text-mute">Sent to the phone and the bell in the CRM.</p>
              <div className="grid grid-cols-2 gap-3">
                <Num name="followup_minutes" label="Follow-up reminder (minutes before)" v={rem.followup_minutes} dis={!isAdmin} />
                <Num name="task_minutes" label="Task reminder (minutes before)" v={rem.task_minutes} dis={!isAdmin} />
              </div>
              {isAdmin && <button className="btn mt-5" type="submit">Save rules</button>}
            </section>
          </form>
        )}

        {tab === "imported" && isAdmin && (
          <section className="panel overflow-x-auto">
            <div className="panel-head"><h2 className="panel-title flex items-center gap-2"><Emoji name="handshake" size={15} />Owners of imported leads</h2><span className="text-[12px] text-mute">From the Cratio import</span></div>
            <p className="border-b border-line/10 px-4 py-2.5 text-[12.5px] text-mute">Imported leads keep their Cratio owner&apos;s name until that person has a login here. Add them under Staff with the same name and their leads, calls and history move to them automatically, or pick the person below. Nobody is alerted for these.</p>
            <table className="w-full text-[13px]">
              <thead className="text-left text-[11.5px] text-mute"><tr><th className="px-4 py-2 font-medium">Name in Cratio</th><th className="px-3 py-2 font-medium">Leads</th><th className="px-3 py-2 font-medium">Waiting for a login</th><th className="px-3 py-2 font-medium">Linked to</th></tr></thead>
              <tbody>{owners.map((o) => (
                <tr key={o.cratio_name} className="border-t border-line/10">
                  <td className="px-4 py-2">{o.cratio_name}</td>
                  <td className="figure px-3 py-2">{o.leads}</td>
                  <td className={`figure px-3 py-2 ${o.waiting > 0 ? "text-warn" : "text-mute"}`}>{o.waiting}</td>
                  <td className="px-3 py-2">
                    {o.waiting === 0 ? (staff.find((s) => s.id === o.linked_to)?.full_name ?? "Linked") : (
                      <form action={linkImportOwner} className="flex gap-2">
                        <input type="hidden" name="name" value={o.cratio_name} />
                        <select name="profile_id" className="input h-8 w-auto" aria-label={`Staff for ${o.cratio_name}`} required defaultValue="">
                          <option value="" disabled>Pick staff…</option>{staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                        </select>
                        <button className="btn-quiet h-8" type="submit">Link</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}{owners.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-mute">No imported leads.</td></tr>}</tbody>
            </table>
          </section>
        )}

        {tab === "lists" && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ListCard title="Projects" kind="projects" table="projects" items={((projRes.data ?? []) as { id: string; name: string; active: boolean; city: string | null }[]).map((p) => ({ id: p.id, value: p.name + (p.city ? ` · ${p.city}` : ""), active: p.active }))} isAdmin={isAdmin} withCity />
            <ListCard title="Sources" kind="sources" table="sources" items={((srcRes.data ?? []) as { id: string; name: string; active: boolean }[]).map((p) => ({ id: p.id, value: p.name, active: p.active }))} isAdmin={isAdmin} />
            <ListCard title="Lost reasons" kind="lost_reasons" table="lost_reasons" items={((reasonsRes.data ?? []) as { id: string; name: string; active: boolean }[]).map((p) => ({ id: p.id, value: p.name, active: p.active }))} isAdmin={isAdmin} />
            {LISTS.map(([k, l]) => <ListCard key={k} title={l} kind={k} table="picklist_values" items={picks.filter((p) => p.list === k)} isAdmin={isAdmin} />)}
          </div>
        )}

        {tab === "templates" && (
          <div className="grid gap-4 lg:grid-cols-2">
            {templates.map((t) => <TemplateForm key={t.id} t={t} />)}
            <TemplateForm />
            <p className="text-[12.5px] text-mute lg:col-span-2">Placeholders: {"{{name}}"} (first name), {"{{project}}"}, {"{{agent}}"}, {"{{agent_phone}}"}. WhatsApp templates open WhatsApp with the message filled in; email templates open the mail app.</p>
          </div>
        )}

      </Page>
    </>
  );
}

function Num({ name, label, v, dis }: { name: string; label: string; v: unknown; dis: boolean }) {
  return <div><label className="label" htmlFor={name}>{label}</label><input id={name} name={name} type="number" min={1} defaultValue={String(v ?? "")} className="input" disabled={dis} /></div>;
}

function ListCard({ title, kind, table, items, isAdmin, withCity }: { title: string; kind: string; table: string; items: { id: string; value: string; active: boolean }[]; isAdmin: boolean; withCity?: boolean }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2 className="panel-title">{title}</h2><span className="text-[12px] text-mute">{items.filter((i) => i.active).length} in use</span></div>
      <ul className="max-h-72 overflow-auto">{items.map((i) => (
        <li key={i.id} className="row flex items-center justify-between gap-2 px-4 py-2">
          <span className={i.active ? "" : "text-faint line-through"}>{i.value}</span>
          {isAdmin && <form action={toggleListValue}><input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="value" value={String(!i.active)} /><button className="btn-ghost h-7 text-[12px]" type="submit">{i.active ? "Hide" : "Use again"}</button></form>}
        </li>
      ))}</ul>
      {isAdmin && (
        <form action={addListValue} className="flex gap-2 border-t border-line/10 p-3">
          <input type="hidden" name="kind" value={kind} />
          <input name="value" className="input h-8" placeholder={`New ${title.toLowerCase().replace(/s$/, "")}`} aria-label={`New ${title}`} />
          {withCity && <input name="city" className="input h-8 w-28" placeholder="City" aria-label="City" />}
          <button className="btn-quiet h-8" type="submit">Add</button>
        </form>
      )}
    </section>
  );
}

function TemplateForm({ t }: { t?: Template }) {
  return (
    <form action={saveTemplate} className="panel space-y-2 p-4">
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="flex gap-2">
        <select name="channel" defaultValue={t?.channel ?? "whatsapp"} className="input w-32" aria-label="Channel"><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="sms">SMS</option></select>
        <input name="name" defaultValue={t?.name ?? ""} className="input" placeholder={t ? "Name" : "New template name"} aria-label="Template name" />
      </div>
      <input name="subject" defaultValue={t?.subject ?? ""} className="input" placeholder="Email subject (email only)" aria-label="Subject" />
      <textarea name="body" defaultValue={t?.body ?? ""} rows={4} className="input" placeholder="Hello {{name}}, …" aria-label="Message" />
      <div className="flex gap-2">
        <button className="btn-quiet" type="submit">{t ? "Save" : "Add template"}</button>
        {t && <button formAction={deleteTemplate} className="btn-ghost text-bad">Delete</button>}
      </div>
    </form>
  );
}

function Flag({ id, field, on, disabled }: { id: string; field: string; on: boolean; disabled: boolean }) {
  const look = (
    <span className={`relative inline-block h-[18px] w-8 rounded-full transition ${on ? "bg-accent shadow-[0_0_10px_rgb(var(--accent)/.6)]" : "bg-white/15"}`}>
      <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all ${on ? "left-[16px]" : "left-[2px]"}`} />
    </span>
  );
  if (disabled) return <span className="inline-flex items-center gap-2 text-[12.5px] text-mute">{look}{on ? "Yes" : "No"}</span>;
  return (
    <form action={setStaffFlag}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="field" value={field} /><input type="hidden" name="value" value={String(!on)} />
      <button type="submit" className="inline-flex items-center gap-2 text-[12.5px] text-mute hover:text-ink" aria-pressed={on}>{look}{on ? "Yes" : "No"}</button>
    </form>
  );
}
