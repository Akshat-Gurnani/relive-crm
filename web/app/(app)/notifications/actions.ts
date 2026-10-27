"use server";
import { revalidatePath } from "next/cache";
import { getStaff } from "@/lib/session";
import { EMAIL_KINDS } from "@/lib/alerts";

export async function markAllRead() {
  const { sb } = await getStaff();
  await sb.rpc("mark_notifications_read", {});
  revalidatePath("/", "layout");
}

// Saves this browser's push subscription so reminders arrive even when the CRM is closed.
export async function savePushSubscription(sub: { endpoint: string; keys: Record<string, string> }, device: string) {
  const { sb, profile } = await getStaff();
  const { error } = await sb.from("push_subscriptions").upsert({ user_id: profile.id, kind: "web", endpoint: sub.endpoint, keys: sub.keys, device }, { onConflict: "endpoint" });
  return error ? error.message : null;
}


export async function saveAlertSettings(formData: FormData) {
  const { sb, profile } = await getStaff();
  const kinds = EMAIL_KINDS.map(([k]) => k).filter((k) => formData.get(`k_${k}`) === "on");
  await sb.from("notification_settings").upsert({
    user_id: profile.id,
    push_enabled: formData.get("push_enabled") === "on",
    email_enabled: formData.get("email_enabled") === "on",
    all_new_leads: ["admin", "manager"].includes(profile.role) && formData.get("all_new_leads") === "on",
    email_kinds: kinds, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  revalidatePath("/notifications");
}
