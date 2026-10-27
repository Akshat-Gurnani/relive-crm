import Link from "next/link";
import { ago, dateTime } from "@/lib/format";
import type { Task } from "@/lib/types";
import { setTaskStatus } from "@/app/(app)/leads/[id]/actions";

export function TaskList({ tasks, who, ret, showLead }: { tasks: (Task & { lead?: { id: string; person: { full_name: string | null; phone_e164: string } | null } | null })[]; who: (u: string | null) => string; ret: string; showLead?: boolean }) {
  const now = Date.now();
  return (
    <ul>{tasks.map((t) => {
      const late = t.status === "open" && t.due_at && +new Date(t.due_at) < now;
      return (
        <li key={t.id} className="row flex items-start gap-3 px-4 py-3">
          <form action={setTaskStatus} className="pt-0.5">
            <input type="hidden" name="task_id" value={t.id} /><input type="hidden" name="return" value={ret} />
            <input type="hidden" name="status" value={t.status === "done" ? "open" : "done"} />
            <button type="submit" aria-label={t.status === "done" ? "Reopen task" : "Mark task done"} className={`grid h-5 w-5 place-items-center rounded-md border transition ${t.status === "done" ? "border-won bg-won/20 text-won" : "border-line/30 hover:border-accent"}`}>{t.status === "done" ? "✓" : ""}</button>
          </form>
          <div className={`h-9 w-1 shrink-0 rounded-full ${t.status === "done" ? "bg-won/40" : late ? "bg-bad" : "bg-accent/60"}`} />
          <div className="min-w-0 flex-1">
            <div className={`font-medium ${t.status === "done" ? "text-mute line-through" : ""}`}>{t.title}</div>
            <div className="flex flex-wrap gap-x-2 text-[12px] text-mute">
              {t.due_at && <span className={late ? "text-bad" : ""}>Due {dateTime(t.due_at)}{late ? ` · overdue by ${ago(t.due_at).replace(" ago", "")}` : ""}</span>}
              {t.category && <span>· {t.category}</span>}
              <span>· {who(t.assigned_to)}</span>
              {showLead && t.lead?.person && <Link href={`/leads/${t.lead.id}?tab=tasks`} className="text-accent-2 hover:underline">· {t.lead.person.full_name ?? t.lead.person.phone_e164}</Link>}
            </div>
          </div>
        </li>
      );
    })}</ul>
  );
}

