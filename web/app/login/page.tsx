import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Emoji, Notice, type EmojiName } from "@/components/ui";

const MESSAGES: Record<string, string> = {
  invalid: "Email or password is incorrect.",
  expired: "That link has expired or was already used. Ask an admin for a new one.",
  "no-access": "Your account is signed in but has no active staff profile. Ask an admin to add you.",
};

async function login(formData: FormData) {
  "use server";
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
  if (error) redirect("/login?error=invalid");
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="grid min-h-screen md:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line/[.08] bg-white/[.015] p-10 md:flex">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white.png" alt="Relive Solutions" className="h-20 w-auto self-start drop-shadow-[0_0_30px_rgb(var(--accent)/.35)]" />
        <div className="page-in max-w-md">
          <p className="display text-[40px] leading-[1.1]">Every enquiry, every call, <span className="grad">every site visit.</span></p>
          <p className="mt-4 text-[14px] leading-relaxed text-mute">Leads from every form land here, get assigned in rotation, and stay on someone&apos;s follow-up list until they buy or say no.</p>
        </div>
        <div className="stagger grid grid-cols-3 gap-3 text-[12px] text-mute">
          {[["zap", "Speed to first call"], ["recycle", "Re-enquiries kept"], ["calendar", "Site visits tracked"]].map(([e, t]) => (
            <div key={t} className="panel flex items-center gap-2 px-3 py-2.5"><Emoji name={e as EmojiName} size={18} />{t}</div>
          ))}
        </div>
      </section>
      <section className="flex flex-col justify-center px-6 py-12">
        <div className="glass page-in mx-auto w-full max-w-sm rounded-2xl p-8">
          <span className="eyebrow text-accent-2">Employee login</span>
          <h1 className="display mt-1 text-[28px]">Sign in</h1>
          <p className="mb-6 mt-1 text-mute">Use your work email.</p>
          {error && <div className="mb-4"><Notice>{MESSAGES[error] ?? "Could not sign in."}</Notice></div>}
          <form action={login} className="space-y-4">
            <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="username" className="input h-11" /></div>
            <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" required autoComplete="current-password" className="input h-11" /></div>
            <button className="btn h-11 w-full" type="submit">Sign in</button>
          </form>
          {error === "no-access" && (
            <form action="/signout" method="post" className="mt-3"><button className="text-[13px] text-mute underline" type="submit">Sign out</button></form>
          )}
        </div>
      </section>
    </main>
  );
}
