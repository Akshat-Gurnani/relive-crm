import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";

const MSG: Record<string, string> = {
  short: "Use at least 8 characters.",
  mismatch: "The two passwords do not match.",
  failed: "Could not save the password. Try once more; if it fails again, ask for a new link.",
};

// The form posts to /auth/set-password (a route handler) as a normal page submit.
export default async function SetPassword({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?error=expired");
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="glass page-in w-full max-w-sm rounded-2xl p-8">
        <span className="eyebrow text-accent-2">Welcome</span>
        <h1 className="display mt-1 text-[28px]">Set your password</h1>
        <p className="mb-6 mt-1 text-mute">{user.email}</p>
        {error && <div className="mb-4"><Notice>{MSG[error] ?? "Something went wrong."}</Notice></div>}
        <form id="setpw" method="post" action="/auth/set-password" className="space-y-4">
          <div><label className="label" htmlFor="password">New password</label><input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="input h-11" /></div>
          <div><label className="label" htmlFor="again">Repeat it</label><input id="again" name="again" type="password" required minLength={8} autoComplete="new-password" className="input h-11" /></div>
          <button id="setpw-btn" className="btn h-11 w-full" type="submit">Save and continue</button>
          <p className="text-center text-[12px] text-mute">After saving you go straight to your dashboard. Sign in next time with your email and this password.</p>
        </form>
        {/* Shows that the tap registered and stops double submits. The form still works without it. */}
        <script dangerouslySetInnerHTML={{ __html: `document.getElementById("setpw").addEventListener("submit",function(){var b=document.getElementById("setpw-btn");setTimeout(function(){b.disabled=true;b.textContent="Saving…";},0);});` }} />
      </div>
    </main>
  );
}
