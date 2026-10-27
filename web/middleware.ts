import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = { matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|emoji/|.*\\.(?:png|svg|ico|jpg|webp|woff2|js|webmanifest)$).*)"] };
