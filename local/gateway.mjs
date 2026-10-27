// Docker-free stand-in for the parts of Supabase that the CRM web app uses, for LOCAL TESTING ONLY.
//   /auth/v1/*       sign in with email and password, session refresh, current user, sign out
//   /rest/v1/*       the subset of PostgREST the web app speaks (select with embeds, filters, order, range, count,
//                    insert, update, rpc). Every request runs inside a transaction as the signed-in user's database
//                    role with their JWT claims set, so the real row level security policies decide what is visible.
//   /functions/v1/capture/<slug>   the same lead capture endpoint that ships as a Supabase edge function
//   /auth/v1/admin/users           create users and reset passwords (service role key only)
//   every minute: untouched-lead rotation, reminders, and push delivery (web push and Expo), like the cron jobs in production
// Production uses real Supabase; this file is never deployed.
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import webpush from "web-push";
import { cfg, dbUrl } from "./lib/config.mjs";

const pool = new pg.Pool({ connectionString: dbUrl(), max: 10 });
pool.on("error", (e) => console.error("idle database connection dropped:", e.message)); // e.g. database rebuilt underneath us
pg.types.setTypeParser(1700, (v) => v); // numerics stay exact strings unless wrapped in to_jsonb

// ------------------------------------------------------------------ tokens
const b64 = (b) => Buffer.from(b).toString("base64url");
const sign = (payload) => {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", cfg.jwtSecret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};
function verify(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const expect = crypto.createHmac("sha256", cfg.jwtSecret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], "base64url");
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (claims.exp && claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch { return null; }
}
export const anonKey = sign({ role: "anon", iss: "local-test", iat: 1700000000, exp: 4102444800 });
export const serviceKey = sign({ role: "service_role", iss: "local-test", iat: 1700000000, exp: 4102444800 });

// VAPID keys for web push, created once per computer and kept outside the project folder.
const stateDir = process.env.CRM_LOCAL_HOME ?? path.join(os.homedir(), ".relive-crm-local");
fs.mkdirSync(stateDir, { recursive: true });
const vapidFile = path.join(stateDir, "vapid.json");
if (!fs.existsSync(vapidFile)) fs.writeFileSync(vapidFile, JSON.stringify(webpush.generateVAPIDKeys()), { mode: 0o600 });
const vapid = JSON.parse(fs.readFileSync(vapidFile, "utf8"));
webpush.setVapidDetails("mailto:admin@relive.test", vapid.publicKey, vapid.privateKey);

const userJson = (u) => ({
  id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.created_at, phone: "",
  confirmed_at: u.created_at, last_sign_in_at: new Date().toISOString(),
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [],
  created_at: u.created_at, updated_at: u.created_at,
});
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", iat: now, app_metadata: { provider: "email" }, user_metadata: {} };
  return {
    access_token: sign({ ...claims, exp: now + 3600 }), token_type: "bearer", expires_in: 3600, expires_at: now + 3600,
    refresh_token: sign({ sub: u.id, typ: "refresh", iat: now, exp: now + 60 * 60 * 24 * 30 }), user: userJson(u),
  };
}

// ------------------------------------------------------------------ helpers
const readBody = (req) => new Promise((res, rej) => {
  const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => res(Buffer.concat(chunks))); req.on("error", rej);
});
function send(res, status, body, headers = {}) {
  const payload = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", ...headers });
  res.end(payload);
}
class HttpError extends Error { constructor(status, body) { super(body.message ?? "error"); this.status = status; this.body = body; } }
const bad = (message, code = "PGRST100", status = 400, details = null) => new HttpError(status, { code, message, details, hint: null });

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const q = (name) => { if (!IDENT.test(name)) throw bad(`invalid identifier: ${name}`); return `"${name}"`; };

