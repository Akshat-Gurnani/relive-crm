// One lead in a common shape, whatever platform it came from. ingest_lead() in the database takes this.
export type NormalisedLead = {
  provider: "meta" | "google_ads" | "linkedin" | "google_forms" | "website" | "webhook" | "other";
  external_id: string;
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  answer?: string;
  answers?: Record<string, string>;
  received_at?: string;
  campaign_id?: string; campaign_name?: string;
  adset_id?: string; adset_name?: string;
  ad_id?: string; ad_name?: string;
  form_id?: string; form_name?: string;
  platform?: string;
  is_test?: boolean;
  page_id?: string;
  raw?: unknown;
};
