import Link from "next/link";
import { latestAndroid } from "@/lib/app/releases";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Shown right after someone sets their password: confirms it, then offers the web CRM and the Android app.
export default async function Welcome({ searchParams }: { searchParams: Promise<{ app?: string }> }) {
  const sb = await createClient();
  const [{ data: { user } }, app, sp] = await Promise.all([sb.auth.getUser(), latestAndroid(), searchParams]);
  const mb = app?.size_bytes ? `${Math.round(app.size_bytes / 1048576)} MB` : null;
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="glass page-in w-full max-w-sm rounded-2xl p-8">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ok/15 text-[24px] text-ok" aria-hidden>✓</div>
        <h1 className="display text-[26px]">Password saved</h1>
        <p className="mt-1 text-mute">{user?.email ? <>Sign in next time with <span className="text-ink">{user.email}</span> and the password you just chose.</> : "Sign in next time with your email and the password you just chose."}</p>

        <div className="mt-7 space-y-3">
          <Link href="/" className="btn flex h-12 w-full items-center justify-center text-[15px]">Open Relive CRM</Link>
          <p className="text-center text-[12px] text-mute">Works on any phone or computer browser. Bookmark it: <span className="text-ink">relive-crm.vercel.app</span></p>
        </div>

        <div className="mt-6 border-t border-line/10 pt-6">
          <h2 className="text-[15px] font-semibold">Android phone?</h2>
          {app ? <>
            <p className="mt-1 text-[13px] text-mute">Get the Relive CRM app. It logs your calls automatically and reminds you of follow-ups. Version {app.version_name}{mb ? `, ${mb}` : ""}.</p>
            <a href="/download/android" className="btn-quiet mt-3 flex h-11 w-full items-center justify-center">Download the Android app</a>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12px] text-mute">
              <li>Open the downloaded file.</li>
              <li>If Android asks, allow your browser to install apps, then tap Install.</li>
              <li>Sign in with the same email and password.</li>
            </ol>
            <p className="mt-2 text-[12px] text-mute">Updates arrive inside the app; you will not need to download it again.</p>
          </> : <p className="mt-1 text-[13px] text-mute">{sp.app === "none" ? "The Android app has not been published yet. " : ""}The Android app is coming soon. Use the web CRM above in the meantime.</p>}
        </div>
      </div>
    </main>
  );
}
