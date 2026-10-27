// Fills {{name}}, {{project}}, {{agent}}, {{agent_phone}} in a message template.
export function fillTemplate(body: string, v: Record<string, string | null | undefined>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (v[k] ?? "").toString());
}
export function waLink(phoneE164: string, text?: string) {
  return `https://wa.me/${phoneE164.replace("+", "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
export function mailLink(email: string | null | undefined, subject?: string | null, body?: string) {
  const p = new URLSearchParams();
  if (subject) p.set("subject", subject);
  if (body) p.set("body", body);
  const qs = p.toString().replace(/\+/g, "%20");
  return `mailto:${email ?? ""}${qs ? `?${qs}` : ""}`;
}
