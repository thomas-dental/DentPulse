-- Force convert provider_type ENUM to VARCHAR
-- This migration ensures provider_type can accept any value from provider_types table

-- Step 1: Drop any constraints that might reference the enum
DO $$
BEGIN
    -- Drop check constraints that might restrict values
    ALTER TABLE public.providers DROP CONSTRAINT IF EXISTS providers_provider_type_check;
    ALTER TABLE public.providers DROP CONSTRAINT IF EXISTS providers_provider_type_enum_check;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No constraints to drop: %', SQLERRM;
END $$;

-- Step 2: Convert column type if it's an enum
DO $$
DECLARE
    _column_type TEXT;
    _udt_name TEXT;
BEGIN
    -- Get current column type
    SELECT data_type, udt_name INTO _column_type, _udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'providers'
      AND column_name = 'provider_type';

    -- If it's a user-defined type (enum), convert it
    IF _column_type = 'USER-DEFINED' OR _udt_name IS NOT NULL THEN
        RAISE NOTICE 'Converting provider_type from enum (%) to VARCHAR(100)', _udt_name;
        
        -- Convert to TEXT first (can hold any value)
        ALTER TABLE public.providers 
        ALTER COLUMN provider_type TYPE TEXT USING provider_type::TEXT;
        
        -- Then convert to VARCHAR(100)
        ALTER TABLE public.providers 
        ALTER COLUMN provider_type TYPE VARCHAR(100);
        
        RAISE NOTICE 'Successfully converted provider_type to VARCHAR(100)';
    ELSE
        -- Ensure it's VARCHAR(100) even if already VARCHAR
        ALTER TABLE public.providers 
        ALTER COLUMN provider_type TYPE VARCHAR(100) USING provider_type::VARCHAR(100);
        
        RAISE NOTICE 'Ensured provider_type is VARCHAR(100)';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error converting provider_type: %', SQLERRM;
END $$;

-- Step 3: Drop enum type if it exists and is not used
DO $$
DECLARE
    _enum_types TEXT[];
    _enum_type TEXT;
BEGIN
    -- Find all enum types that might be provider_type
    SELECT ARRAY_AGG(typname) INTO _enum_types
    FROM pg_type
    WHERE typtype = 'e'
      AND (typname LIKE '%provider%' OR typname = 'provider_type');
    
    -- Drop each enum type if not used
    IF _enum_types IS NOT NULL THEN
        FOREACH _enum_type IN ARRAY _enum_types
        LOOP
            BEGIN
                -- Check if enum is still used
                IF NOT EXISTS (
                    SELECT 1 
                    FROM information_schema.columns 
                    WHERE udt_name = _enum_type
                ) THEN
                    EXECUTE format('DROP TYPE IF EXISTS %I CASCADE', _enum_type);
                    RAISE NOTICE 'Dropped enum type: %', _enum_type;
                ELSE
                    RAISE NOTICE 'Enum type % is still in use, keeping it', _enum_type;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Could not drop enum type %: %', _enum_type, SQLERRM;
            END;
        END LOOP;
    END IF;
END $$;

-- Step 4: Ensure the column exists and is VARCHAR(100)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'providers'
          AND column_name = 'provider_type'
    ) THEN
        ALTER TABLE public.providers 
        ADD COLUMN provider_type VARCHAR(100);
        
        RAISE NOTICE 'Created provider_type column as VARCHAR(100)';
    END IF;
END $$;

-- Step 5: Ensure index exists
CREATE INDEX IF NOT EXISTS idx_providers_provider_type ON public.providers(provider_type);

-- Step 6: Add comment
COMMENT ON COLUMN public.providers.provider_type IS 'Dynamic provider type code from provider_types table. Can be any value from provider_types.code (e.g., associate, therapist, hygienist, assistant).';
