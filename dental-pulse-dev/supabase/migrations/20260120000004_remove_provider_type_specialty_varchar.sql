-- Remove provider_type and specialty VARCHAR columns from providers table
-- We now use provider_type_id and specialty_id foreign keys instead

-- Drop provider_type VARCHAR column if it exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'provider_type'
        AND data_type = 'character varying'
    ) THEN
        ALTER TABLE public.providers 
        DROP COLUMN provider_type;
        
        RAISE NOTICE 'Dropped provider_type VARCHAR column from providers table';
    END IF;
END $$;

-- Drop specialty VARCHAR column if it exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'specialty'
        AND data_type = 'character varying'
    ) THEN
        ALTER TABLE public.providers 
        DROP COLUMN specialty;
        
        RAISE NOTICE 'Dropped specialty VARCHAR column from providers table';
    END IF;
END $$;

-- Drop old indexes if they exist
DROP INDEX IF EXISTS idx_providers_provider_type;
DROP INDEX IF EXISTS idx_providers_specialty;
