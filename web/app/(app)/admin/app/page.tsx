import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { Emoji, Page, PageHeader } from "@/components/ui";
import { apkUrl, type AppRelease } from "@/lib/app/releases";
import { setReleaseActive } from "./actions";
import { UploadApk } from "./upload";

export const dynamic = "force-dynamic";

export default async function PhoneApp() {
  const { sb, profile } = await getStaff();
  if (profile.role !== "admin") redirect("/admin");
  const { data } = await sb.from("app_releases").select("*").eq("platform", "android").order("version_code", { ascending: false });
  // RLS only returns active rows to the client; that is enough to list and switch off releases.
  const rows = (data ?? []) as AppRelease[];
  const next = (rows[0]?.version_code ?? 1) + 1;
  return (
    <>
      <PageHeader crumbs={[{ label: "Admin", href: "/admin" }, { label: "Phone app" }]} />
      <Page>
        <section className="panel p-5">
          <h2 className="panel-title mb-1 flex items-center gap-2"><Emoji name="call" size={15} />Publish an Android update</h2>
          <p className="mb-4 text-[12.5px] text-mute">Upload the new APK here. Every phone with the app checks when it opens, shows &quot;Update available&quot;, downloads it and opens the Android installer. Nobody needs to be sent a file. New staff download it from <span className="font-mono text-ink">relive-crm.vercel.app/download/android</span>.</p>
          <UploadApk nextCode={next} />
        </section>
        <section className="panel overflow-x-auto">
          <div className="panel-head"><h2 className="panel-title">Published versions</h2><span className="text-[12px] text-mute">The newest active one is offered to phones</span></div>
          <table className="w-full text-[13px]">
            <thead><tr><th className="th">Version</th><th className="th">Code</th><th className="th">Published</th><th className="th">Size</th><th className="th">What&apos;s new</th><th className="th" /></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.id} className="row">
                <td className="td font-medium">{r.version_name}{i === 0 && <span className="ml-2 text-[11px] text-ok">current</span>}{r.mandatory && <span className="ml-2 text-[11px] text-warn">must install</span>}</td>
                <td className="td text-mute">{r.version_code}</td>
                <td className="td text-mute">{dateTime(r.created_at)}</td>
                <td className="td text-mute">{r.size_bytes ? `${Math.round(r.size_bytes / 1048576)} MB` : "–"}</td>
                <td className="td max-w-[320px] text-mute">{r.notes ?? "–"}</td>
                <td className="td whitespace-nowrap"><a href={apkUrl(r.storage_path)} className="btn-quiet mr-2 h-8 px-3 leading-8">Download</a>
                  <form action={setReleaseActive} className="inline"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value="false" /><button className="btn-quiet h-8" type="submit">Withdraw</button></form></td>
              </tr>
            ))}{rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-mute">Nothing published yet.</td></tr>}</tbody>
          </table>
          <p className="border-t border-line/10 px-4 py-2.5 text-[12px] text-mute">Withdraw a bad build and phones fall back to offering the previous version. Phones that already installed it keep it until a higher version is published.</p>
        </section>
      </Page>
    </>
  );
}
