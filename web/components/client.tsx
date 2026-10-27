"use client";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

// Ticks or clears every row checkbox (name="ids") inside the same form.
export function SelectAll() {
  return (
    <input
      type="checkbox" aria-label="Select all on this page" className="h-4 w-4 accent-[rgb(var(--accent))]"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((c) => { c.checked = e.currentTarget.checked; });
        form?.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    />
  );
}

// Shows how many rows are ticked and reveals the bulk bar only when something is selected.
export function BulkBar({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => setN(form.querySelectorAll('input[name="ids"]:checked').length);
    form.addEventListener("change", update);
    return () => form.removeEventListener("change", update);
  }, []);
  return (
    <div ref={ref} className={`sticky top-16 z-[5] transition-all duration-300 ${n ? "translate-y-0 opacity-100" : "pointer-events-none h-0 -translate-y-2 overflow-hidden opacity-0"}`}>
      <div className="panel flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="mr-2 text-[13px] font-semibold"><span className="text-accent-2">{n}</span> selected</span>
        {children}
      </div>
    </div>
  );
}

// Asks before a destructive submit, without a browser dialog: first click arms, second click submits.
export function ConfirmButton({ children, className = "btn-quiet", name, value }: { children: React.ReactNode; className?: string; name?: string; value?: string }) {
  const [armed, setArmed] = useState(false);
  return armed
    ? <button type="submit" name={name} value={value} className={`${className} !border-bad/60 !text-bad`}>Click again to confirm</button>
    : <button type="button" className={className} onClick={() => { setArmed(true); setTimeout(() => setArmed(false), 4000); }}>{children}</button>;
}

// Tap-to-call that remembers the call, then offers to log it when the agent comes back to the app (iPhone and web).
export function CallButton({ leadId, phone, className = "btn-quiet", label = "Call" }: { leadId: string; phone: string; className?: string; label?: string }) {
  return (
    <a
      href={`tel:${phone}`} className={className}
      onClick={() => { try { sessionStorage.setItem("pending-call", JSON.stringify({ leadId, phone, at: Date.now() })); } catch {} }}
    >
      <img src="/emoji/call.svg" alt="" width={14} height={14} />{label}
    </a>
  );
}

export function AfterCallPrompt({ action, outcomes }: { action: (f: FormData) => void; outcomes: string[] }) {
  const [pending, setPending] = useState<{ leadId: string; phone: string; at: number; secs: number } | null>(null);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      try {
        const raw = sessionStorage.getItem("pending-call");
        if (!raw) return;
        const p = JSON.parse(raw);
        const secs = Math.round((Date.now() - p.at) / 1000);
        if (secs < 4) return;
        sessionStorage.removeItem("pending-call");
        setPending({ ...p, secs: Math.max(0, secs - 5) });
      } catch {}
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => { document.removeEventListener("visibilitychange", check); window.removeEventListener("focus", check); };
  }, []);
  if (!pending) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 p-4 backdrop-blur-sm sm:place-items-center" role="dialog" aria-label="Log this call">
      <form action={action} className="panel page-in w-full max-w-md space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="display text-[17px]">How did the call go?</h2>
          <button type="button" className="btn-ghost" onClick={() => setPending(null)}>Skip</button>
        </div>
        <p className="text-[12.5px] text-mute">Away for about {Math.floor(pending.secs / 60)}m {pending.secs % 60}s. Adjust the talk time if needed.</p>
        <input type="hidden" name="lead_id" value={pending.leadId} />
        <input type="hidden" name="phone" value={pending.phone} />
        <input type="hidden" name="direction" value="outgoing" />
        <div className="grid grid-cols-2 gap-2">
          {outcomes.map((o) => (
            <label key={o} className="chip cursor-pointer justify-center has-[:checked]:border-accent/60 has-[:checked]:bg-accent/15 has-[:checked]:text-ink">
              <input type="radio" name="outcome" value={o} className="sr-only" required />{o}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="pc_dur">Talk time (seconds)</label><input id="pc_dur" name="duration_seconds" type="number" min={0} defaultValue={pending.secs} className="input" /></div>
          <div><label className="label" htmlFor="pc_fu">Next follow-up</label><input id="pc_fu" name="next_followup_at" type="datetime-local" className="input" /></div>
        </div>
        <textarea name="notes" rows={2} className="input" placeholder="Notes (optional)" aria-label="Notes" />
        <button className="btn w-full" type="submit">Save call</button>
      </form>
    </div>
  );
}

// A submit button that shows it is working (AI answers and key tests can take up to a minute).
export function PendingButton({ children, pending, className = "btn", disabled }: { children: React.ReactNode; pending: string; className?: string; disabled?: boolean }) {
  const { pending: busy } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={disabled || busy} aria-busy={busy}>
      {busy ? <span className="inline-flex items-center gap-2"><span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />{pending}</span> : children}
    </button>
  );
}