// ------------------------------------------------------------------ catalog (tables, columns, foreign keys)
let catalog;
async function loadCatalog() {
  const tabs = await pool.query(`select table_name from information_schema.tables where table_schema='public'`);
  const arrCols = await pool.query(`select table_name, column_name from information_schema.columns where table_schema='public' and data_type='ARRAY'`);
  const fks = await pool.query(`
    select c.conrelid::regclass::text as t, a.attname as col, c.confrelid::regclass::text as rt, af.attname as rcol
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
     where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.connamespace = 'public'::regnamespace`);
  const fns = await pool.query(`select proname, bool_or(proretset) as setof,
      array_agg(distinct a.name) filter (where a.is_array) as array_args
    from pg_proc p left join lateral (
      select n.name, t.typcategory = 'A' as is_array
        from unnest(p.proargnames, p.proargtypes::oid[]) as n(name, typ) join pg_type t on t.oid = n.typ) a on true
   where pronamespace = 'public'::regnamespace group by proname`);
  catalog = { tables: new Set(tabs.rows.map((r) => r.table_name)), fks: fks.rows, fns: new Set(fns.rows.map((r) => r.proname)),
              arrayCols: new Set(arrCols.rows.map((r) => `${r.table_name}.${r.column_name}`)),
              setof: new Set(fns.rows.filter((r) => r.setof).map((r) => r.proname)),
              arrayArgs: new Map(fns.rows.map((r) => [r.proname, new Set(r.array_args ?? [])])) };
}
const strip = (s) => s.replace(/^public\./, "").replace(/"/g, "");
function relationship(from, to) {
  const m2o = catalog.fks.find((f) => strip(f.t) === from && strip(f.rt) === to);
  if (m2o) return { kind: "m2o", col: m2o.col, rcol: m2o.rcol };
  const o2m = catalog.fks.find((f) => strip(f.t) === to && strip(f.rt) === from);
  if (o2m) return { kind: "o2m", col: o2m.rcol, rcol: o2m.col };
  throw bad(`Could not find a relationship between '${from}' and '${to}' in the schema cache`, "PGRST200", 400);
}

// ------------------------------------------------------------------ select parsing:  a,b,alias:c,alias:tbl!inner(x,y(z))
function splitTop(s, sep = ",") {
  const out = []; let depth = 0, cur = "", quote = false;
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote) { if (ch === "(") depth++; if (ch === ")") depth--; }
    if (ch === sep && depth === 0 && !quote) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur !== "") out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
function parseSelect(s) {
  const items = [];
  for (const raw of splitTop(s || "*")) {
    const open = raw.indexOf("(");
    if (open === -1) {
      const [alias, col] = raw.includes(":") ? raw.split(":") : [null, raw];
      items.push({ kind: "col", alias, col: col.replace(/::.*/, "") });
    } else {
      const head = raw.slice(0, open); const inner = raw.slice(open + 1, raw.lastIndexOf(")"));
      const [aliasPart, rest] = head.includes(":") ? head.split(":") : [null, head];
      const [table, ...hints] = rest.split("!");
      items.push({ kind: "embed", alias: aliasPart ?? table, table, inner: hints.includes("inner"), children: parseSelect(inner) });
    }
  }
  return items;
}

