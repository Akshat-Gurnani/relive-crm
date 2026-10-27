"use client";
import { useEffect, useState } from "react";
import { savePushSubscription } from "@/app/(app)/notifications/actions";

const b64 = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

// Turns on push notifications for this browser or installed app (iPhone needs it added to the Home Screen first).
export function PushToggle({ vapidKey }: { vapidKey: string }) {
  const [state, setState] = useState<"checking" | "unsupported" | "ios-install" | "off" | "on" | "denied" | "error">("checking");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setState(ios && !standalone ? "ios-install" : "unsupported"); return; }
      if (Notification.permission === "denied") { setState("denied"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);
  const enable = async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState("denied"); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapidKey) });
      const j = sub.toJSON() as { endpoint: string; keys: Record<string, string> };
      const err = await savePushSubscription(j, navigator.userAgent.slice(0, 120));
      if (err) { setState("error"); setMsg(err); } else setState("on");
    } catch (e) { setState("error"); setMsg(String(e)); }
  };
  const text: Record<string, string> = {
    checking: "Checking this device…",
    unsupported: "This browser cannot receive push notifications. You will still see them here.",
    "ios-install": "On iPhone, tap Share then Add to Home Screen, open the CRM from there, and come back to this page to turn on notifications.",
    off: "Get a ping on this device for new leads, follow-ups due in 15 minutes and task reminders.",
    on: "Notifications are on for this device.",
    denied: "Notifications are blocked for this site. Allow them in the browser settings, then reload.",
    error: `Could not turn on notifications: ${msg}`,
  };
  return (
    <div className="panel flex flex-wrap items-center gap-3 p-4">
      <img src="/emoji/bell.svg" alt="" width={22} height={22} />
      <p className="min-w-0 flex-1 text-[13px] text-ink/85">{text[state]}</p>
      {state === "off" && <button className="btn" onClick={enable}>Turn on notifications</button>}
      {state === "on" && <span className="chip" aria-current="true">On</span>}
    </div>
  );
}
