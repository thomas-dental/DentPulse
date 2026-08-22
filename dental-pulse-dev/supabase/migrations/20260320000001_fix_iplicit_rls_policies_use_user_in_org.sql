-- Fix RLS policies on older iplicit tables to use the SECURITY DEFINER
-- function public.user_in_org() instead of inline subqueries against user_roles.
-- The inline subquery pattern fails when user_roles has RLS enabled,
-- because the subquery runs as the authenticated user (not SECURITY DEFINER).
-- Newer iplicit tables (sales_invoices, purchase_invoices, etc.) already use user_in_org().

-- 1. iplicit_chart_of_accounts
DROP POLICY IF EXISTS iplicit_chart_of_accounts_org_isolation ON public.iplicit_chart_of_accounts;

CREATE POLICY "Users can view iplicit chart of accounts in their org"
  ON public.iplicit_chart_of_accounts FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can insert iplicit chart of accounts in their org"
  ON public.iplicit_chart_of_accounts FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can update iplicit chart of accounts in their org"
  ON public.iplicit_chart_of_accounts FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can delete iplicit chart of accounts in their org"
  ON public.iplicit_chart_of_accounts FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

-- 2. iplicit_coa_account_groups
DROP POLICY IF EXISTS iplicit_coa_account_groups_org_isolation ON public.iplicit_coa_account_groups;

CREATE POLICY "Users can view iplicit coa account groups in their org"
  ON public.iplicit_coa_account_groups FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can insert iplicit coa account groups in their org"
  ON public.iplicit_coa_account_groups FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can update iplicit coa account groups in their org"
  ON public.iplicit_coa_account_groups FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can delete iplicit coa account groups in their org"
  ON public.iplicit_coa_account_groups FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

-- 3. iplicit_balance_sheet
DROP POLICY IF EXISTS iplicit_balance_sheet_org_isolation ON public.iplicit_balance_sheet;

CREATE POLICY "Users can view iplicit balance sheet in their org"
  ON public.iplicit_balance_sheet FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can insert iplicit balance sheet in their org"
  ON public.iplicit_balance_sheet FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can update iplicit balance sheet in their org"
  ON public.iplicit_balance_sheet FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can delete iplicit balance sheet in their org"
  ON public.iplicit_balance_sheet FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

-- 4. iplicit_profit_loss
DROP POLICY IF EXISTS iplicit_profit_loss_org_isolation ON public.iplicit_profit_loss;

CREATE POLICY "Users can view iplicit profit loss in their org"
  ON public.iplicit_profit_loss FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can insert iplicit profit loss in their org"
  ON public.iplicit_profit_loss FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can update iplicit profit loss in their org"
  ON public.iplicit_profit_loss FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can delete iplicit profit loss in their org"
  ON public.iplicit_profit_loss FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

-- 5. iplicit_suppliers
DROP POLICY IF EXISTS iplicit_suppliers_org_isolation ON public.iplicit_suppliers;

CREATE POLICY "Users can view iplicit suppliers in their org"
  ON public.iplicit_suppliers FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can insert iplicit suppliers in their org"
  ON public.iplicit_suppliers FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can update iplicit suppliers in their org"
  ON public.iplicit_suppliers FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can delete iplicit suppliers in their org"
  ON public.iplicit_suppliers FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

-- 6. iplicit_products
DROP POLICY IF EXISTS iplicit_products_org_isolation ON public.iplicit_products;

CREATE POLICY "Users can view iplicit products in their org"
  ON public.iplicit_products FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can insert iplicit products in their org"
  ON public.iplicit_products FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can update iplicit products in their org"
  ON public.iplicit_products FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can delete iplicit products in their org"
  ON public.iplicit_products FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));
