-- Setup Categories consolidation: the "Revenue & Provider Income" and
-- "Expense Accounts" tabs are being removed in favor of the Profit
-- (Revenue & Costs) tab. Clinician Cost previously lived only as a
-- practice_locations column and has no group_account_master row yet — add
-- it as its own Cost-group card alongside Materials/LabFees/Hygienist/
-- Dentist/Therapist (ids 100-108 already taken).
-- (MOS Income already exists as id 4, seeded by 20260727000002_create_revenue_settings.sql.)

INSERT INTO public.group_account_master (id, range_order, name, group_code, sector_id, group_type) VALUES
(109, 10, 'Clinician Cost', 'ClinicianCost', 10, 2)
ON CONFLICT (id) DO NOTHING;
