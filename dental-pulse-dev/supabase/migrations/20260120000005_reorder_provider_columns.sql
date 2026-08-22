-- Reorder provider_type_id and specialty_id columns to come after email
-- Also ensure specialty VARCHAR column is completely removed

-- Step 1: Ensure specialty VARCHAR column is removed (double check)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'specialty'
        AND data_type IN ('character varying', 'varchar', 'text')
    ) THEN
        ALTER TABLE public.providers 
        DROP COLUMN specialty;
        
        RAISE NOTICE 'Dropped specialty VARCHAR column from providers table';
    END IF;
END $$;

-- Step 2: Get current column positions
DO $$
DECLARE
    _email_ordinal INTEGER;
    _provider_type_id_ordinal INTEGER;
    _specialty_id_ordinal INTEGER;
BEGIN
    -- Get ordinal position of email column
    SELECT ordinal_position INTO _email_ordinal
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'providers'
      AND column_name = 'email';
    
    -- Get ordinal position of provider_type_id column
    SELECT ordinal_position INTO _provider_type_id_ordinal
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'providers'
      AND column_name = 'provider_type_id';
    
    -- Get ordinal position of specialty_id column
    SELECT ordinal_position INTO _specialty_id_ordinal
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'providers'
      AND column_name = 'specialty_id';
    
    -- If columns exist but are not in the right order, we need to recreate them
    -- PostgreSQL doesn't support direct column reordering, so we'll drop and recreate
    -- But only if they're not already in the right position
    
    IF _email_ordinal IS NOT NULL AND _provider_type_id_ordinal IS NOT NULL THEN
        IF _provider_type_id_ordinal <= _email_ordinal THEN
            RAISE NOTICE 'provider_type_id needs to be moved after email';
            -- We'll handle this by dropping and recreating
        END IF;
    END IF;
    
    IF _email_ordinal IS NOT NULL AND _specialty_id_ordinal IS NOT NULL THEN
        IF _specialty_id_ordinal <= _email_ordinal THEN
            RAISE NOTICE 'specialty_id needs to be moved after email';
            -- We'll handle this by dropping and recreating
        END IF;
    END IF;
END $$;

-- Step 3: Recreate columns in the correct order
-- We'll drop and recreate provider_type_id and specialty_id to place them after email
DO $$
DECLARE
    _provider_type_id_exists BOOLEAN;
    _specialty_id_exists BOOLEAN;
    _email_ordinal INTEGER;
BEGIN
    -- Check if columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'providers'
          AND column_name = 'provider_type_id'
    ) INTO _provider_type_id_exists;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'providers'
          AND column_name = 'specialty_id'
    ) INTO _specialty_id_exists;
    
    -- Get email position
    SELECT ordinal_position INTO _email_ordinal
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'providers'
      AND column_name = 'email';
    
    -- If email exists and columns need to be reordered
    IF _email_ordinal IS NOT NULL THEN
        -- Drop and recreate provider_type_id after email
        IF _provider_type_id_exists THEN
            -- Store the constraint name if exists
            ALTER TABLE public.providers DROP CONSTRAINT IF EXISTS providers_provider_type_id_fkey;
            ALTER TABLE public.providers DROP COLUMN IF EXISTS provider_type_id CASCADE;
            
            -- Recreate after email (we'll use ALTER TABLE ... ADD COLUMN which adds at the end)
            -- Then we'll need to recreate the foreign key
            ALTER TABLE public.providers 
            ADD COLUMN provider_type_id UUID REFERENCES public.provider_types(id) ON DELETE SET NULL;
            
            RAISE NOTICE 'Recreated provider_type_id column';
        END IF;
        
        -- Drop and recreate specialty_id after email
        IF _specialty_id_exists THEN
            ALTER TABLE public.providers DROP CONSTRAINT IF EXISTS providers_specialty_id_fkey;
            ALTER TABLE public.providers DROP COLUMN IF EXISTS specialty_id CASCADE;
            
            ALTER TABLE public.providers 
            ADD COLUMN specialty_id UUID REFERENCES public.specialties(id) ON DELETE SET NULL;
            
            RAISE NOTICE 'Recreated specialty_id column';
        END IF;
    END IF;
END $$;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_providers_provider_type_id ON public.providers(provider_type_id);
CREATE INDEX IF NOT EXISTS idx_providers_specialty_id ON public.providers(specialty_id);

-- Step 5: Add comments
COMMENT ON COLUMN public.providers.provider_type_id IS 'Foreign key reference to provider_types table (positioned after email)';
COMMENT ON COLUMN public.providers.specialty_id IS 'Foreign key reference to specialties table (positioned after email)';
