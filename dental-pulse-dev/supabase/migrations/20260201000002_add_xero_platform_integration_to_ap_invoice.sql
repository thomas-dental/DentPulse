-- Add platform integration columns to accounts_payable_invoice for Xero-synced invoices
-- Enables linking synced Xero invoices to the correct integration and upsert by xero_invoice_id

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'platform_integration_id'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice
        ADD COLUMN platform_integration_id UUID REFERENCES public.platform_integrations(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added platform_integration_id to accounts_payable_invoice';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'accounts_payable_invoice'
        AND column_name = 'platform_integration_organization_id'
    ) THEN
        ALTER TABLE public.accounts_payable_invoice
        ADD COLUMN platform_integration_organization_id UUID REFERENCES public.platform_integration_organizations(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added platform_integration_organization_id to accounts_payable_invoice';
    END IF;
END $$;

-- Unique constraint for upserting Xero invoices (one xero_invoice_id per org + integration org)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_invoice_xero_upsert
ON public.accounts_payable_invoice (organization_id, platform_integration_organization_id, xero_invoice_id)
WHERE xero_invoice_id IS NOT NULL AND platform_integration_organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ap_invoice_platform_integration_id ON public.accounts_payable_invoice(platform_integration_id);
CREATE INDEX IF NOT EXISTS idx_ap_invoice_platform_integration_org_id ON public.accounts_payable_invoice(platform_integration_organization_id);

COMMENT ON COLUMN public.accounts_payable_invoice.platform_integration_id IS 'Platform integration (e.g. Xero) this invoice was synced from';
COMMENT ON COLUMN public.accounts_payable_invoice.platform_integration_organization_id IS 'Platform tenant/org (e.g. Xero tenant) this invoice belongs to';
