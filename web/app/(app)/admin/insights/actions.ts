"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { askAI, testKeys } from "@/lib/ai";
import { periodRange } from "@/lib/insights";

const PER_HOUR = 30;

// AI Insights are for top-level admins only. The database enforces the same rule on the snapshot and the log.
export async function askInsights(formData: FormData) {
  const { sb, profile } = await getStaff();
  if (profile.role !== "admin") redirect("/");
  const period = String(formData.get("p") ?? "all");
  const question = String(formData.get("question") ?? "").trim().slice(0, 1000);
  const back = (p: Record<string, string>) => { revalidatePath("/admin/insights"); redirect(`/admin/insights?${new URLSearchParams({ p: period, ...p })}`); };
  if (question.length < 2) back({ error: "Type a question first." });

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb.from("ai_queries").select("id", { count: "exact", head: true }).eq("asked_by", profile.id).gte("created_at", since);
  if ((count ?? 0) >= PER_HOUR) back({ error: `That's ${PER_HOUR} questions this hour. Try again in a little while.` });

  const { from, to, label } = periodRange(period);
  const { data: snapshot, error: e1 } = await sb.rpc("insights_snapshot", { p_from: from, p_to: to });
  if (e1) back({ error: e1.message });

  let answer: string | null = null, model: string | null = null, err: string | null = null;
  try {
    const r = await askAI(question, snapshot);
    answer = r.text; model = r.model;
    // answered, but some keys failed first: keep why, so a dead key is noticed
    if (r.failures.length) err = `Answered after ${r.failures.length} failed attempt${r.failures.length > 1 ? "s" : ""}: ${r.failures.join(" | ")}`;
  } catch (e) { err = e instanceof Error ? e.message : String(e); }
  const id = crypto.randomUUID();
  const { error: e2 } = await sb.from("ai_queries").insert({ id, question, answer, model, period: label, error: err });
  if (e2) back({ error: e2.message });
  back(answer ? { a: id } : { error: err ?? "No answer." });
}

// One tiny request per saved key; shows which keys work (by number and last 4 characters only).
export async function testAiKeys(formData: FormData) {
  const { profile } = await getStaff();
  if (profile.role !== "admin") redirect("/");
  const period = String(formData.get("p") ?? "all");
  const results = await testKeys();
  redirect(`/admin/insights?${new URLSearchParams({ p: period, kt: JSON.stringify(results) })}`);
}