// ------------------------------------------------------------------ filters
const OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };
function listValues(v) {
  const m = v.match(/^\((.*)\)$/s); if (!m) throw bad(`bad list: ${v}`);
  return splitTop(m[1]).map((x) => x.replace(/^"(.*)"$/, "$1"));
}
function condition(alias, col, opExpr, params) {
  let neg = false, expr = opExpr;
  if (expr.startsWith("not.")) { neg = true; expr = expr.slice(4); }
  const dot = expr.indexOf(".");
  const op = dot === -1 ? expr : expr.slice(0, dot);
  const val = dot === -1 ? "" : expr.slice(dot + 1);
  const c = `${alias}.${q(col)}`;
  let sql;
  if (op === "is") {
    const v = val.toLowerCase();
    if (!["null", "true", "false", "unknown"].includes(v)) throw bad(`bad is value: ${val}`);
    sql = `${c} is ${v}`;
  } else if (op === "in") {
    const vals = listValues(val);
    if (vals.length === 0) sql = "false";
    else sql = `${c} in (${vals.map((x) => { params.push(x); return `$${params.length}`; }).join(",")})`;
  } else if (OPS[op]) {
    params.push(op === "like" || op === "ilike" ? val.replace(/\*/g, "%") : val);
    sql = `${c} ${OPS[op]} $${params.length}`;
  } else throw bad(`unsupported operator: ${op}`);
  return neg ? `not (${sql})` : sql;
}
function orGroup(alias, expr, params) {
  const m = expr.match(/^\((.*)\)$/s); if (!m) throw bad(`bad or(): ${expr}`);
  const parts = splitTop(m[1]).map((p) => {
    const i = p.indexOf("."); return condition(alias, p.slice(0, i), p.slice(i + 1), params);
  });
  return parts.length ? `(${parts.join(" or ")})` : "true";
}
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

// ------------------------------------------------------------------ query building
let aliasN = 0;
// Builds a `select` for `table`. `qp` holds the query-string pairs that apply (own filters; embed filters are `embed.key`).
function buildSelect(table, items, qp, params, { top }) {
  if (!catalog.tables.has(table)) throw bad(`relation "public.${table}" does not exist`, "42P01", 404);
  const a = `t${aliasN++}`;
  const cols = []; const where = [];
  for (const it of items) {
    if (it.kind === "col") cols.push(it.col === "*" ? `${a}.*` : `${a}.${q(it.col)}${it.alias ? ` as ${q(it.alias)}` : ""}`);
    else {
      const rel = relationship(table, it.table);
      const sub = buildSelect(it.table, it.children, qp.embedded[it.alias] ?? qp.embedded[it.table] ?? { own: [], embedded: {} }, params, { top: false });
      // col is on this table, rcol on the embedded one (for both directions)
      const link = `${sub.alias}.${q(rel.rcol)} = ${a}.${q(rel.col)}`;
      const subWhere = [link, ...sub.where].join(" and ");
      const inner = `select ${sub.cols.join(", ")} from public.${q(it.table)} ${sub.alias} where ${subWhere}${sub.order ? ` order by ${sub.order}` : ""}`;
      const expr = rel.kind === "m2o" ? `(select to_jsonb(e) from (${inner}) e)` : `(select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from (${inner}) e)`;
      cols.push(`${expr} as ${q(it.alias)}`);
      if (it.inner) where.push(rel.kind === "m2o" ? `${expr} is not null` : `exists (${inner})`);
    }
  }
  let order = "";
  for (const [k, v] of qp.own) {
    if (k === "order") {
      order = v.split(",").map((o) => {
        const [col, ...mods] = o.split(".");
        return `${a}.${q(col)} ${mods.includes("desc") ? "desc" : "asc"}${mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : ""}`;
      }).join(", ");
    } else if (k === "or") where.push(orGroup(a, v, params));
    else if (k === "and") where.push(orGroup(a, v, params).replace(/ or /g, " and "));
    else if (!RESERVED.has(k)) where.push(condition(a, k, v, params));
  }
  return { alias: a, cols: cols.length ? cols : [`${a}.*`], where, order };
}
function groupParams(searchParams) {
  const root = { own: [], embedded: {} };
  for (const [k, v] of searchParams.entries()) {
    const dot = k.indexOf(".");
    if (dot > 0) (root.embedded[k.slice(0, dot)] ??= { own: [], embedded: {} }).own.push([k.slice(dot + 1), v]);
    else root.own.push([k, v]);
  }
  return root;
}

