-- Convert provider_type from ENUM to VARCHAR to support dynamic provider types
-- This migration handles the case where provider_type might be an enum type

DO $$
DECLARE
    _column_type TEXT;
    _udt_name TEXT;
    _enum_type_name TEXT;
BEGIN
    -- Check if provider_type column exists and get its type
    SELECT data_type, udt_name INTO _column_type, _udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'providers'
      AND column_name = 'provider_type';

    -- Get enum type name if it's a user-defined type
    IF _column_type = 'USER-DEFINED' AND _udt_name IS NOT NULL THEN
        _enum_type_name := _udt_name;
        
        -- First, alter the column to TEXT (which can hold any enum value)
        ALTER TABLE public.providers 
        ALTER COLUMN provider_type TYPE TEXT USING provider_type::TEXT;
        
        -- Then convert to VARCHAR(100)
        ALTER TABLE public.providers 
        ALTER COLUMN provider_type TYPE VARCHAR(100);
        
        RAISE NOTICE 'Converted provider_type from enum (%) to VARCHAR(100)', _enum_type_name;
        
        -- Drop the enum type if it exists and is not used elsewhere
        -- Check if enum type is used in other tables
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE udt_name = _enum_type_name 
            AND table_name != 'providers'
            AND column_name != 'provider_type'
        ) THEN
            -- Try to drop the enum type
            BEGIN
                EXECUTE format('DROP TYPE IF EXISTS %I CASCADE', _enum_type_name);
                RAISE NOTICE 'Dropped enum type: %', _enum_type_name;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Could not drop enum type % (may be used elsewhere): %', _enum_type_name, SQLERRM;
            END;
        ELSE
            RAISE NOTICE 'Enum type % is still used elsewhere, not dropping', _enum_type_name;
        END IF;
    ELSIF _column_type = 'character varying' OR _column_type = 'varchar' THEN
        -- Column is already VARCHAR, but might need to ensure it's VARCHAR(100)
        ALTER TABLE public.providers 
        ALTER COLUMN provider_type TYPE VARCHAR(100);
        
        RAISE NOTICE 'Ensured provider_type is VARCHAR(100)';
    ELSIF _column_type IS NULL THEN
        -- Column doesn't exist, create it as VARCHAR
        ALTER TABLE public.providers 
        ADD COLUMN provider_type VARCHAR(100);
        
        RAISE NOTICE 'Created provider_type as VARCHAR(100)';
    ELSE
        RAISE NOTICE 'provider_type column exists with type: % (udt: %), no conversion needed', _column_type, _udt_name;
    END IF;
END $$;

-- Also check for any enum type named provider_type and drop it if not used
DO $$
DECLARE
    _enum_exists BOOLEAN;
BEGIN
    -- Check if enum type provider_type exists
    SELECT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'provider_type' AND typtype = 'e'
    ) INTO _enum_exists;
    
    IF _enum_exists THEN
        -- Check if it's used anywhere
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE udt_name = 'provider_type'
        ) THEN
            DROP TYPE IF EXISTS public.provider_type CASCADE;
            RAISE NOTICE 'Dropped unused enum type: provider_type';
        ELSE
            RAISE NOTICE 'Enum type provider_type is still in use, not dropping';
        END IF;
    END IF;
END $$;

-- Ensure index exists
CREATE INDEX IF NOT EXISTS idx_providers_provider_type ON public.providers(provider_type);

-- Add comment to document the change
COMMENT ON COLUMN public.providers.provider_type IS 'Dynamic provider type code (e.g., associate, therapist, hygienist, assistant). References provider_types.code for validation.';
