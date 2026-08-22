-- Align with Pro GroupAccountMaster:
--   group_type 2 = Costs (COGS / clinical variable)
--   group_type 3 = Expenses (overhead / fixed)
-- Revenue (group_type 1) is reserved for Private / Membership / NHS when seeded later.

COMMENT ON COLUMN public.group_account_master.group_type IS
  '1 = Revenue, 2 = Costs (COGS), 3 = Expenses (overhead)';

-- Costs stay as type 2 (Materials … Therapist)
UPDATE public.group_account_master
SET group_type = 2
WHERE id IN (100, 101, 102, 103, 104);

-- Expenses move to type 3 (Staff … Other Fixed Costs)
UPDATE public.group_account_master
SET group_type = 3
WHERE id IN (105, 106, 107, 108);
