import "server-only";
import { deliverNotifications } from "./notify";
import { syncSheets } from "./sheets";
import { retryInbound } from "@/lib/integrations/inbound";

// Everything that talks to the outside world after a change: retry failed webhook deliveries, send alerts,
// update Google Sheets. Called every minute by the database (pg_cron + pg_net) and straight after each new lead.
export async function runJobs(parts: ("inbound" | "notify" | "sheets")[] = ["inbound", "notify", "sheets"]) {
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { out[name] = await fn(); } catch (e) { out[name] = { error: (e as Error).message }; }
  };
  if (parts.includes("inbound")) await step("inbound", () => retryInbound());
  if (parts.includes("notify")) await step("notify", () => deliverNotifications());
  if (parts.includes("sheets")) await step("sheets", () => syncSheets());
  return out;
}
