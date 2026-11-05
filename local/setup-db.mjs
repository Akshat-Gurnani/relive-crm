// Builds the local test database from scratch: stand-ins for Supabase, both migrations, seed data, and optionally demo data.
//   node setup-db.mjs            (schema + reference data + demo data)
//   node setup-db.mjs --no-demo  (schema + reference data only)
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { ROOT, cfg, dbUrl } from "./lib/config.mjs";

const demo = !process.argv.includes("--no-demo");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const admin = new pg.Client({ connectionString: cfg.adminUrl });
await admin.connect();
await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${cfg.dbName}' and pid <> pg_backend_pid()`);
await admin.query(`drop database if exists ${cfg.dbName}`);
await admin.query(`create database ${cfg.dbName}`);
await admin.end();

const db = new pg.Client({ connectionString: dbUrl() });
await db.connect();
const steps = [
  ["local/bootstrap.sql", read("local", "bootstrap.sql")],
  ["storage stand-in", "create schema if not exists storage; create table if not exists storage.buckets(id text primary key, name text, public boolean); create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);"],
  // every migration in order; the Cratio rule seed at the end of 0024 needs the live projects and staff, so it is skipped here
  ...fs.readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().map((f) => {
    let sql = read("supabase", "migrations", f);
    if (f.startsWith("0024_")) sql = sql.split("-- The 21 Cratio distribution rules")[0];
    return [f, sql];
  }),
  ["seed.sql", read("supabase", "seed.sql")],
  ...(demo ? [["local/seed_demo.sql", read("local", "seed_demo.sql")]] : []),
];
for (const [name, sql] of steps) {
  try { await db.query(sql); console.log("ok  ", name); }
  catch (e) { console.error("FAIL", name, "-", e.message); process.exit(1); }
}
const { rows } = await db.query("select (select count(*) from leads) leads, (select count(*) from profiles) staff, (select count(*) from people) people");
console.log(`database ready: ${rows[0].leads} leads, ${rows[0].people} people, ${rows[0].staff} staff`);
await db.end();
