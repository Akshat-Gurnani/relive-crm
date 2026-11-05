"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { syncAdInsights } from "@/lib/integrations/meta-insights";

// Reads the last 30 days of spend from Meta now. Admins and marketing only.
export async function refreshSpend(formData: FormData) {
  const { profile } = await getStaff();
  const p = String(formData.get("p") ?? "30");
  if (!["admin", "marketing"].includes(profile.role)) redirect("/");
  const days = Math.min(90, Math.max(1, Number(String(formData.get("days") ?? "30")) || 30));
  const r = await syncAdInsights(days);
  revalidatePath("/ads");
  redirect(`/ads?${new URLSearchParams({ p, [r.ok ? "notice" : "error"]: r.ok ? `Read ${r.rows} day-by-ad rows from Meta. ${r.detail}` : `Could not read spend: ${r.detail}` })}`);
}
