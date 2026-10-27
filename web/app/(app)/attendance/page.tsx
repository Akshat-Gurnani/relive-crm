import { getStaff, canLead } from "@/lib/session";
import { dateTime, one, todayIST } from "@/lib/format";
import { getRefs } from "@/lib/refs";
import { Avatar, Empty, Page, PageHeader } from "@/components/ui";
import { PunchButtons } from "@/components/punch";

type Row = { id: string; user_id: string; kind: "in" | "out"; at: string; lat: number | null; lng: number | null; accuracy_m: number | null; address: string | null; note: string | null; device: string | null };
const mapLink = (r: Row) => (r.lat != null && r.lng != null ? `https://www.google.com/maps?q=${r.lat},${r.lng}` : null);

export default async function Attendance({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { sb, profile, reports } = await getStaff();
  const refs = await getRefs();
  const day = one(sp.day) ?? todayIST();
  const manage = canLead(profile.role, reports);
  const [mine, team] = await Promise.all([
    sb.from("attendance").select("*").eq("user_id", profile.id).order("at", { ascending: false }).limit(20),
    manage ? sb.from("attendance").select("*").gte("at", `${day}T00:00:00+05:30`).lte("at", `${day}T23:59:59.999+05:30`).order("at", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
  ]);
  const my = (mine.data ?? []) as Row[];
  const rows = (team.data ?? []) as Row[];
  const last = my[0]?.kind ?? null;
  // first in and last out per person for the chosen day
  const per = new Map<string, { first?: Row; last?: Row; n: number }>();
  for (const r of [...rows].reverse()) {
    const p = per.get(r.user_id) ?? { n: 0 };
    if (r.kind === "in" && !p.first) p.first = r;
    if (r.kind === "out") p.last = r;
    p.n++; per.set(r.user_id, p);
  }
  return (
    <>
      <PageHeader crumbs={[{ label: "Attendance" }]} />
      <Page>
        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <section className="panel p-5">
            <div className="eyebrow">Today</div>
            <div className="display mt-1 text-[22px]">{last === "in" ? "You are checked in" : "You are checked out"}</div>
            {my[0] && <p className="mb-4 text-[12.5px] text-mute">Last {my[0].kind === "in" ? "check-in" : "check-out"} {dateTime(my[0].at)}</p>}
            <PunchButtons last={last} />
            <ul className="mt-5 space-y-1.5 text-[12.5px]">
              {my.slice(0, 8).map((r) => (
                <li key={r.id} className="flex justify-between gap-2"><span className={r.kind === "in" ? "text-won" : "text-mute"}>{r.kind === "in" ? "In" : "Out"}</span><span className="text-mute">{dateTime(r.at)}</span>{mapLink(r) ? <a href={mapLink(r)!} target="_blank" rel="noreferrer" className="text-accent-2 hover:underline">map</a> : <span className="text-faint">no location</span>}</li>
              ))}
            </ul>
          </section>
          {manage && (
            <section className="panel overflow-x-auto">
              <div className="panel-head">
                <h2 className="panel-title">Team on {day}</h2>
                <form method="get" className="flex gap-2"><input type="date" name="day" defaultValue={day} className="input h-8" aria-label="Day" /><button className="btn-quiet h-8" type="submit">Show</button></form>
              </div>
              {per.size === 0 ? <Empty emoji="calendar">No check-ins on this day.</Empty> : (
                <table className="w-full">
                  <thead><tr><th className="th">Person</th><th className="th">First in</th><th className="th">Last out</th><th className="th">Where</th><th className="th">Note</th></tr></thead>
                  <tbody>{[...per.entries()].map(([uid, p]) => {
                    const nm = refs.staffName.get(uid) ?? "Unknown";
                    const where = p.last ?? p.first;
                    return (
                      <tr key={uid} className="row">
                        <td className="td"><span className="flex items-center gap-2"><Avatar name={nm} size={22} />{nm}</span></td>
                        <td className="td whitespace-nowrap">{p.first ? dateTime(p.first.at) : "–"}</td>
                        <td className="td whitespace-nowrap">{p.last ? dateTime(p.last.at) : <span className="text-warn">still in</span>}</td>
                        <td className="td">{where && mapLink(where) ? <a href={mapLink(where)!} target="_blank" rel="noreferrer" className="text-accent-2 hover:underline">{where.address ?? "Open map"}</a> : <span className="text-faint">–</span>}</td>
                        <td className="td text-mute">{p.first?.note ?? p.last?.note ?? ""}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </section>
          )}
        </div>
      </Page>
    </>
  );
}
