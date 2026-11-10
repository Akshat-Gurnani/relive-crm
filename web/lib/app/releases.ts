import "server-only";
import { service } from "@/lib/server/service";

export type AppRelease = { id: string; version_code: number; version_name: string; storage_path: string; size_bytes: number | null; notes: string | null; mandatory: boolean; active: boolean; created_at: string };

export const apkUrl = (path: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1/object/public/app/${path.split("/").map(encodeURIComponent).join("/")}`;

/** Newest active Android release, or null if none has been published yet. */
export async function latestAndroid(): Promise<AppRelease | null> {
  try {
    const { data } = await service().from("app_releases").select("*").eq("platform", "android").eq("active", true).order("version_code", { ascending: false }).limit(1).maybeSingle();
    return (data as AppRelease | null) ?? null;
  } catch { return null; }
}
