"use client";

import { useState, useTransition } from "react";
import { staffLink } from "./bulk";

// Per-person "Login link" on the Staff table: makes a one-time set-password link to copy and send by hand.
export function LoginLink({ id, name }: { id: string; name: string }) {
  const [res, setRes] = useState<{ link?: string; email?: string; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const make = () => start(async () => { setCopied(false); setRes(await staffLink(id)); });
  const copy = async () => { if (!res?.link) return; try { await navigator.clipboard.writeText(res.link); setCopied(true); } catch { /* select the box instead */ } };

  if (!res) return <button type="button" onClick={make} disabled={pending} className="btn-quiet h-8 whitespace-nowrap">{pending ? "Making…" : "Login link"}</button>;
  if (res.error) return <span className="text-[12px] text-bad">{res.error} <button type="button" onClick={make} className="underline">Try again</button></span>;
  return (
    <div className="min-w-[260px] space-y-1">
      <div className="flex gap-1.5">
        <input readOnly value={res.link} onFocus={(e) => e.currentTarget.select()} className="input h-8 flex-1 font-mono text-[11px]" aria-label={`Set-password link for ${name}`} />
        <button type="button" onClick={copy} className="btn h-8">{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="text-[11px] text-mute">For {res.email}. One use, expires in about an hour. Send it to {name.split(" ")[0]} yourself; nothing was emailed.</p>
    </div>
  );
}
