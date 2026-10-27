import { NextResponse, type NextRequest } from "next/server";
import { getStaff } from "@/lib/session";

// Opens a call recording through a short-lived signed link. Row level security decides who may play it.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb } = await getStaff();
  const { data } = await sb.from("calls").select("recording_path").eq("id", id).maybeSingle();
  const path = (data as { recording_path: string | null } | null)?.recording_path;
  if (!path) return new NextResponse("No recording for this call.", { status: 404 });
  const { data: signed, error } = await sb.storage.from("call-recordings").createSignedUrl(path, 600);
  if (error || !signed) return new NextResponse("Recordings are kept on the live server only. The local test version does not store files.", { status: 404 });
  return NextResponse.redirect(signed.signedUrl);
}
