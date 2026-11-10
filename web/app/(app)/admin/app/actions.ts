"use server";

import { revalidatePath } from "next/cache";
import { getStaff } from "@/lib/session";
import { service } from "@/lib/server/service";

async function admin() {
  const s = await getStaff();
  if (s.profile.role !== "admin") throw new Error("Only admins can publish the app.");
  return s;
}

/** Step 1: a one-time upload address, so the browser sends the APK straight to storage (too big for the server). */
export async function startUpload(versionCode: number, versionName: string): Promise<{ path?: string; signedUrl?: string; error?: string }> {
  await admin();
  if (!Number.isInteger(versionCode) || versionCode < 1) return { error: "Version code must be a whole number above 0." };
  if (!/^\d+\.\d+(\.\d+)?$/.test(versionName)) return { error: "Version name looks like 1.2.0." };
  const svc = service();
  const { data: top } = await svc.from("app_releases").select("version_code").eq("platform", "android").order("version_code", { ascending: false }).limit(1).maybeSingle();
  if (top && versionCode <= (top as { version_code: number }).version_code) return { error: `Version code must be higher than ${(top as { version_code: number }).version_code}, the newest one already published.` };
  const path = `android/relive-crm-${versionName}-${versionCode}.apk`;
  const { data, error } = await svc.storage.from("app").createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return { error: error?.message ?? "Could not prepare the upload." };
  return { path, signedUrl: data.signedUrl };
}

/** Step 2: after the upload finishes, record the release. From now on every phone is offered it. */
export async function publishRelease(input: { path: string; versionCode: number; versionName: string; notes: string; mandatory: boolean }): Promise<{ error?: string }> {
  const s = await admin();
  const svc = service();
  const folder = input.path.split("/").slice(0, -1).join("/"), name = input.path.split("/").pop()!;
  const { data: files } = await svc.storage.from("app").list(folder, { search: name });
  const file = (files ?? []).find((f) => f.name === name);
  if (!file) return { error: "The file did not arrive in storage. Upload it again." };
  const size = Number((file.metadata as { size?: number } | null)?.size ?? 0) || null;
  const { error } = await svc.from("app_releases").insert({
    platform: "android", version_code: input.versionCode, version_name: input.versionName, storage_path: input.path,
    size_bytes: size, notes: input.notes.trim() || null, mandatory: input.mandatory, published_by: s.profile.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/app");
  return {};
}

export async function setReleaseActive(fd: FormData) {
  const { sb } = await admin();
  await sb.from("app_releases").update({ active: fd.get("active") === "true" }).eq("id", String(fd.get("id")));
  revalidatePath("/admin/app");
}
