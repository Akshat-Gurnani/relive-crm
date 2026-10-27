import type { NormalisedLead } from "./types";

// Google Ads lead form extensions (Search, YouTube, Discovery / Demand Gen, Performance Max).
// Google posts each lead to our URL as JSON, with the key we chose in the form settings as google_key.
// Docs: developers.google.com/google-ads/webhook/docs/implementation
export type GoogleAdsLead = {
  lead_id?: string;
  google_key?: string;
  user_column_data?: { column_id?: string; column_name?: string; string_value?: string }[];
  form_id?: number | string;
  campaign_id?: number | string;
  adgroup_id?: number | string;
  creative_id?: number | string;
  asset_group_id?: number | string;
  gcl_id?: string;
  is_test?: boolean;
  lead_submit_time?: string;
  lead_source?: string;
};

const s = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));

export function mapGoogleAdsLead(p: GoogleAdsLead): NormalisedLead {
  let first = "", last = "";
  const out: NormalisedLead = { provider: "google_ads", external_id: String(p.lead_id), answers: {} };
  for (const c of p.user_column_data ?? []) {
    const v = (c.string_value ?? "").trim();
    if (!v) continue;
    switch ((c.column_id ?? "").toUpperCase()) {
      case "FULL_NAME": out.name = v; break;
      case "FIRST_NAME": first = v; break;
      case "LAST_NAME": last = v; break;
      case "PHONE_NUMBER": case "PHONE_NUMBER_VERIFIED": out.phone ??= v; break;
      case "WORK_PHONE": out.phone ??= v; break;
      case "EMAIL": case "WORK_EMAIL": out.email ??= v; break;
      case "CITY": out.city = v; break;
      default: out.answers![(c.column_name || c.column_id || "answer").toString()] = v;
    }
  }
  if (!out.name && (first || last)) out.name = `${first} ${last}`.trim();
  // Google sends IDs only; names are filled from the endpoint (project / campaign label) in the CRM.
  out.campaign_id = s(p.campaign_id);
  out.adset_id = s(p.adgroup_id ?? p.asset_group_id);
  out.ad_id = s(p.creative_id);
  out.form_id = s(p.form_id);
  out.received_at = p.lead_submit_time;
  out.is_test = !!p.is_test;
  out.platform = p.gcl_id ? "google" : undefined;
  return out;
}
