-- Create cashflow_statement_archive table to store archived CashflowReportVM
CREATE TABLE IF NOT EXISTS public.cashflow_statement_archive (
    id BIGSERIAL PRIMARY KEY,

    -- Organization scope
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Archived period
    start_date DATE,
    end_date DATE,

    -- Serialized CashflowReportVM JSON (same shape as cashflow-report Edge Function)
    download_data JSONB NOT NULL,

    -- Download format (1 = Excel, 2 = PDF, etc. – aligns with Version 2.0 semantics)
    download_format INTEGER,

    -- Audit
    created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);

-- Indexes to speed up archive queries
CREATE INDEX IF NOT EXISTS idx_cashflow_statement_archive_org_created
    ON public.cashflow_statement_archive (organization_id, created_date DESC);

CREATE INDEX IF NOT EXISTS idx_cashflow_statement_archive_period
    ON public.cashflow_statement_archive (organization_id, start_date, end_date);

-- Enable RLS
ALTER TABLE public.cashflow_statement_archive ENABLE ROW LEVEL SECURITY;

-- RLS: users can see archives for their organization
DROP POLICY IF EXISTS "Users can view cashflow archives in their org" ON public.cashflow_statement_archive;
CREATE POLICY "Users can view cashflow archives in their org"
ON public.cashflow_statement_archive FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

-- RLS: users can insert archives for their organization
DROP POLICY IF EXISTS "Users can insert cashflow archives in their org" ON public.cashflow_statement_archive;
CREATE POLICY "Users can insert cashflow archives in their org"
ON public.cashflow_statement_archive FOR INSERT
WITH CHECK (public.user_in_org(auth.uid(), organization_id));

