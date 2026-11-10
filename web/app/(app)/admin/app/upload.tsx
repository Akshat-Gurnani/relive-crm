"use client";

import { useState } from "react";
import { publishRelease, startUpload } from "./actions";

// Reads "relive-crm-1.2.0-3.apk" style names so the version fields fill themselves in.
const fromName = (n: string) => { const m = n.match(/(\d+\.\d+(?:\.\d+)?)-(\d+)\.apk$/i); return m ? { name: m[1], code: m[2] } : null; };

export function UploadApk({ nextCode }: { nextCode: number }) {
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState(String(nextCode));
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [state, setState] = useState<{ busy?: string; error?: string; done?: string }>({});

  const pick = (f: File | null) => {
    setFile(f); setState({});
    const v = f ? fromName(f.name) : null;
    if (v) { setName(v.name); setCode(v.code); }
  };

  const publish = async () => {
    if (!file) return;
    const vc = Number(code);
    setState({ busy: "Preparing…" });
    const s = await startUpload(vc, name.trim());
    if (s.error || !s.signedUrl || !s.path) return setState({ error: s.error ?? "Could not prepare the upload." });
    setState({ busy: `Uploading ${Math.round(file.size / 1048576)} MB…` });
    const res = await fetch(s.signedUrl, { method: "PUT", headers: { "content-type": "application/vnd.android.package-archive", "x-upsert": "true", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" }, body: file }).catch(() => null);
    if (!res || !res.ok) return setState({ error: `Upload failed${res ? ` (${res.status})` : ""}. Check the file is under 50 MB and try again.` });
    setState({ busy: "Publishing…" });
    const p = await publishRelease({ path: s.path, versionCode: vc, versionName: name.trim(), notes, mandatory });
    if (p.error) return setState({ error: p.error });
    setState({ done: `Version ${name.trim()} is published. Phones will offer it the next time the app opens.` });
    setFile(null); setNotes(""); setMandatory(false);
  };

  return (
    <div className="space-y-3">
      <input type="file" accept=".apk,application/vnd.android.package-archive" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="block text-[13px]" aria-label="APK file" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className="label" htmlFor="vname">Version name</label><input id="vname" value={name} onChange={(e) => setName(e.target.value)} placeholder="1.2.0" className="input h-9" /></div>
        <div><label className="label" htmlFor="vcode">Version code</label><input id="vcode" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="input h-9" inputMode="numeric" /></div>
        <label className="mt-6 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="h-4 w-4" />Must install (no &quot;Later&quot;)</label>
      </div>
      <div><label className="label" htmlFor="vnotes">What&apos;s new (shown on the phone)</label><textarea id="vnotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input" placeholder="Faster call logging. New Reports tab." /></div>
      <button type="button" onClick={publish} disabled={!file || !name || !code || !!state.busy} className="btn h-10">{state.busy ?? "Upload and publish"}</button>
      {state.error && <p className="text-[13px] text-bad">{state.error}</p>}
      {state.done && <p className="text-[13px] text-ok">{state.done}</p>}
      <p className="text-[12px] text-mute">The version code must match the one built into the APK, or phones will keep offering the update. APKs built for you are named <span className="font-mono">relive-crm-NAME-CODE.apk</span>, so these fields fill in by themselves.</p>
    </div>
  );
}