// ------------------------------------------------------------------ running a request as a user
async function asUser(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const role = claims?.role === "authenticated" ? "authenticated" : claims?.role === "service_role" ? "service_role" : "anon";
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)",
      [JSON.stringify(claims ?? { role: "anon" }), claims?.sub ?? "", role]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; }
  finally { c.release(); }
}
function mapPgError(e) {
  if (e instanceof HttpError) return e;
  if (!e.code) return new HttpError(500, { code: "PGRST000", message: e.message, details: null, hint: null });
  const status = e.code === "42501" ? 403 : e.code === "23505" || e.code === "23503" ? 409 : e.code === "42P01" ? 404 : 400;
  return new HttpError(status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

async function handleRest(req, res, url, claims) {
  const rel = url.pathname.replace(/^\/rest\/v1\//, "");
  const prefer = String(req.headers.prefer ?? "");
  const accept = String(req.headers.accept ?? "");
  const wantCount = /count=(exact|planned|estimated)/.test(prefer);
  const single = accept.includes("vnd.pgrst.object+json");

  // ---- rpc
  if (rel.startsWith("rpc/")) {
    const fn = rel.slice(4);
    if (!catalog.fns.has(fn)) throw bad(`Could not find the function public.${fn} in the schema cache`, "PGRST202", 404);
    const args = req.method === "GET" ? Object.fromEntries(url.searchParams.entries()) : JSON.parse((await readBody(req)).toString() || "{}");
    const names = Object.keys(args);
    // Postgres array parameters (uuid[], text[]) go as arrays; json/jsonb parameters as JSON text
    const arrayArgs = catalog.arrayArgs.get(fn) ?? new Set();
    const params = names.map((n) => (Array.isArray(args[n]) && arrayArgs.has(n) ? args[n]
      : typeof args[n] === "object" && args[n] !== null ? JSON.stringify(args[n]) : args[n]));
    const call = `public.${q(fn)}(${names.map((n, i) => `${q(n)} => $${i + 1}`).join(", ")})`;
    // set-returning functions come back as an array, like PostgREST; others as a single value
    const sql = catalog.setof.has(fn)
      ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as r from ${call} t`
      : `select to_jsonb(${call}) as r`;
    const out = await asUser(claims, (c) => c.query(sql, params));
    return send(res, 200, JSON.stringify(out.rows[0]?.r ?? null));
  }

  const table = rel;
  if (!catalog.tables.has(table)) throw bad(`Could not find the table 'public.${table}' in the schema cache`, "PGRST205", 404);

  // ---- insert
  if (req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length === 0) return send(res, 201);
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const params = []; const tuples = rows.map((r) => `(${cols.map((cname) => {
      const v = r[cname]; params.push(Array.isArray(v) && catalog.arrayCols.has(`${table}.${cname}`) ? v : v !== null && typeof v === "object" ? JSON.stringify(v) : v); return `$${params.length}`;
    }).join(",")})`);
    const wantRows = prefer.includes("return=representation");
    let conflict = "";
    const onConflict = url.searchParams.get("on_conflict");
    if (prefer.includes("resolution=merge-duplicates") || prefer.includes("resolution=ignore-duplicates")) {
      const target = (onConflict ?? "id").split(",").map((x) => q(x.trim())).join(",");
      const updates = cols.filter((cname) => !(onConflict ?? "id").split(",").includes(cname));
      conflict = prefer.includes("ignore-duplicates") || updates.length === 0
        ? ` on conflict (${target}) do nothing`
        : ` on conflict (${target}) do update set ${updates.map((cname) => `${q(cname)} = excluded.${q(cname)}`).join(", ")}`;
    }
    const sql = `insert into public.${q(table)} (${cols.map(q).join(",")}) values ${tuples.join(",")}${conflict}${wantRows ? " returning to_jsonb(" + q(table) + ".*) as r" : ""}`;
    const out = await asUser(claims, (c) => c.query(sql, params));
    return wantRows ? send(res, 201, out.rows.map((x) => x.r)) : send(res, 201);
  }

  // ---- update
  if (req.method === "PATCH") {
    const patch = JSON.parse((await readBody(req)).toString() || "{}");
    const keys = Object.keys(patch);
    if (keys.length === 0) return send(res, 204);
    const params = keys.map((k) => (Array.isArray(patch[k]) && catalog.arrayCols.has(`${table}.${k}`) ? patch[k] : patch[k] !== null && typeof patch[k] === "object" ? JSON.stringify(patch[k]) : patch[k]));
    const sets = keys.map((k, i) => `${q(k)} = $${i + 1}`);
    const where = [];
    for (const [k, v] of url.searchParams.entries()) {
      if (k === "select") continue;
      if (k === "or") where.push(orGroup(q(table), v, params));
      else where.push(condition(q(table), k, v, params));
    }
    const wantRows = prefer.includes("return=representation");
    const sql = `update public.${q(table)} set ${sets.join(", ")}${where.length ? ` where ${where.join(" and ")}` : ""}${wantRows ? ` returning to_jsonb(${q(table)}.*) as r` : ""}`;
    const out = await asUser(claims, (c) => c.query(sql, params));
    return wantRows ? send(res, 200, out.rows.map((x) => x.r)) : send(res, 204);
  }

  // ---- delete
  if (req.method === "DELETE") {
    const params = []; const where = [];
    for (const [k, v] of url.searchParams.entries()) {
      if (k === "select") continue;
      if (k === "or") where.push(orGroup(q(table), v, params));
      else where.push(condition(q(table), k, v, params));
    }
    if (!where.length) throw bad("DELETE requires a filter", "21000");
    const wantRows = prefer.includes("return=representation");
    const sql = `delete from public.${q(table)} where ${where.join(" and ")}${wantRows ? ` returning to_jsonb(${q(table)}.*) as r` : ""}`;
    const out = await asUser(claims, (c) => c.query(sql, params));
    return wantRows ? send(res, 200, out.rows.map((x) => x.r)) : send(res, 204);
  }

  if (req.method !== "GET" && req.method !== "HEAD") throw bad(`method not supported: ${req.method}`, "PGRST117", 405);

  // ---- select
  const selectItems = parseSelect(url.searchParams.get("select") ?? "*");
  const qp = groupParams(url.searchParams);
  const params = []; aliasN = 0;
  const s = buildSelect(table, selectItems, qp, params, { top: true });
  const limit = url.searchParams.get("limit"); const offset = url.searchParams.get("offset");
  const whereSql = s.where.length ? ` where ${s.where.join(" and ")}` : "";
  const sql = `select to_jsonb(r) as r from (select ${s.cols.join(", ")} from public.${q(table)} ${s.alias}${whereSql}${s.order ? ` order by ${s.order}` : ""}${limit ? ` limit ${Number(limit) | 0}` : ""}${offset ? ` offset ${Number(offset) | 0}` : ""}) r`;
  // The count must see the same filters, including those inside !inner embeds, but none of the select-list columns.
  const cparams = []; aliasN = 100;
  const cs = buildSelect(table, selectItems.filter((i) => i.kind === "embed" && i.inner).map((i) => ({ ...i, children: [] })), qp, cparams, { top: true });
  const countSql = `select count(*)::bigint as n from public.${q(table)} ${cs.alias}${cs.where.length ? ` where ${cs.where.join(" and ")}` : ""}`;
  const countParams = cparams;
  const out = await asUser(claims, async (c) => {
    const rows = req.method === "HEAD" ? { rows: [] } : await c.query(sql, params);
    const total = wantCount ? Number((await c.query(countSql, countParams)).rows[0].n) : null;
    return { rows: rows.rows.map((x) => x.r), total };
  });
  const start = Number(offset ?? 0);
  const range = out.rows.length ? `${start}-${start + out.rows.length - 1}` : "*";
  const headers = { "content-range": `${range}/${out.total ?? "*"}` };
  if (single) {
    if (out.rows.length !== 1) throw new HttpError(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${out.rows.length} rows`, hint: null });
    return send(res, 200, out.rows[0], headers);
  }
  return req.method === "HEAD" ? send(res, 200, undefined, headers) : send(res, 200, out.rows, headers);
}

// ------------------------------------------------------------------ auth
async function handleAuth(req, res, url) {
  const route = url.pathname.replace(/^\/auth\/v1\//, "");
  if (route === "token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    if (grant === "password") {
      const r = await pool.query(
        "select id, email, created_at from auth.users where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)",
        [String(body.email ?? ""), String(body.password ?? "")]);
      if (!r.rows[0]) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials", error: "invalid_grant", error_description: "Invalid login credentials" });
      return send(res, 200, session(r.rows[0]));
    }
    if (grant === "refresh_token") {
      const claims = verify(body.refresh_token);
      if (!claims || claims.typ !== "refresh") return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token", error: "invalid_grant", error_description: "Invalid Refresh Token" });
      const r = await pool.query("select id, email, created_at from auth.users where id = $1", [claims.sub]);
      if (!r.rows[0]) return send(res, 400, { code: 400, msg: "User not found" });
      return send(res, 200, session(r.rows[0]));
    }
    return send(res, 400, { code: 400, msg: `unsupported grant_type ${grant}` });
  }
  if (route === "user" && req.method === "GET") {
    const claims = verify(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    if (!claims || claims.role !== "authenticated") return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    const r = await pool.query("select id, email, created_at from auth.users where id = $1", [claims.sub]);
    if (!r.rows[0]) return send(res, 403, { code: 403, error_code: "user_not_found", msg: "User from sub claim in JWT does not exist" });
    return send(res, 200, userJson(r.rows[0]));
  }
  if (route.startsWith("admin/users")) {
    const claims = verify(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    if (!claims || claims.role !== "service_role") return send(res, 403, { code: 403, msg: "service role key required" });
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const id = route.split("/")[2];
    if (req.method === "POST" && !id) {
      if (!body.email || !body.password) return send(res, 422, { code: 422, msg: "email and password are required" });
      try {
        const r = await pool.query(
          "insert into auth.users(email, encrypted_password) values (lower($1), extensions.crypt($2, extensions.gen_salt('bf'))) returning id, email, created_at",
          [String(body.email), String(body.password)]);
        return send(res, 200, userJson(r.rows[0]));
      } catch (e) {
        if (e.code === "23505") return send(res, 422, { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" });
        throw e;
      }
    }
    if (req.method === "PUT" && id) {
      if (body.password) await pool.query("update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id = $1", [id, String(body.password)]);
      const r = await pool.query("select id, email, created_at from auth.users where id = $1", [id]);
      return r.rows[0] ? send(res, 200, userJson(r.rows[0])) : send(res, 404, { code: 404, msg: "User not found" });
    }
    return send(res, 405, { code: 405, msg: "unsupported" });
  }
  if (route === "logout") return send(res, 204);
  if (route === "settings") return send(res, 200, { external: {}, disable_signup: true, mailer_autoconfirm: true });
  return send(res, 404, { code: 404, msg: `no auth route ${route}` });
}

// ------------------------------------------------------------------ lead capture (mirrors supabase/functions/capture)
async function handleCapture(req, res, url) {
  if (req.method !== "POST") return send(res, 405, { error: "use POST" });
  const slug = url.pathname.split("/").filter(Boolean).pop();
  if (!slug || slug === "capture") return send(res, 400, { error: "missing endpoint slug" });
  const auth = String(req.headers.authorization ?? "");
  const secret = req.headers["x-capture-secret"] ?? auth.replace(/^Bearer\s+/i, "");
  if (!secret) return send(res, 401, { error: "missing secret" });
  const raw = (await readBody(req)).toString();
  let payload;
  try {
    const type = String(req.headers["content-type"] ?? "");
    payload = type.includes("json") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  } catch { return send(res, 400, { error: "body must be JSON or form data" }); }
  const hash = crypto.createHash("sha256").update(String(secret)).digest("hex");
  try {
    const r = await pool.query("select public.capture_enquiry($1, $2, $3::jsonb) as r", [slug, hash, JSON.stringify(payload)]);
    return send(res, 200, r.rows[0].r);
  } catch (e) {
    if (e.code === "28000") return send(res, 401, { error: "unauthorised" });
    console.error("capture failed", e.message);
    return send(res, 500, { error: "temporary failure" });
  }
}

// ------------------------------------------------------------------ server
await loadCatalog();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "OPTIONS") return send(res, 204, undefined, { "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    if (url.pathname.startsWith("/auth/v1/")) return await handleAuth(req, res, url);
    if (url.pathname.startsWith("/functions/v1/capture")) return await handleCapture(req, res, url);
    if (url.pathname.startsWith("/rest/v1/")) {
      const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const claims = token ? verify(token) : null;
      if (token && !claims) throw new HttpError(401, { code: "PGRST301", message: "JWT expired or invalid", details: null, hint: null });
      if (claims && !["anon", "authenticated", "service_role"].includes(claims.role)) throw new HttpError(401, { code: "PGRST303", message: "unsupported role", details: null, hint: null });
      return await handleRest(req, res, url, claims ?? { role: "anon" });
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    const err = mapPgError(e);
    if (err.status >= 500) console.error(e);
    return send(res, err.status, err.body);
  }
});
// ------------------------------------------------------------------ scheduled jobs (pg_cron + push edge function in production)
async function deliverPush() {
  const { rows } = await pool.query(`
    select n.id, n.user_id, n.title, n.body, n.lead_id, s.id as sub_id, s.kind, s.endpoint, s.keys
      from notifications n join push_subscriptions s on s.user_id = n.user_id
     where n.pushed_at is null and n.created_at > now() - interval '1 hour' order by n.created_at limit 200`);
  const done = new Set();
  const expo = [];
  for (const r of rows) {
    const data = { title: r.title, body: r.body ?? "", url: r.lead_id ? `/leads/${r.lead_id}` : "/notifications", lead_id: r.lead_id };
    if (r.kind === "web") {
      try { await webpush.sendNotification({ endpoint: r.endpoint, keys: r.keys }, JSON.stringify(data)); }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await pool.query("delete from push_subscriptions where id = $1", [r.sub_id]); }
    } else expo.push({ to: r.endpoint, title: r.title, body: r.body ?? "", data, sound: "default", priority: "high" });
    done.add(r.id);
  }
  if (expo.length) {
    try { await fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(expo) }); }
    catch (e) { console.error("expo push failed:", e.message); }
  }
  // notifications for people with no subscription are marked too, so they do not pile up
  await pool.query("update notifications set pushed_at = now() where pushed_at is null and (id = any($1) or created_at < now() - interval '2 minutes')", [[...done]]);
}
async function tick() {
  try {
    const r = await pool.query("select public.rotate_untouched() as rotated, public.queue_reminders() as reminders");
    if (r.rows[0].rotated || r.rows[0].reminders) console.log(`[jobs] rotated ${r.rows[0].rotated}, reminders ${r.rows[0].reminders}`);
    await deliverPush();
  } catch (e) { console.error("[jobs]", e.message); }
}
setInterval(tick, 60_000);
setTimeout(tick, 5_000);

const host = process.env.CRM_LAN === "1" ? "0.0.0.0" : "127.0.0.1";
server.listen(cfg.port, host, () => {
  console.log(`gateway listening on http://${host}:${cfg.port}`);
  if (process.argv.includes("--print-keys")) {
    console.log(`ANON_KEY=${anonKey}`);
    console.log(`SERVICE_KEY=${serviceKey}`);
    console.log(`VAPID_PUBLIC_KEY=${vapid.publicKey}`);
  }
});
