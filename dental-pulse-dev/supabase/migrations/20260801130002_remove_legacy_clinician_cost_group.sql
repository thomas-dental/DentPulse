-- Clinician Cost is derived in reporting as:
--   Hygienist + Dentist + Therapist
--
-- Keeping a separate ClinicianCost master makes Profit Benchmark display a
-- duplicate row and allows the same account to be counted twice. Remove all
-- assignments first, then remove the obsolete master.

DELETE FROM public.group_account
WHERE group_account_master_id IN (
  SELECT id
  FROM public.group_account_master
  WHERE group_code = 'ClinicianCost'
);

DELETE FROM public.group_account_master
WHERE group_code = 'ClinicianCost';
