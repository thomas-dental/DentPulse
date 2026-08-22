-- Create invoice_folders table for organizing invoices
CREATE TABLE IF NOT EXISTS public.invoice_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL,
    parent_id UUID REFERENCES public.invoice_folders(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_invoice_folders_user ON public.invoice_folders(user_id);
CREATE INDEX idx_invoice_folders_organization ON public.invoice_folders(organization_id);
CREATE INDEX idx_invoice_folders_location ON public.invoice_folders(location_id);
CREATE INDEX idx_invoice_folders_parent ON public.invoice_folders(parent_id);
CREATE INDEX idx_invoice_folders_type ON public.invoice_folders(type);

-- Add folder_id column to accounts_payable_invoice table
ALTER TABLE public.accounts_payable_invoice
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.invoice_folders(id) ON DELETE SET NULL;

-- Create index for folder_id on invoices
CREATE INDEX IF NOT EXISTS idx_accounts_payable_invoice_folder ON public.accounts_payable_invoice(folder_id);

-- Enable RLS
ALTER TABLE public.invoice_folders ENABLE ROW LEVEL SECURITY;

-- RLS Policies for invoice_folders
CREATE POLICY "Users can view folders in their organization"
ON public.invoice_folders FOR SELECT
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can create folders in their organization"
ON public.invoice_folders FOR INSERT
TO authenticated
WITH CHECK (
    organization_id IN (
        SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can update folders in their organization"
ON public.invoice_folders FOR UPDATE
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can delete folders in their organization"
ON public.invoice_folders FOR DELETE
TO authenticated
USING (
    organization_id IN (
        SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
);

-- Comment for documentation
COMMENT ON TABLE public.invoice_folders IS 'Folders for organizing accounts payable invoices';
COMMENT ON COLUMN public.invoice_folders.parent_id IS 'Parent folder ID for creating nested folder structure';
COMMENT ON COLUMN public.invoice_folders.type IS 'Folder type: folder, inbox, archive, etc.';
COMMENT ON COLUMN public.invoice_folders.user_id IS 'User who created the folder';
COMMENT ON COLUMN public.invoice_folders.location_id IS 'Location/practice the folder belongs to';
