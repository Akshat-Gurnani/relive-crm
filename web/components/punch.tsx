"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { punch } from "@/app/(app)/attendance/actions";

// Check in or out with the phone's location, as field staff do in Cratio's mobile app.
export function PunchButtons({ last }: { last: "in" | "out" | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const go = (kind: "in" | "out") => {
    setBusy(true); setMsg("Getting your location…");
    const save = async (lat: number | null, lng: number | null, acc: number | null) => {
      const err = await punch({ kind, lat, lng, accuracy: acc, note });
      setBusy(false); setMsg(err ? `Could not save: ${err}` : kind === "in" ? "Checked in." : "Checked out.");
      setNote(""); router.refresh();
    };
    if (!navigator.geolocation) return save(null, null, null);
    navigator.geolocation.getCurrentPosition(
      (p) => save(p.coords.latitude, p.coords.longitude, Math.round(p.coords.accuracy)),
      () => save(null, null, null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };
  return (
    <div className="space-y-3">
      <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="Note (optional), e.g. at Migsun site office" aria-label="Attendance note" />
      <div className="flex gap-2">
        <button className="btn flex-1" disabled={busy || last === "in"} onClick={() => go("in")}>Check in</button>
        <button className="btn-quiet flex-1" disabled={busy || last !== "in"} onClick={() => go("out")}>Check out</button>
      </div>
      {msg && <p className="text-[12.5px] text-mute">{msg}</p>}
    </div>
  );
}
