// Alert kinds a person can choose to receive by email (the bell and push always show everything).
export const EMAIL_KINDS: [string, string][] = [
  ["lead_assigned", "A lead is given to me"], ["lead_unassigned", "A new lead is waiting to be assigned"], ["lead_new", "Every new lead I can see"],
  ["reenquiry", "My lead enquires again"], ["lead_rotated", "My lead moves to someone else"], ["followup_due", "Follow-up reminders"],
  ["task_due", "Task reminders"], ["task_assigned", "A task is given to me"], ["lead_invalid", "A lead arrives with a bad phone number"],
];
