import { NextResponse } from "next/server";
import { apkUrl, latestAndroid } from "@/lib/app/releases";

// Permanent download link for the Android app: always sends the newest published APK.
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const r = await latestAndroid();
  if (!r) {
    const url = new URL("/welcome?app=none", req.url);
    return NextResponse.redirect(url, 302);
  }
  return NextResponse.redirect(apkUrl(r.storage_path), 302);
}
