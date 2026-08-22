-- ============================================
-- Ensure RLS policies exist for platform_integration_invoices
-- and platform_integration_invoice_line_items.
-- Uses DROP IF EXISTS + CREATE to be idempotent.
-- ============================================

-- Invoices
ALTER TABLE public.platform_integration_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view platform integration invoices in their org" ON public.platform_integration_invoices;
CREATE POLICY "Users can view platform integration invoices in their org"
ON public.platform_integration_invoices FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert platform integration invoices in their org" ON public.platform_integration_invoices;
CREATE POLICY "Users can insert platform integration invoices in their org"
ON public.platform_integration_invoices FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update platform integration invoices in their org" ON public.platform_integration_invoices;
CREATE POLICY "Users can update platform integration invoices in their org"
ON public.platform_integration_invoices FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete platform integration invoices in their org" ON public.platform_integration_invoices;
CREATE POLICY "Users can delete platform integration invoices in their org"
ON public.platform_integration_invoices FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));

-- Invoice Line Items
ALTER TABLE public.platform_integration_invoice_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view platform integration invoice line items" ON public.platform_integration_invoice_line_items;
CREATE POLICY "Users can view platform integration invoice line items"
ON public.platform_integration_invoice_line_items FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can insert platform integration invoice line items" ON public.platform_integration_invoice_line_items;
CREATE POLICY "Users can insert platform integration invoice line items"
ON public.platform_integration_invoice_line_items FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can update platform integration invoice line items" ON public.platform_integration_invoice_line_items;
CREATE POLICY "Users can update platform integration invoice line items"
ON public.platform_integration_invoice_line_items FOR UPDATE
USING (public.user_in_org(auth.uid(), organization_id))
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can delete platform integration invoice line items" ON public.platform_integration_invoice_line_items;
CREATE POLICY "Users can delete platform integration invoice line items"
ON public.platform_integration_invoice_line_items FOR DELETE
USING (public.user_in_org(auth.uid(), organization_id));
