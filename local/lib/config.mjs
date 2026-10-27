import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const cfg = {
  // Admin connection used to build the database and to run lead capture (bypasses row level security by design).
  adminUrl: process.env.CRM_DB_ADMIN_URL ?? "postgres://postgres@127.0.0.1:54322/postgres",
  dbName: process.env.CRM_DB_NAME ?? "crm_local",
  port: Number(process.env.CRM_GATEWAY_PORT ?? 54321),
  // Local-only secret. Tokens signed with it are worthless anywhere else.
  jwtSecret: process.env.CRM_JWT_SECRET ?? "local-test-only-secret-change-me-0123456789abcdef",
};
export function dbUrl() {
  const u = new URL(cfg.adminUrl);
  u.pathname = "/" + cfg.dbName;
  return u.toString();
}
