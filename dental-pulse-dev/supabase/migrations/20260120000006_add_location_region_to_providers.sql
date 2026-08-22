-- Add location_id and region_id columns to providers table
-- These columns reference practice_locations and regions tables

-- Add location_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'location_id'
    ) THEN
        ALTER TABLE public.providers 
        ADD COLUMN location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL;
        
        RAISE NOTICE 'Added location_id column to providers table';
    END IF;
END $$;

-- Add region_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'region_id'
    ) THEN
        ALTER TABLE public.providers 
        ADD COLUMN region_id UUID REFERENCES public.regions(id) ON DELETE SET NULL;
        
        RAISE NOTICE 'Added region_id column to providers table';
    END IF;
END $$;

-- Migrate existing data: Update location_id from practice_id if practice_locations table exists
DO $$
DECLARE
    _providers_table_exists BOOLEAN;
    _locations_table_exists BOOLEAN;
BEGIN
    -- Check if practice_locations table exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'practice_locations'
    ) INTO _locations_table_exists;
    
    -- Check if providers table has practice_id column
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'providers'
          AND column_name = 'practice_id'
    ) INTO _providers_table_exists;
    
    -- If both exist, try to migrate practice_id to location_id
    IF _locations_table_exists AND _providers_table_exists THEN
        -- Update location_id from practice_id where practice_id matches a location
        UPDATE public.providers p
        SET location_id = pl.id
        FROM public.practice_locations pl
        WHERE p.practice_id = pl.id
        AND p.location_id IS NULL;
        
        RAISE NOTICE 'Migrated practice_id to location_id where applicable';
    END IF;
END $$;

-- Migrate existing data: Update region_id from location's region_id
DO $$
DECLARE
    _locations_table_exists BOOLEAN;
BEGIN
    -- Check if practice_locations table exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'practice_locations'
    ) INTO _locations_table_exists;
    
    -- If locations table exists, update region_id from location
    IF _locations_table_exists THEN
        UPDATE public.providers p
        SET region_id = pl.region_id
        FROM public.practice_locations pl
        WHERE p.location_id = pl.id
        AND p.region_id IS NULL
        AND pl.region_id IS NOT NULL;
        
        RAISE NOTICE 'Migrated region_id from location where applicable';
    END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_providers_location_id ON public.providers(location_id);
CREATE INDEX IF NOT EXISTS idx_providers_region_id ON public.providers(region_id);

-- Add comments
COMMENT ON COLUMN public.providers.location_id IS 'Foreign key reference to practice_locations table';
COMMENT ON COLUMN public.providers.region_id IS 'Foreign key reference to regions table';
