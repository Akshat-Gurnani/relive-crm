-- Default reference data. Safe to edit later from the admin screens.
insert into stages (name, kind, position, is_default) values
  ('New', 'open', 1, true),
  ('Yet To Talk', 'open', 2, false),
  ('Follow-up', 'open', 3, false),
  ('Site Visit Scheduled', 'open', 4, false),
  ('Site Visit Done', 'open', 5, false),
  ('Negotiation', 'open', 6, false),
  ('Booked', 'won', 7, false),
  ('Lost', 'lost', 8, false)
on conflict (name) do nothing;

insert into sources (name) values
  ('Facebook Lead Ads'), ('Google Lead Forms'), ('IndiaMART'), ('99acres'), ('MagicBricks'),
  ('Housing.com'), ('Website'), ('Direct'), ('Reference'), ('Event'), ('Walk-in'), ('Other')
on conflict (name) do nothing;

insert into lost_reasons (name) values
  ('Not interested'), ('Budget mismatch'), ('Location mismatch'), ('Bought elsewhere'),
  ('Not reachable'), ('Wrong or invalid number'), ('Investor, bad timing'), ('Other')
on conflict (name) do nothing;
