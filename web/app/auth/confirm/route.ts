import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// One-time set-password links land here.
// GET only shows a "Continue" button: WhatsApp, Gmail and other link previewers open links automatically,
// and verifying on GET would spend the one-time token before the person ever taps it.
// The token is exchanged for a session on POST (the button), then the person goes to /set-password.
export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("token_hash");
  if (!hash) return toLogin(req, "invalid");
  const safe = hash.replace(/[^A-Za-z0-9_-]/g, "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Relive CRM: set your password</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e8e8ea;font:15px/1.5 system-ui,sans-serif}
main{max-width:360px;padding:28px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#a0a3ab;margin:0 0 20px}
button{background:#f26b3a;color:#fff;border:0;border-radius:10px;padding:12px 22px;font:600 15px system-ui,sans-serif;cursor:pointer;width:100%}</style></head>
<body><main><h1>Welcome to Relive CRM</h1><p>Tap continue to choose your password. This link works once.</p>
<form method="post"><input type="hidden" name="token_hash" value="${safe}"><button type="submit">Continue</button></form></main></body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

export async function POST(req: NextRequest) {
  const fd = await req.formData();
  const hash = String(fd.get("token_hash") ?? "");
  if (!hash) return toLogin(req, "invalid");
  const sb = await createClient();
  const { error } = await sb.auth.verifyOtp({ token_hash: hash, type: "recovery" });
  if (error) return toLogin(req, "expired");
  const url = req.nextUrl.clone();
  url.search = "";
  url.pathname = "/set-password";
  return NextResponse.redirect(url, 303);
}

function toLogin(req: NextRequest, error: string) {
  const url = req.nextUrl.clone();
  url.search = "";
  url.pathname = "/login";
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}
