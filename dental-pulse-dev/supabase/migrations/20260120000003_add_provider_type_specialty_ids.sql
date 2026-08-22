-- Add provider_type_id and specialty_id columns to providers table
-- These will store foreign key references instead of VARCHAR values

-- Add provider_type_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'provider_type_id'
    ) THEN
        ALTER TABLE public.providers 
        ADD COLUMN provider_type_id UUID REFERENCES public.provider_types(id) ON DELETE SET NULL;
        
        RAISE NOTICE 'Added provider_type_id column to providers table';
    END IF;
END $$;

-- Add specialty_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'specialty_id'
    ) THEN
        ALTER TABLE public.providers 
        ADD COLUMN specialty_id UUID REFERENCES public.specialties(id) ON DELETE SET NULL;
        
        RAISE NOTICE 'Added specialty_id column to providers table';
    END IF;
END $$;

-- Migrate existing data: Update provider_type_id based on provider_type code
DO $$
DECLARE
    _provider_record RECORD;
    _provider_type_id UUID;
BEGIN
    FOR _provider_record IN 
        SELECT id, provider_type 
        FROM public.providers 
        WHERE provider_type IS NOT NULL 
        AND provider_type_id IS NULL
    LOOP
        -- Find matching provider_type_id by code
        SELECT id INTO _provider_type_id
        FROM public.provider_types
        WHERE code = _provider_record.provider_type
        AND deleted_at IS NULL
        LIMIT 1;
        
        IF _provider_type_id IS NOT NULL THEN
            UPDATE public.providers
            SET provider_type_id = _provider_type_id
            WHERE id = _provider_record.id;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Migrated provider_type values to provider_type_id';
END $$;

-- Migrate existing data: Update specialty_id based on specialty name
DO $$
DECLARE
    _provider_record RECORD;
    _specialty_id UUID;
BEGIN
    FOR _provider_record IN 
        SELECT id, specialty, provider_type_id
        FROM public.providers 
        WHERE specialty IS NOT NULL 
        AND specialty_id IS NULL
    LOOP
        -- Find matching specialty_id by name
        -- If provider_type_id exists, prefer specialties for that type
        IF _provider_record.provider_type_id IS NOT NULL THEN
            SELECT id INTO _specialty_id
            FROM public.specialties
            WHERE name = _provider_record.specialty
            AND (provider_type_id = _provider_record.provider_type_id OR provider_type_id IS NULL)
            AND deleted_at IS NULL
            ORDER BY CASE WHEN provider_type_id = _provider_record.provider_type_id THEN 0 ELSE 1 END
            LIMIT 1;
        ELSE
            SELECT id INTO _specialty_id
            FROM public.specialties
            WHERE name = _provider_record.specialty
            AND deleted_at IS NULL
            LIMIT 1;
        END IF;
        
        IF _specialty_id IS NOT NULL THEN
            UPDATE public.providers
            SET specialty_id = _specialty_id
            WHERE id = _provider_record.id;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Migrated specialty values to specialty_id';
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_providers_provider_type_id ON public.providers(provider_type_id);
CREATE INDEX IF NOT EXISTS idx_providers_specialty_id ON public.providers(specialty_id);

-- Add comments
COMMENT ON COLUMN public.providers.provider_type_id IS 'Foreign key reference to provider_types table';
COMMENT ON COLUMN public.providers.specialty_id IS 'Foreign key reference to specialties table';
