-- Merge cash_ar and preparing_cashflow modules into a single cash_flow module
-- Update existing role_permissions records to use the new module key and card keys

-- 1. Migrate cash_ar:page_access → cash_flow:cash_ar_page
UPDATE public.role_permissions
SET module = 'cash_flow', card = 'cash_ar_page'
WHERE module = 'cash_ar' AND card = 'page_access';

-- 2. Migrate preparing_cashflow:page_access → cash_flow:preparing_cashflow_page
UPDATE public.role_permissions
SET module = 'cash_flow', card = 'preparing_cashflow_page'
WHERE module = 'preparing_cashflow' AND card = 'page_access';

-- 3. Migrate preparing_cashflow tab cards → cash_flow (card keys unchanged)
UPDATE public.role_permissions
SET module = 'cash_flow'
WHERE module = 'preparing_cashflow' AND card IN ('transactions_tab', 'statement_tab', 'archived_tab');
