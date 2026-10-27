import { timingSafeEqual } from "node:crypto";
import { runJobs } from "@/lib/jobs/run";
import { json } from "@/lib/server/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/jobs/run with "Authorization: Bearer <JOBS_SECRET>". The database calls this every minute.
async function handle(req: Request) {
  const secret = process.env.JOBS_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return json({ error: "unauthorised" }, 401);
  const only = new URL(req.url).searchParams.get("only");
  return json(await runJobs(only ? (only.split(",") as ("inbound" | "notify" | "sheets")[]) : undefined));
}
export const POST = handle;
export const GET = handle;
