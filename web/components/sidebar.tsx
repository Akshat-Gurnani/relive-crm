"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Avatar, Emoji, type EmojiName } from "@/components/ui";

type Item = { href: string; label: string; emoji: EmojiName; mobile?: boolean };

export function Sidebar({ name, role, items, views, unread }: { name: string; role: string; items: Item[]; views: Item[]; unread: number }) {
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const view = path === "/leads" ? sp.get("view") ?? "" : null;
  const isCurrent = (href: string) => {
    if (href.startsWith("/leads?view=")) return view === href.split("=")[1];
    if (href === "/leads") return path.startsWith("/leads") && !view;
    if (href === "/admin") return path.startsWith("/admin") && !path.startsWith("/admin/insights");
    return href === "/" ? path === "/" : path.startsWith(href);
  };
  const search = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    router.push(q ? `/leads?q=${encodeURIComponent(q)}` : "/leads");
  };
  const bell = (
    <Link href="/notifications" className="relative grid h-9 w-9 place-items-center rounded-full transition hover:bg-white/[.06]" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
      <Emoji name="bell" size={18} />
      {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white shadow-[0_0_10px_rgb(var(--accent))]">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
  return (
    <>
      {/* phone: top bar */}
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line/[.08] bg-paper/70 px-3 py-2 backdrop-blur-2xl md:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white.png" alt="Relive Solutions" className="h-9 w-auto" />
        <form onSubmit={search} className="min-w-0 flex-1"><input name="q" className="input h-9 rounded-full" placeholder="Search leads" aria-label="Search leads" /></form>
        {bell}
        <details className="relative">
          <summary className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-full hover:bg-white/[.06]" aria-label="More"><Avatar name={name} size={28} /></summary>
          <div className="glass page-in absolute right-0 z-30 mt-2 flex w-56 flex-col rounded-xl p-1.5">
            {items.filter((i) => !i.mobile).map((l) => <Link key={l.href} href={l.href} className="menu-item flex items-center gap-2"><Emoji name={l.emoji} size={14} />{l.label}</Link>)}
            <form action="/signout" method="post"><button className="menu-item w-full text-left" type="submit">Sign out</button></form>
          </div>
        </details>
      </header>

      {/* phone: bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line/[.08] bg-paper/80 px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 backdrop-blur-2xl md:hidden" aria-label="Main">
        {items.filter((i) => i.mobile).map((l) => (
          <Link key={l.href} href={l.href} className={`flex min-w-14 flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[10.5px] font-semibold transition ${isCurrent(l.href) ? "text-ink" : "text-ink/50"}`} aria-current={isCurrent(l.href) ? "page" : undefined}>
            <Emoji name={l.emoji} size={20} className={isCurrent(l.href) ? "scale-110 transition" : "opacity-70 transition"} />{l.label}
            {isCurrent(l.href) && <span className="h-1 w-1 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent))]" />}
          </Link>
        ))}
      </nav>

      {/* desktop: sidebar */}
      <aside className="hidden flex-col border-r border-line/[.08] bg-white/[.02] backdrop-blur-2xl backdrop-saturate-150 md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0">
        <div className="flex items-center gap-3 px-4 pb-3 pt-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white.png" alt="Relive Solutions" className="h-12 w-auto drop-shadow-[0_0_18px_rgb(var(--accent)/.35)]" />
          <span className="eyebrow mt-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[9.5px] text-accent-2">CRM</span>
          <span className="ml-auto">{bell}</span>
        </div>
        <form onSubmit={search} className="px-3 pb-3"><input name="q" className="input h-9 rounded-full" placeholder="Search name, phone or owner" aria-label="Search leads" /></form>
        <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
          {items.map((l) => (
            <Link key={l.href} href={l.href} className="navlink" aria-current={isCurrent(l.href) ? "page" : undefined}><Emoji name={l.emoji} />{l.label}</Link>
          ))}
        </nav>
        {views.length > 0 && (
          <div className="mt-5 px-2">
            <div className="eyebrow px-2 pb-1.5">Lead views</div>
            <div className="flex flex-col gap-0.5">
              {views.map((l) => <Link key={l.href} href={l.href} className="navlink" aria-current={isCurrent(l.href) ? "page" : undefined}><Emoji name={l.emoji} />{l.label}</Link>)}
            </div>
          </div>
        )}
        <div className="mt-auto flex items-center gap-2.5 border-t border-line/[.08] px-4 py-3">
          <Avatar name={name} size={30} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium">{name}</div>
            <div className="text-2xs capitalize text-mute">{role}</div>
          </div>
          <form action="/signout" method="post"><button className="btn-ghost h-7 px-2 text-[12px]" type="submit">Sign out</button></form>
        </div>
      </aside>
    </>
  );
}
