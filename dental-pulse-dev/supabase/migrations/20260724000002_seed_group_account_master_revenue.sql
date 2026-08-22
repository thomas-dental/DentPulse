-- Pro GroupAccountMaster GroupType 1 = Revenue (Private / Membership / NHS)
INSERT INTO public.group_account_master (id, range_order, name, group_code, sector_id, group_type) VALUES
(1, 1, 'Private Income', 'PrivateIncome', 10, 1),
(2, 2, 'Membership Income', 'MembershipIncome', 10, 1),
(3, 3, 'NHS Income', 'NHSIncome', 10, 1)
ON CONFLICT (id) DO UPDATE SET
  range_order = EXCLUDED.range_order,
  name = EXCLUDED.name,
  group_code = EXCLUDED.group_code,
  sector_id = EXCLUDED.sector_id,
  group_type = EXCLUDED.group_type;
