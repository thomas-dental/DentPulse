-- provider_contracts and provider_contract_attachments (20260813000001,
-- 20260813000002) were both given RLS policies of the form
-- `organization_id IN (SELECT id FROM organizations WHERE user_id = auth.uid())`.
-- That checks `organizations.user_id` — a single legacy owner column — not
-- org membership. Every other table in this app was moved off that pattern
-- in 20260121000002_fix_all_rls_policies_comprehensive.sql onto
-- `public.user_in_org(auth.uid(), organization_id)`, backed by `user_roles`
-- (the actual multi-member org model). Any user who isn't literally the
-- `organizations.user_id` value — i.e. every invited team member — was
-- silently blocked from reading OR writing these two tables: inserts from
-- the Contract Details tab's "Is New Contract" checkbox and Contract
-- Attachments upload would fail RLS, and the Contract History / Attachments
-- lists would always read back empty, with no obvious error surfaced in
-- the UI at the time. Bring both in line with the rest of the app.

DROP POLICY IF EXISTS "Users can view provider contracts for their organization" ON public.provider_contracts;
DROP POLICY IF EXISTS "Users can insert provider contracts for their organization" ON public.provider_contracts;
DROP POLICY IF EXISTS "Users can update provider contracts for their organization" ON public.provider_contracts;
DROP POLICY IF EXISTS "Users can delete provider contracts for their organization" ON public.provider_contracts;

CREATE POLICY "Users can view provider contracts for their organization"
    ON public.provider_contracts
    FOR SELECT
    USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can insert provider contracts for their organization"
    ON public.provider_contracts
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can update provider contracts for their organization"
    ON public.provider_contracts
    FOR UPDATE
    USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can delete provider contracts for their organization"
    ON public.provider_contracts
    FOR DELETE
    USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can view contract attachments for their organization" ON public.provider_contract_attachments;
DROP POLICY IF EXISTS "Users can insert contract attachments for their organization" ON public.provider_contract_attachments;
DROP POLICY IF EXISTS "Users can update contract attachments for their organization" ON public.provider_contract_attachments;
DROP POLICY IF EXISTS "Users can delete contract attachments for their organization" ON public.provider_contract_attachments;

CREATE POLICY "Users can view contract attachments for their organization"
    ON public.provider_contract_attachments
    FOR SELECT
    USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can insert contract attachments for their organization"
    ON public.provider_contract_attachments
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can update contract attachments for their organization"
    ON public.provider_contract_attachments
    FOR UPDATE
    USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));

CREATE POLICY "Users can delete contract attachments for their organization"
    ON public.provider_contract_attachments
    FOR DELETE
    USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), organization_id));
