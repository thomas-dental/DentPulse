-- Create treatment_categories table
CREATE TABLE IF NOT EXISTS public.treatment_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  location_id uuid,
  region_id uuid,
  name varchar(100) NOT NULL,
  description text,
  display_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  CONSTRAINT treatment_categories_pkey PRIMARY KEY (id),
  CONSTRAINT treatment_categories_name_not_empty CHECK (length(name) >= 2)
);

-- Create treatments table
CREATE TABLE IF NOT EXISTS public.treatments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  category_id uuid,
  location_id uuid,
  region_id uuid,
  
  -- Treatment Details
  treatment_name varchar(255) NOT NULL,
  treatment_code varchar(50), -- Internal code or ADA code (e.g., D0120)
  description text,
  
  -- Treatment Type
  treatment_type varchar(50) NOT NULL, -- private, nhs
  
  -- Pricing
  price numeric(10, 2) NOT NULL, -- Base price for the treatment
  
  -- Additional Pricing (optional)
  private_price numeric(10, 2), -- Separate private price if needed
  nhs_price numeric(10, 2), -- Separate NHS price if needed
  nhs_band varchar(10), -- NHS Band (Band 1, Band 2, Band 3) for UK practices
  
  -- Treatment Information
  duration_minutes integer, -- Estimated duration
  requires_followup boolean DEFAULT false,
  
  -- Status
  is_active boolean DEFAULT true,
  
  -- Notes
  notes text,
  
  -- Audit fields
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  
  CONSTRAINT treatments_pkey PRIMARY KEY (id),
  CONSTRAINT treatments_name_not_empty CHECK (length(treatment_name) >= 2),
  CONSTRAINT treatments_type_check CHECK (treatment_type IN ('private', 'nhs')),
  CONSTRAINT treatments_price_positive CHECK (price >= 0),
  CONSTRAINT treatments_nhs_band_check CHECK (nhs_band IS NULL OR nhs_band IN ('Band 1', 'Band 2', 'Band 3'))
);

-- Add foreign key constraints for treatment_categories table
ALTER TABLE public.treatment_categories 
  ADD CONSTRAINT treatment_categories_organization_id_fkey 
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.treatment_categories 
  ADD CONSTRAINT treatment_categories_location_id_fkey 
  FOREIGN KEY (location_id) REFERENCES public.practice_locations(id) ON DELETE SET NULL;

ALTER TABLE public.treatment_categories 
  ADD CONSTRAINT treatment_categories_region_id_fkey 
  FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;

ALTER TABLE public.treatment_categories 
  ADD CONSTRAINT treatment_categories_created_by_fkey 
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.treatment_categories 
  ADD CONSTRAINT treatment_categories_updated_by_fkey 
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add foreign key constraints for treatments table
ALTER TABLE public.treatments 
  ADD CONSTRAINT treatments_organization_id_fkey 
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.treatments 
  ADD CONSTRAINT treatments_category_id_fkey 
  FOREIGN KEY (category_id) REFERENCES public.treatment_categories(id) ON DELETE SET NULL;

ALTER TABLE public.treatments 
  ADD CONSTRAINT treatments_location_id_fkey 
  FOREIGN KEY (location_id) REFERENCES public.practice_locations(id) ON DELETE SET NULL;

ALTER TABLE public.treatments 
  ADD CONSTRAINT treatments_region_id_fkey 
  FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;

ALTER TABLE public.treatments 
  ADD CONSTRAINT treatments_created_by_fkey 
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.treatments 
  ADD CONSTRAINT treatments_updated_by_fkey 
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create indexes for treatments table
CREATE INDEX IF NOT EXISTS idx_treatments_organization_id ON public.treatments(organization_id);
CREATE INDEX IF NOT EXISTS idx_treatments_category_id ON public.treatments(category_id);
CREATE INDEX IF NOT EXISTS idx_treatments_location_id ON public.treatments(location_id);
CREATE INDEX IF NOT EXISTS idx_treatments_region_id ON public.treatments(region_id);
CREATE INDEX IF NOT EXISTS idx_treatments_treatment_type ON public.treatments(treatment_type);
CREATE INDEX IF NOT EXISTS idx_treatments_treatment_code ON public.treatments(treatment_code);
CREATE INDEX IF NOT EXISTS idx_treatments_is_active ON public.treatments(is_active);
CREATE INDEX IF NOT EXISTS idx_treatments_deleted_at ON public.treatments(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_treatments_name ON public.treatments(treatment_name) WHERE deleted_at IS NULL;

-- Create indexes for treatment_categories table
CREATE INDEX IF NOT EXISTS idx_treatment_categories_organization_id ON public.treatment_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_treatment_categories_location_id ON public.treatment_categories(location_id);
CREATE INDEX IF NOT EXISTS idx_treatment_categories_region_id ON public.treatment_categories(region_id);
CREATE INDEX IF NOT EXISTS idx_treatment_categories_display_order ON public.treatment_categories(display_order);
CREATE INDEX IF NOT EXISTS idx_treatment_categories_deleted_at ON public.treatment_categories(deleted_at) WHERE deleted_at IS NULL;

-- Create triggers for updated_at
CREATE TRIGGER update_treatment_categories_updated_at
  BEFORE UPDATE ON public.treatment_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_treatments_updated_at
  BEFORE UPDATE ON public.treatments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.treatment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for treatment_categories
CREATE POLICY "Users can view treatment categories in their org"
ON public.treatment_categories FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  deleted_at IS NULL AND
  public.user_in_org(auth.uid(), organization_id)
);

CREATE POLICY "Owners and admins can insert treatment categories"
ON public.treatment_categories FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can update treatment categories"
ON public.treatment_categories FOR UPDATE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can delete treatment categories"
ON public.treatment_categories FOR DELETE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

-- RLS Policies for treatments
CREATE POLICY "Users can view treatments in their org"
ON public.treatments FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  deleted_at IS NULL AND
  public.user_in_org(auth.uid(), organization_id)
);

CREATE POLICY "Owners and admins can insert treatments"
ON public.treatments FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can update treatments"
ON public.treatments FOR UPDATE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can delete treatments"
ON public.treatments FOR DELETE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR 
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

-- Add comments
COMMENT ON TABLE public.treatment_categories IS 'Categories for organizing dental treatments';
COMMENT ON TABLE public.treatments IS 'Dental treatments/services offered by the practice (Private or NHS)';
COMMENT ON COLUMN public.treatments.treatment_code IS 'Internal code or ADA code (e.g., D0120)';
COMMENT ON COLUMN public.treatments.treatment_type IS 'Type of treatment: private or nhs';
COMMENT ON COLUMN public.treatments.nhs_band IS 'NHS Band (Band 1, Band 2, Band 3) for UK practices';
