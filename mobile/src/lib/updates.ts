import { Platform } from "react-native";
import * as Application from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { getServer, sb } from "./supabase";

// Self-updating Android app. Admins publish a new APK in the web CRM (Admin > Phone app); it is recorded in
// app_releases and stored in the public "app" bucket. On open and when brought back, the app compares the
// newest release's version code with its own and, if newer, offers to download and install it.
// Android always shows its own "Install" screen: an app installed outside the Play Store cannot update silently.

export type Release = { version_code: number; version_name: string; storage_path: string; size_bytes: number | null; notes: string | null; mandatory: boolean };

export const currentVersionCode = () => Number(Application.nativeBuildVersion ?? 0);
export const currentVersionName = () => Application.nativeApplicationVersion ?? "";

let lastCheck = 0;

/** The newest published release, if it is newer than this app. Checks at most every 20 minutes unless forced. */
export async function checkForUpdate(force = false): Promise<Release | null> {
  if (Platform.OS !== "android") return null;
  if (!force && Date.now() - lastCheck < 20 * 60_000) return null;
  lastCheck = Date.now();
  try {
    const client = await sb();
    const { data } = await client.from("app_releases").select("version_code,version_name,storage_path,size_bytes,notes,mandatory")
      .eq("platform", "android").eq("active", true).order("version_code", { ascending: false }).limit(1).maybeSingle();
    const r = data as Release | null;
    const mine = currentVersionCode();
    return r && mine > 0 && r.version_code > mine ? r : null;
  } catch { return null; }
}

async function apkUrl(path: string) {
  const { url } = await getServer();
  return `${url.replace(/\/+$/, "")}/storage/v1/object/public/app/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Downloads the APK (reporting 0..1 progress) and opens Android's installer. */
export async function downloadAndInstall(r: Release, onProgress: (p: number) => void): Promise<void> {
  const file = `${FileSystem.cacheDirectory}relive-crm-${r.version_code}.apk`;
  const info = await FileSystem.getInfoAsync(file);
  const expected = r.size_bytes ?? 0;
  // reuse a finished download (same size); otherwise start fresh
  if (!info.exists || (expected > 0 && "size" in info && info.size !== expected)) {
    if (info.exists) await FileSystem.deleteAsync(file, { idempotent: true });
    const dl = FileSystem.createDownloadResumable(await apkUrl(r.storage_path), file, {}, (p) => {
      const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : expected;
      if (total > 0) onProgress(Math.min(1, p.totalBytesWritten / total));
    });
    const res = await dl.downloadAsync();
    if (!res || res.status !== 200) {
      await FileSystem.deleteAsync(file, { idempotent: true });
      throw new Error(`Download failed${res ? ` (${res.status})` : ""}`);
    }
  }
  onProgress(1);
  const uri = await FileSystem.getContentUriAsync(file);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: uri,
    type: "application/vnd.android.package-archive",
    flags: 1 | 0x10000000, // FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK
  });
}

/** Removes downloaded installers for this or older versions (after the update has been installed). */
export async function cleanOldDownloads() {
  try {
    const dir = FileSystem.cacheDirectory;
    if (!dir) return;
    const mine = currentVersionCode();
    for (const f of await FileSystem.readDirectoryAsync(dir)) {
      const m = f.match(/^relive-crm-(\d+)\.apk$/);
      if (m && Number(m[1]) <= mine) await FileSystem.deleteAsync(dir + f, { idempotent: true });
    }
  } catch {}
}

// "Check for updates" on the Me tab asks the update sheet (in the root layout) to look again right away.
const listeners = new Set<() => void>();
export function onUpdateCheckRequested(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export async function requestUpdateCheck(): Promise<boolean> {
  const r = await checkForUpdate(true);
  if (r) listeners.forEach((fn) => fn());
  return !!r;
}
