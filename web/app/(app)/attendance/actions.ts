"use server";
import { revalidatePath } from "next/cache";
import { getStaff } from "@/lib/session";

export async function punch(input: { kind: "in" | "out"; lat: number | null; lng: number | null; accuracy: number | null; note: string }) {
  const { sb, profile } = await getStaff();
  const { error } = await sb.from("attendance").insert({
    user_id: profile.id, kind: input.kind, lat: input.lat, lng: input.lng, accuracy_m: input.accuracy, note: input.note || null, device: "web",
  });
  revalidatePath("/attendance");
  return error ? error.message : null;
}
