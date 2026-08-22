-- Seed cost + expense group masters (Pro: GroupType 2 = Costs, 3 = Expenses)
INSERT INTO public.group_account_master (id, range_order, name, group_code, sector_id, group_type) VALUES
(100, 1, 'Materials', 'Materials', 10, 2),
(101, 2, 'Lab fees', 'LabFees', 10, 2),
(102, 3, 'Hygienist', 'Hygienist', 10, 2),
(103, 4, 'Dentist', 'Dentist', 10, 2),
(104, 5, 'Therapist', 'Therapist', 10, 2),
(105, 6, 'Staff', 'Staff', 10, 3),
(106, 7, 'Marketing', 'Marketing', 10, 3),
(107, 8, 'Operating lease', 'OperatingLease', 10, 3),
(108, 9, 'Other Fixed Costs', 'OtherFixedCosts', 10, 3)
ON CONFLICT (id) DO NOTHING;
