import { NextResponse, type NextRequest } from "next/server";
import { getStaff } from "@/lib/session";

// Marks one notification read and opens what it is about.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb } = await getStaff();
  await sb.rpc("mark_notifications_read", { p_ids: [id] });
  const { data } = await sb.from("notifications").select("lead_id,task_id").eq("id", id).maybeSingle();
  const n = data as { lead_id: string | null; task_id: string | null } | null;
  const to = n?.lead_id ? `/leads/${n.lead_id}${n.task_id ? "?tab=tasks" : ""}` : n?.task_id ? "/tasks" : "/notifications";
  return NextResponse.redirect(new URL(to, req.url));
}
