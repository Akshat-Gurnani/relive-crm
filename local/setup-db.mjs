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
  ["0001_core.sql", read("supabase", "migrations", "0001_core.sql")],
  ["0002_dashboard.sql", read("supabase", "migrations", "0002_dashboard.sql")],
  ["0003_workflows.sql", read("supabase", "migrations", "0003_workflows.sql")],
  ["0004_hierarchy.sql", read("supabase", "migrations", "0004_hierarchy.sql")],
  ["0005_integrations.sql", read("supabase", "migrations", "0005_integrations.sql")],
  ["0007_cratio_import.sql", read("supabase", "migrations", "0007_cratio_import.sql")],
  ["0008_import_owners.sql", read("supabase", "migrations", "0008_import_owners.sql")],
  ["0009_lead_source_codes.sql", read("supabase", "migrations", "0009_lead_source_codes.sql")],
  ["0010_lead_sources_as_in_cratio.sql", read("supabase", "migrations", "0010_lead_sources_as_in_cratio.sql")],
  ["0011_lead_search.sql", read("supabase", "migrations", "0011_lead_search.sql")],
  ["0012_insights.sql", read("supabase", "migrations", "0012_insights.sql")],
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
