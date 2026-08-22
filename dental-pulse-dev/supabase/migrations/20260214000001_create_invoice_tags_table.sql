-- Create invoice_tags table for tagging invoices
CREATE TABLE IF NOT EXISTS public.invoice_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#6366f1', -- Default indigo color
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT invoice_tags_name_org_location_unique UNIQUE (organization_id, location_id, name)
);

-- Create junction table for many-to-many relationship
CREATE TABLE IF NOT EXISTS public.invoice_tag_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES public.accounts_payable_invoice(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.invoice_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT invoice_tag_assignment_unique UNIQUE (invoice_id, tag_id)
);

-- Create indexes for invoice_tags
CREATE INDEX idx_invoice_tags_organization ON public.invoice_tags(organization_id);
CREATE INDEX idx_invoice_tags_location ON public.invoice_tags(location_id);
CREATE INDEX idx_invoice_tags_name ON public.invoice_tags(name);

-- Create indexes for invoice_tag_assignments
CREATE INDEX idx_invoice_tag_assignments_invoice ON public.invoice_tag_assignments(invoice_id);
CREATE INDEX idx_invoice_tag_assignments_tag ON public.invoice_tag_assignments(tag_id);

-- Enable RLS
ALTER TABLE public.invoice_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_tag_assignments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for invoice_tags
CREATE POLICY "Users can view tags in their organization"
ON public.invoice_tags FOR SELECT
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can create tags in their organization"
ON public.invoice_tags FOR INSERT
TO authenticated
WITH CHECK (
    organization_id IN (
        SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can update tags in their organization"
ON public.invoice_tags FOR UPDATE
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can delete tags in their organization"
ON public.invoice_tags FOR DELETE
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
);

-- RLS Policies for invoice_tag_assignments
CREATE POLICY "Users can view tag assignments for invoices in their organization"
ON public.invoice_tag_assignments FOR SELECT
TO authenticated
USING (
    invoice_id IN (
        SELECT id FROM public.accounts_payable_invoice
        WHERE organization_id IN (
            SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
        )
    )
);

CREATE POLICY "Users can create tag assignments for invoices in their organization"
ON public.invoice_tag_assignments FOR INSERT
TO authenticated
WITH CHECK (
    invoice_id IN (
        SELECT id FROM public.accounts_payable_invoice
        WHERE organization_id IN (
            SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
        )
    )
);

CREATE POLICY "Users can delete tag assignments for invoices in their organization"
ON public.invoice_tag_assignments FOR DELETE
TO authenticated
USING (
    invoice_id IN (
        SELECT id FROM public.accounts_payable_invoice
        WHERE organization_id IN (
            SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
        )
    )
);

-- Comments for documentation
COMMENT ON TABLE public.invoice_tags IS 'Tags for categorizing accounts payable invoices';
COMMENT ON TABLE public.invoice_tag_assignments IS 'Junction table linking invoices to tags (many-to-many)';
COMMENT ON COLUMN public.invoice_tags.color IS 'Hex color code for tag display';
