export const STAFF_ROLES = ["admin", "manager", "agent", "marketing", "viewer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffRow = { line: number; name: string; email: string; phone: string; role: StaffRole; team: string; problem?: string };

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

// Splits one line on tabs, commas or semicolons; handles simple "quoted, values".
function cells(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  const out: string[] = []; let cur = ""; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if ((ch === "," || ch === ";") && !q) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Parses pasted staff rows. Accepts a header row (name, email, phone, role, team in any order) or,
 * with no header, the order: name, email, phone, role, team. Never throws; bad rows carry a `problem`.
 */
export function parseStaff(text: string, defaultRole: StaffRole = "agent"): StaffRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  let order = ["name", "email", "phone", "role", "team"];
  let start = 0;
  const first = cells(lines[0]).map(norm);
  const alias: Record<string, string> = { name: "name", fullname: "name", suggestedname: "name", cratioowner: "name", owner: "name", email: "email", emailid: "email", mail: "email", phone: "phone", mobile: "phone", role: "role", suggestedrole: "role", team: "team" };
  if (first.some((c) => c === "email" || c === "emailid" || c === "mail") && first.every((c) => c === "" || alias[c] || ["leads", "open", "booked", "notes"].includes(c))) {
    order = first.map((c) => alias[c] ?? "skip");
    start = 1;
  } else if (!lines[0].includes("@") && lines.length > 1 && lines[1].includes("@") && first.some((c) => alias[c])) {
    order = first.map((c) => alias[c] ?? "skip");
    start = 1;
  }
  const rows: StaffRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const c = cells(lines[i]);
    const get = (k: string) => (c[order.indexOf(k)] ?? "").trim();
    let name = get("name"), email = get("email").toLowerCase();
    // a bare list of addresses: treat a lone email as the email
    if (!email && EMAIL.test(name)) { email = name.toLowerCase(); name = ""; }
    const roleRaw = get("role").toLowerCase();
    const role = (STAFF_ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as StaffRole) : defaultRole;
    const row: StaffRow = { line: i + 1, name: name.replace(/\s+/g, " "), email, phone: get("phone").replace(/[^\d+]/g, ""), role, team: get("team") };
    if (!row.name) row.problem = "name missing (it must match the Cratio owner name exactly to bring over their leads)";
    else if (!row.email) row.problem = "email missing";
    else if (!EMAIL.test(row.email)) row.problem = "email looks wrong";
    else if (roleRaw && !(STAFF_ROLES as readonly string[]).includes(roleRaw)) row.problem = `role "${roleRaw}" is not one of ${STAFF_ROLES.join(", ")}`;
    rows.push(row);
  }
  // duplicates inside the pasted list
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (!r.email || r.problem) continue;
    if (seen.has(r.email)) r.problem = `same email as line ${seen.get(r.email)}`;
    else seen.set(r.email, r.line);
  }
  return rows;
}
