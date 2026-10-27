import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";

async function save(formData: FormData) {
  "use server";
  const pw = String(formData.get("password") ?? ""), again = String(formData.get("again") ?? "");
  if (pw.length < 8) redirect("/set-password?error=short");
  if (pw !== again) redirect("/set-password?error=mismatch");
  const sb = await createClient();
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) redirect("/set-password?error=failed");
  redirect("/");
}

const MSG: Record<string, string> = { short: "Use at least 8 characters.", mismatch: "The two passwords do not match.", failed: "Could not save the password. Ask for a new link." };

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
        <form action={save} className="space-y-4">
          <div><label className="label" htmlFor="password">New password</label><input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="input h-11" /></div>
          <div><label className="label" htmlFor="again">Repeat it</label><input id="again" name="again" type="password" required minLength={8} autoComplete="new-password" className="input h-11" /></div>
          <button className="btn h-11 w-full" type="submit">Save and continue</button>
        </form>
      </div>
    </main>
  );
}
