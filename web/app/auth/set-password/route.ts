import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Saves the password chosen on /set-password. A plain form POST with a full-page redirect:
// no client-side JavaScript involved, so it cannot hang silently on a phone browser.
export async function POST(req: NextRequest) {
  const fd = await req.formData();
  const pw = String(fd.get("password") ?? ""), again = String(fd.get("again") ?? "");
  if (pw.length < 8) return go(req, "/set-password", "short");
  if (pw !== again) return go(req, "/set-password", "mismatch");
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return go(req, "/login", "expired");
  const { error } = await sb.auth.updateUser({ password: pw });
  // "same_password" means this exact password is already saved (usually a second tap): treat it as done.
  if (error && error.code !== "same_password") return go(req, "/set-password", "failed");
  return go(req, "/welcome");
}

function go(req: NextRequest, path: string, error?: string) {
  const url = req.nextUrl.clone();
  url.search = "";
  url.pathname = path;
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}
