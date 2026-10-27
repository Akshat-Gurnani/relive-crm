import Link from "next/link";
import type { ReactNode } from "react";
import type { Temperature } from "@/lib/types";

/* Vector emoji from alohe/emojicloud (MIT), vendored in /public/emoji. */
export type EmojiName =
  | "compass" | "bell" | "house" | "glasses" | "wave" | "zap" | "clock" | "recycle" | "thinking" | "fire" | "star" | "cold"
  | "call" | "chat" | "envelope" | "handshake" | "writing" | "pin" | "robot" | "point-right" | "mailbox" | "party"
  | "calendar" | "sparkles" | "crystal" | "check" | "gem";

export function Emoji({ name, size = 16, className = "" }: { name: EmojiName; size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/emoji/${name}.svg`} alt="" width={size} height={size} className={`inline-block shrink-0 ${className}`} aria-hidden />;
}

const TEMP: Record<Temperature, { emoji: EmojiName; tone: string }> = {
  hot: { emoji: "fire", tone: "text-bad" },
  warm: { emoji: "star", tone: "text-warn" },
  cold: { emoji: "cold", tone: "text-mute" },
};
export function TempBadge({ t }: { t: Temperature }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-medium capitalize ${TEMP[t].tone}`}>
      <Emoji name={TEMP[t].emoji} size={13} />{t}
    </span>
  );
}

export function StageBadge({ name, kind }: { name: string; kind: "open" | "won" | "lost" }) {
  const dot = kind === "won" ? "bg-won shadow-[0_0_8px_rgb(var(--won))]" : kind === "lost" ? "bg-faint" : "bg-accent shadow-[0_0_8px_rgb(var(--accent))]";
  const text = kind === "lost" ? "text-mute" : "text-ink";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line/10 bg-white/[.04] px-2.5 py-0.5 text-[12px] font-medium ${text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{name}
    </span>
  );
}

export function Avatar({ name, size = 28 }: { name: string | null | undefined; size?: number }) {
  const label = (name || "?").trim();
  const initials = label.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  // Stable warm hue per name so the same person always looks the same.
  let h = 0; for (const c of label) h = (h * 31 + c.charCodeAt(0)) % 360;
  // Alternate between the brand navy and coral families.
  const hue = h % 2 ? 222 + (h % 18) : 8 + (h % 18);
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white/90 ring-1 ring-white/10 after:content-[attr(data-initials)]"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${hue} 50% 26%))` }}
      data-initials={initials}
      aria-hidden
    />
  );
}

/* Page header in the Frappe style: breadcrumbs on the left, actions on the right, hairline under. */
export function PageHeader({ crumbs, children }: { crumbs: { label: string; href?: string }[]; children?: ReactNode }) {
  return (
    <header className="sticky top-[53px] z-10 flex min-h-14 md:top-0 flex-wrap items-center justify-between gap-3 border-b border-line/[.08] bg-paper/50 px-5 py-2.5 backdrop-blur-2xl backdrop-saturate-150 md:px-8">
      <h1 className="display flex min-w-0 items-center gap-2 text-[20px]">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span className="text-faint">/</span>}
            {c.href ? <Link href={c.href} className="text-mute hover:text-ink">{c.label}</Link> : <span className="truncate">{c.label}</span>}
          </span>
        ))}
      </h1>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="stagger space-y-5 px-5 py-6 md:px-8">{children}</div>;
}

export function Notice({ tone = "bad", children }: { tone?: "bad" | "warn" | "ok"; children: ReactNode }) {
  const c = tone === "bad" ? "border-bad/30 bg-bad/10 text-bad" : tone === "ok" ? "border-won/30 bg-won/10 text-won" : "border-warn/30 bg-warn/10 text-warn";
  return <div role="status" className={`rounded-xl border px-3 py-2 text-[13px] ${c}`}>{children}</div>;
}

export function Empty({ emoji, children }: { emoji: EmojiName; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-mute">
      <Emoji name={emoji} size={28} className="opacity-90" />
      <p className="text-[13px]">{children}</p>
    </div>
  );
}
