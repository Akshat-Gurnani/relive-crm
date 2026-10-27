import type { ReactNode } from "react";
import type { getRefs } from "@/lib/refs";
import type { LeadDetail, Person } from "@/lib/types";

type Refs = Awaited<ReturnType<typeof getRefs>>;
const isoLocal = (v: string | null | undefined) => {
  if (!v) return "";
  const d = new Date(new Date(v).getTime() + 5.5 * 3600000);
  return d.toISOString().slice(0, 16);
};

// The full lead form, shared by "Add lead" and "Edit lead".
export function LeadFields({ refs, mode, lead, person, manage }: { refs: Refs; mode: "new" | "edit"; lead?: Partial<LeadDetail>; person?: Partial<Person>; manage: boolean }) {
  const pick = (list: string, name: string, label: string, value?: string | null) => (
    <Field label={label} id={name}>
      <select id={name} name={name} defaultValue={value ?? ""} className="input">
        <option value="">–</option>
        {(refs.picklists[list] ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
        {value && !(refs.picklists[list] ?? []).includes(value) && <option value={value}>{value}</option>}
      </select>
    </Field>
  );
  return (
    <div className="space-y-5">
      <Group title="Contact">
        <Field label="Mobile number *" id="phone"><input id="phone" name="phone" required inputMode="tel" defaultValue={person?.phone_e164 ?? ""} className="input" placeholder="98765 43210" readOnly={mode === "edit"} /></Field>
        <Field label="Customer name" id="full_name"><input id="full_name" name="full_name" defaultValue={person?.full_name ?? ""} className="input" /></Field>
        <Field label="Email" id="email"><input id="email" name="email" type="email" defaultValue={person?.email ?? ""} className="input" /></Field>
        <Field label="Alternate contact" id="alt_phone"><input id="alt_phone" name="alt_phone" inputMode="tel" defaultValue={person?.alt_phone ?? ""} className="input" /></Field>
        <Field label="City" id="city"><input id="city" name="city" defaultValue={person?.city ?? ""} className="input" /></Field>
        <Field label="Company" id="company"><input id="company" name="company" defaultValue={person?.company ?? ""} className="input" /></Field>
        <Field label="Designation" id="designation"><input id="designation" name="designation" defaultValue={person?.designation ?? ""} className="input" /></Field>
        {mode === "edit" && <>
          <Field label="Street" id="street"><input id="street" name="street" defaultValue={person?.street ?? ""} className="input" /></Field>
          <Field label="State" id="state"><input id="state" name="state" defaultValue={person?.state ?? ""} className="input" /></Field>
          <Field label="Pincode" id="pincode"><input id="pincode" name="pincode" inputMode="numeric" defaultValue={person?.pincode ?? ""} className="input" /></Field>
          <Field label="Birthday" id="birthday"><input id="birthday" name="birthday" type="date" defaultValue={person?.birthday ?? ""} className="input" /></Field>
          <Field label="Anniversary" id="anniversary"><input id="anniversary" name="anniversary" type="date" defaultValue={person?.anniversary ?? ""} className="input" /></Field>
          <Field label="Spouse birthday" id="spouse_birthday"><input id="spouse_birthday" name="spouse_birthday" type="date" defaultValue={person?.spouse_birthday ?? ""} className="input" /></Field>
        </>}
      </Group>

      <Group title="Interest">
        <Field label="Project" id="project_id">
          <select id="project_id" name="project_id" defaultValue={lead?.project_id ?? ""} className="input">
            <option value="">No project yet</option>{refs.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Lead source" id="source_id">
          <select id="source_id" name="source_id" defaultValue={lead?.source_id ?? ""} className="input">
            <option value="">–</option>{refs.sources.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        {mode === "new" && (
          <Field label="Stage" id="stage_id">
            <select id="stage_id" name="stage_id" defaultValue="" className="input">
              <option value="">New (default)</option>{refs.stages.filter((s) => s.kind === "open").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        {pick("priority", "priority", "Priority", lead?.priority ?? "Medium")}
        <Field label="Temperature" id="temperature">
          <select id="temperature" name="temperature" defaultValue={lead?.temperature ?? "warm"} className="input">
            <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
          </select>
        </Field>
        {pick("lead_type", "lead_type", "Lead type", lead?.lead_type)}
        {pick("budget", "budget_band", "Budget", lead?.budget_band)}
        <Field label="Budget min (₹)" id="budget_min"><input id="budget_min" name="budget_min" inputMode="numeric" defaultValue={lead?.budget_min ?? ""} className="input" /></Field>
        <Field label="Budget max (₹)" id="budget_max"><input id="budget_max" name="budget_max" inputMode="numeric" defaultValue={lead?.budget_max ?? ""} className="input" /></Field>
        {pick("unit_size", "unit_size", "Size", lead?.unit_size)}
        {pick("possession", "possession_pref", "Possession", lead?.possession_pref)}
        {pick("location", "location_pref", "Location", lead?.location_pref)}
        {mode === "edit" && <>
          {pick("property_type", "property_type", "Property type", lead?.property_type)}
          {pick("bhk", "bhk", "BHK", lead?.bhk)}
          <Field label="Qualification" id="qualification">
            <select id="qualification" name="qualification" defaultValue={lead?.qualification ?? ""} className="input">
              <option value="">Not checked yet</option><option>Qualified</option><option>Non-qualified</option><option>Diverted</option>
            </select>
          </Field>
          <Field label="Also interested in (comma separated)" id="interests"><input id="interests" name="interests" defaultValue={(lead?.interests ?? []).join(", ")} className="input" placeholder="Residential, Joy Street" /></Field>
          <Field label="Tags (comma separated)" id="tags"><input id="tags" name="tags" defaultValue={(lead?.tags ?? []).join(", ")} className="input" placeholder="HNI, Associate" /></Field>
        </>}
      </Group>

      {mode === "new" && (
        <Group title="Next step">
          <Field label="Next follow-up" id="next_followup_at"><input id="next_followup_at" name="next_followup_at" type="datetime-local" defaultValue={isoLocal(lead?.next_followup_at)} className="input" /></Field>
          <Field label="Follow-up note" id="next_followup_note"><input id="next_followup_note" name="next_followup_note" defaultValue={lead?.next_followup_note ?? ""} className="input" /></Field>
          {manage && <>
            <Field label="Assign to" id="assigned_to">
              <select id="assigned_to" name="assigned_to" defaultValue="" className="input">
                <option value="">Me</option>{refs.assignable.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </Field>
            <Field label="Or round robin in team" id="team_id">
              <div className="flex gap-2">
                <select id="team_id" name="team_id" defaultValue="" className="input"><option value="">My team</option>{refs.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                <label className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-mute"><input type="checkbox" name="round_robin" className="h-4 w-4 accent-[rgb(var(--accent))]" />Use</label>
              </div>
            </Field>
          </>}
        </Group>
      )}

      <Group title="Description">
        <div className="sm:col-span-2 lg:col-span-3"><textarea id="description" name="description" aria-label="Description" rows={3} defaultValue={lead?.description ?? ""} className="input" placeholder="Anything the next person should know" /></div>
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel p-5">
      <h2 className="eyebrow mb-3">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}
function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <div><label className="label" htmlFor={id}>{label}</label>{children}</div>;
}
