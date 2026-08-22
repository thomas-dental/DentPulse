-- Fix providers table: Add audit fields and proper unique constraint for upsert

-- Step 1: Add created_by and updated_by columns if they don't exist
DO $$ 
BEGIN
    -- Add created_by column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'created_by'
    ) THEN
        ALTER TABLE public.providers 
        ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
        
        RAISE NOTICE 'Added created_by column to providers table';
    END IF;

    -- Add updated_by column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'updated_by'
    ) THEN
        ALTER TABLE public.providers 
        ADD COLUMN updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
        
        RAISE NOTICE 'Added updated_by column to providers table';
    END IF;
END $$;

-- Step 2: Drop the unique index if it exists (we'll create a proper constraint instead)
DROP INDEX IF EXISTS idx_providers_org_external_id_unique;

-- Step 3: Create a proper UNIQUE CONSTRAINT (not just index) for upsert to work
-- This constraint allows Supabase upsert to work with ON CONFLICT
DO $$
BEGIN
    -- Check if constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'providers_org_external_id_unique'
        AND conrelid = 'public.providers'::regclass
    ) THEN
        -- Create unique constraint
        ALTER TABLE public.providers
        ADD CONSTRAINT providers_org_external_id_unique 
        UNIQUE (organization_id, external_id);
        
        RAISE NOTICE 'Created unique constraint providers_org_external_id_unique';
    END IF;
END $$;

-- Step 4: Keep the index for faster lookups (separate from constraint)
CREATE INDEX IF NOT EXISTS idx_providers_org_external_id ON public.providers(organization_id, external_id) 
WHERE external_id IS NOT NULL;
