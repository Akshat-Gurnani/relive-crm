import Link from "next/link";
import { redirect } from "next/navigation";
import { canLead, canWorkLeads, getStaff } from "@/lib/session";
import { one, todayIST } from "@/lib/format";
import { getRefs } from "@/lib/refs";
import { Emoji, Empty, Notice, Page, PageHeader } from "@/components/ui";
import { TaskList } from "@/components/task-list";
import type { Task } from "@/lib/types";
import { addTask } from "../leads/[id]/actions";

type SP = Record<string, string | string[] | undefined>;

// The planner: everyone's open, overdue and finished tasks, like Cratio's Activities screen.
export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { sb, profile, reports } = await getStaff();
  if (!canWorkLeads(profile.role)) redirect("/");
  const refs = await getRefs();
  const manage = canLead(profile.role, reports);
  const status = one(sp.status) ?? "open";
  const owner = one(sp.owner) ?? (manage ? "" : profile.id);
  const when = one(sp.when) ?? "";

  let q = sb.from("tasks").select("*, lead:leads(id, person:people(full_name, phone_e164))").limit(300);
  if (owner) q = q.eq("assigned_to", owner === "me" ? profile.id : owner);
  const nowIso = new Date().toISOString();
  if (status === "open") q = q.eq("status", "open");
  if (status === "overdue") q = q.eq("status", "open").lt("due_at", nowIso);
  if (status === "done") q = q.eq("status", "done");
  const endToday = `${todayIST()}T23:59:59.999+05:30`;
  if (when === "today") q = q.lte("due_at", endToday);
  if (when === "week") q = q.lte("due_at", new Date(Date.now() + 7 * 86400000).toISOString());
  q = status === "done" ? q.order("completed_at", { ascending: false }) : q.order("due_at", { ascending: true, nullsFirst: false });
  const { data, error } = await q;
  const tasks = (data ?? []) as (Task & { lead: { id: string; person: { full_name: string | null; phone_e164: string } | null } | null })[];

  const counts = await Promise.all(["open", "overdue"].map(async (s) => {
    let c = sb.from("tasks").select("id", { count: "exact", head: true }).eq("status", "open");
    if (owner) c = c.eq("assigned_to", owner === "me" ? profile.id : owner);
    if (s === "overdue") c = c.lt("due_at", nowIso);
    return (await c).count ?? 0;
  }));
  const qs = (over: Record<string, string>) => { const p = new URLSearchParams({ status, owner, when, ...over }); [...p.keys()].forEach((k) => !p.get(k) && p.delete(k)); return `/tasks?${p}`; };
  const ret = qs({});

  return (
    <>
      <PageHeader crumbs={[{ label: "Tasks" }]}>
        <span className="text-[12.5px] text-mute"><span className="figure text-[15px] text-ink">{counts[0]}</span> open · <span className={counts[1] ? "text-bad" : ""}>{counts[1]} overdue</span></span>
      </PageHeader>
      <Page>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        <div className="flex flex-wrap items-center gap-1.5">
          {[["open", "Open", "check"], ["overdue", "Overdue", "clock"], ["done", "Done", "party"], ["all", "All", "sparkles"]].map(([k, l, e]) => (
            <Link key={k} href={qs({ status: k })} className="chip" aria-current={status === k ? "true" : undefined}><Emoji name={e as "check"} size={13} />{l}</Link>
          ))}
          <span className="mx-1 h-5 w-px bg-white/10" />
          {[["", "Any date"], ["today", "Due today"], ["week", "Next 7 days"]].map(([k, l]) => (
            <Link key={k} href={qs({ when: k })} className="chip" aria-current={when === k ? "true" : undefined}>{l}</Link>
          ))}
          {manage && (
            <form method="get" className="ml-auto flex items-center gap-2">
              <input type="hidden" name="status" value={status} /><input type="hidden" name="when" value={when} />
              <select name="owner" defaultValue={owner} className="input h-8 w-48" aria-label="Whose tasks">
                <option value="">Everyone I manage</option><option value="me">Mine</option>
                {refs.assignable.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
              <button className="btn-quiet h-8" type="submit">Show</button>
            </form>
          )}
        </div>

        <section className="panel">
          <form action={addTask} className="grid gap-2 p-4 md:grid-cols-[1fr_10rem_12rem_auto]">
            <input type="hidden" name="return" value={ret} />
            <input name="title" className="input" placeholder="New task, e.g. call back the Gupta family" aria-label="Task" required />
            <select name="category" className="input" aria-label="Category" defaultValue=""><option value="">Category</option>{(refs.picklists.task_category ?? []).map((c) => <option key={c}>{c}</option>)}</select>
            <input name="due_at" type="datetime-local" className="input" aria-label="Due" />
            {manage ? (
              <select name="assigned_to" className="input" aria-label="Assign to" defaultValue={profile.id}>
                <option value={profile.id}>Me</option>{refs.assignable.filter((s) => s.id !== profile.id).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            ) : <span />}
            <button className="btn md:col-start-4" type="submit">Add task</button>
          </form>
        </section>

        {error && <Notice>{error.message}</Notice>}
        <section className="panel">
          {tasks.length === 0 ? <Empty emoji="party">Nothing here. Tasks added on a lead or above show up in this list.</Empty>
            : <TaskList tasks={tasks} who={(u) => (u ? refs.staffName.get(u) ?? "someone" : "")} ret={ret} showLead />}
        </section>
      </Page>
    </>
  );
}
