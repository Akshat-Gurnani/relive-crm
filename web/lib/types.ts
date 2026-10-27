export type Role = "admin" | "manager" | "agent" | "marketing" | "viewer";
export type Temperature = "hot" | "warm" | "cold";
export type ActivityType = "call" | "whatsapp" | "email" | "meeting" | "site_visit" | "note" | "re_enquiry" | "system";

export type Staff = { id: string; full_name: string; role: Role; team_id: string | null; active: boolean };
export type Stage = { id: string; name: string; kind: "open" | "won" | "lost"; position: number };
export type Named = { id: string; name: string };

export type LeadRow = {
  id: string;
  temperature: Temperature;
  assigned_to: string | null;
  next_followup_at: string | null;
  next_followup_note: string | null;
  last_activity_at: string;
  created_at: string;
  first_contacted_at: string | null;
  reenquiry_count: number;
  stage_id: string;
  stage: { name: string; kind: "open" | "won" | "lost" } | null;
  project: { name: string } | null;
  source: { name: string } | null;
  priority?: string;
  person: { full_name: string | null; phone_e164: string; city: string | null; email?: string | null };
};

export type LeadDetail = LeadRow & {
  provider: string | null;
  campaign_name: string | null; campaign_id: string | null;
  adset_name: string | null; adset_id: string | null;
  ad_name: string | null; ad_id: string | null;
  form_name: string | null; form_id: string | null;
  platform: string | null;
  vendor: { name: string } | null;
  budget_min: number | null;
  budget_max: number | null;
  unit_size: string | null;
  possession_pref: string | null;
  location_pref: string | null;
  lost_reason_id: string | null;
  lost_remarks: string | null;
  converted_at: string | null;
  lost_at: string | null;
  project_id: string | null;
  source_id: string | null;
  lead_type: string | null;
  budget_band: string | null;
  description: string | null;
  rotation_count: number;
  assigned_at: string | null;
  stage_changed_at: string;
  qualification: "Qualified" | "Non-qualified" | "Diverted" | null;
  property_type: string | null;
  bhk: string | null;
  interests: string[];
  tags: string[];
  legacy: Record<string, string> | null;
  import_ref: string | null;
};

export type Person = {
  id: string; full_name: string | null; phone_e164: string; city: string | null; email: string | null; alt_phone: string | null;
  company: string | null; designation: string | null; street: string | null; state: string | null; pincode: string | null;
  country: string | null; birthday: string | null; anniversary: string | null; spouse_birthday: string | null;
};

export type Task = {
  id: string; lead_id: string | null; title: string; category: string | null; assigned_to: string; created_by: string | null;
  due_at: string | null; status: "open" | "done"; completed_at: string | null; comments: string | null; created_at: string;
};

export type Call = {
  id: string; lead_id: string | null; agent_id: string | null; direction: "incoming" | "outgoing";
  status: "connected" | "not_connected" | "missed" | "rejected"; started_at: string; duration_seconds: number;
  provider: string | null; phone_e164: string | null; outcome: string | null; notes: string | null; recording_path: string | null;
};

export type Template = { id: string; channel: "whatsapp" | "email" | "sms"; name: string; subject: string | null; body: string; active: boolean };

export type DashboardStats = {
  role: Role;
  totals: { leads: number; contacted: number; converted: number; lost?: number; reenquiries?: number; avg_minutes_to_first_contact: number | null };
  pipeline_by_stage: { stage_id: string; leads: number }[];
  by_source: { source_id: string | null; leads: number; contacted: number; converted: number }[];
  by_project: { project_id: string | null; leads: number; contacted: number; converted: number }[];
  by_agent: { agent_id: string | null; leads: number; contacted: number; converted: number; avg_minutes: number | null }[];
  overdue_followups: number | null;
};
