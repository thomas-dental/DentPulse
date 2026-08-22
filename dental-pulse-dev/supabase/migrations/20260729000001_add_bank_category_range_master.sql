-- Add "Bank" category range bucket (CashOrBank) — matches fe-dentpulse-live's
-- Setup Categories > Cashflow tab "Bank" multi-select of Chart of Accounts.
INSERT INTO public.category_range_master (id, range_order, code, name, range_group, range_sub_group) VALUES
(14, 1, 'CashOrBank', 'Bank', 'Bank', 'Bank')
ON CONFLICT (id) DO NOTHING;
