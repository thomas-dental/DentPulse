-- Create sundries table to store Dentally sundry catalog items
-- Sundries are non-clinical items (products, consumables, etc.) that appear on invoices.
-- Synced from GET /v1/sundries as a non-date entity (full catalog fetch).

CREATE TABLE IF NOT EXISTS public.sundries (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id     UUID,
    integration_id UUID REFERENCES public.integrations(id),
    external_id BIGINT,
    name        TEXT,
    cost        NUMERIC(12,2) DEFAULT 0,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE(organization_id, external_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_sundries_organization_id ON public.sundries(organization_id);
CREATE INDEX IF NOT EXISTS idx_sundries_user_id         ON public.sundries(user_id);
CREATE INDEX IF NOT EXISTS idx_sundries_integration_id  ON public.sundries(integration_id);

-- Enable RLS
ALTER TABLE public.sundries ENABLE ROW LEVEL SECURITY;

-- RLS policy: users can read sundries for their organization
CREATE POLICY "Users can view sundries for their organization"
    ON public.sundries FOR SELECT
    USING (
        organization_id IN (
            SELECT ur.organization_id FROM public.user_roles ur WHERE ur.user_id = auth.uid()
        )
    );

COMMENT ON TABLE public.sundries IS 'Sundry catalog from Dentally — non-clinical items (products, consumables) that can appear on invoices';
COMMENT ON COLUMN public.sundries.external_id IS 'Dentally sundry ID from /v1/sundries';
COMMENT ON COLUMN public.sundries.cost IS 'Default cost/price of the sundry item';
