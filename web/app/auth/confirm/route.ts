import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// One-time set-password links land here: exchange the token for a session, then send the person to /set-password.
export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("token_hash");
  const url = req.nextUrl.clone();
  url.search = "";
  if (!hash) { url.pathname = "/login"; url.searchParams.set("error", "invalid"); return NextResponse.redirect(url); }
  const sb = await createClient();
  const { error } = await sb.auth.verifyOtp({ token_hash: hash, type: "recovery" });
  if (error) { url.pathname = "/login"; url.searchParams.set("error", "expired"); return NextResponse.redirect(url); }
  url.pathname = "/set-password";
  return NextResponse.redirect(url);
}
