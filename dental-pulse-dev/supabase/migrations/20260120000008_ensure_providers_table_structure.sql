-- Ensure providers table has the complete structure with all columns and constraints
-- This migration is idempotent and can be run multiple times safely

-- Step 1: Create providers table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.providers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  practice_id uuid,
  name text NOT NULL,
  email text,
  phone text,
  photo_url text,
  revenue numeric NOT NULL DEFAULT 0,
  patients integer NOT NULL DEFAULT 0,
  avg_rev_per_patient numeric NOT NULL DEFAULT 0,
  utilisation numeric NOT NULL DEFAULT 0,
  trend numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  provider_type_id uuid,
  specialty_id uuid,
  location_id uuid,
  region_id uuid,
  CONSTRAINT providers_pkey PRIMARY KEY (id)
);

-- Step 2: Add missing columns if they don't exist
DO $$ 
BEGIN
    -- Add organization_id if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'organization_id'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN organization_id uuid NOT NULL;
    END IF;

    -- Add practice_id if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'practice_id'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN practice_id uuid;
    END IF;

    -- Add name if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'name'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN name text NOT NULL;
    END IF;

    -- Add email if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'email'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN email text;
    END IF;

    -- Add phone if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'phone'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN phone text;
    END IF;

    -- Add photo_url if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'photo_url'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN photo_url text;
    END IF;

    -- Add revenue if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'revenue'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN revenue numeric NOT NULL DEFAULT 0;
    END IF;

    -- Add patients if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'patients'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN patients integer NOT NULL DEFAULT 0;
    END IF;

    -- Add avg_rev_per_patient if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'avg_rev_per_patient'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN avg_rev_per_patient numeric NOT NULL DEFAULT 0;
    END IF;

    -- Add utilisation if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'utilisation'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN utilisation numeric NOT NULL DEFAULT 0;
    END IF;

    -- Add trend if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'trend'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN trend numeric NOT NULL DEFAULT 0;
    END IF;

    -- Add is_active if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'is_active'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN is_active boolean NOT NULL DEFAULT true;
    END IF;

    -- Add created_at if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'created_at'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN created_at timestamp with time zone NOT NULL DEFAULT now();
    END IF;

    -- Add updated_at if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN updated_at timestamp with time zone NOT NULL DEFAULT now();
    END IF;

    -- Add provider_type_id if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'provider_type_id'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN provider_type_id uuid;
    END IF;

    -- Add specialty_id if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'specialty_id'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN specialty_id uuid;
    END IF;

    -- Add location_id if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'location_id'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN location_id uuid;
    END IF;

    -- Add region_id if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'region_id'
    ) THEN
        ALTER TABLE public.providers ADD COLUMN region_id uuid;
    END IF;
END $$;

-- Step 3: Ensure NOT NULL constraints and defaults are set correctly
DO $$
DECLARE
    _is_nullable text;
BEGIN
    -- Ensure organization_id is NOT NULL
    SELECT is_nullable INTO _is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'providers'
      AND column_name = 'organization_id';
    
    IF _is_nullable = 'YES' THEN
        -- Check if there are any NULL values
        IF EXISTS (SELECT 1 FROM public.providers WHERE organization_id IS NULL) THEN
            RAISE WARNING 'Cannot set organization_id to NOT NULL: NULL values exist';
        ELSE
            ALTER TABLE public.providers ALTER COLUMN organization_id SET NOT NULL;
        END IF;
    END IF;

    -- Ensure name is NOT NULL
    SELECT is_nullable INTO _is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'providers'
      AND column_name = 'name';
    
    IF _is_nullable = 'YES' THEN
        -- Check if there are any NULL values
        IF EXISTS (SELECT 1 FROM public.providers WHERE name IS NULL) THEN
            RAISE WARNING 'Cannot set name to NOT NULL: NULL values exist';
        ELSE
            ALTER TABLE public.providers ALTER COLUMN name SET NOT NULL;
        END IF;
    END IF;

    -- Ensure revenue has default 0 and is NOT NULL
    SELECT is_nullable INTO _is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'revenue';
    IF _is_nullable = 'YES' THEN
        ALTER TABLE public.providers ALTER COLUMN revenue SET DEFAULT 0;
        UPDATE public.providers SET revenue = 0 WHERE revenue IS NULL;
        ALTER TABLE public.providers ALTER COLUMN revenue SET NOT NULL;
    ELSE
        ALTER TABLE public.providers ALTER COLUMN revenue SET DEFAULT 0;
    END IF;

    -- Ensure patients has default 0 and is NOT NULL
    SELECT is_nullable INTO _is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'patients';
    IF _is_nullable = 'YES' THEN
        ALTER TABLE public.providers ALTER COLUMN patients SET DEFAULT 0;
        UPDATE public.providers SET patients = 0 WHERE patients IS NULL;
        ALTER TABLE public.providers ALTER COLUMN patients SET NOT NULL;
    ELSE
        ALTER TABLE public.providers ALTER COLUMN patients SET DEFAULT 0;
    END IF;

    -- Ensure avg_rev_per_patient has default 0 and is NOT NULL
    SELECT is_nullable INTO _is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'avg_rev_per_patient';
    IF _is_nullable = 'YES' THEN
        ALTER TABLE public.providers ALTER COLUMN avg_rev_per_patient SET DEFAULT 0;
        UPDATE public.providers SET avg_rev_per_patient = 0 WHERE avg_rev_per_patient IS NULL;
        ALTER TABLE public.providers ALTER COLUMN avg_rev_per_patient SET NOT NULL;
    ELSE
        ALTER TABLE public.providers ALTER COLUMN avg_rev_per_patient SET DEFAULT 0;
    END IF;

    -- Ensure utilisation has default 0 and is NOT NULL
    SELECT is_nullable INTO _is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'utilisation';
    IF _is_nullable = 'YES' THEN
        ALTER TABLE public.providers ALTER COLUMN utilisation SET DEFAULT 0;
        UPDATE public.providers SET utilisation = 0 WHERE utilisation IS NULL;
        ALTER TABLE public.providers ALTER COLUMN utilisation SET NOT NULL;
    ELSE
        ALTER TABLE public.providers ALTER COLUMN utilisation SET DEFAULT 0;
    END IF;

    -- Ensure trend has default 0 and is NOT NULL
    SELECT is_nullable INTO _is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'trend';
    IF _is_nullable = 'YES' THEN
        ALTER TABLE public.providers ALTER COLUMN trend SET DEFAULT 0;
        UPDATE public.providers SET trend = 0 WHERE trend IS NULL;
        ALTER TABLE public.providers ALTER COLUMN trend SET NOT NULL;
    ELSE
        ALTER TABLE public.providers ALTER COLUMN trend SET DEFAULT 0;
    END IF;

    -- Ensure is_active has default true and is NOT NULL
    SELECT is_nullable INTO _is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'is_active';
    IF _is_nullable = 'YES' THEN
        ALTER TABLE public.providers ALTER COLUMN is_active SET DEFAULT true;
        UPDATE public.providers SET is_active = true WHERE is_active IS NULL;
        ALTER TABLE public.providers ALTER COLUMN is_active SET NOT NULL;
    ELSE
        ALTER TABLE public.providers ALTER COLUMN is_active SET DEFAULT true;
    END IF;

    -- Ensure created_at has default now() and is NOT NULL
    SELECT is_nullable INTO _is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'created_at';
    IF _is_nullable = 'YES' THEN
        ALTER TABLE public.providers ALTER COLUMN created_at SET DEFAULT now();
        UPDATE public.providers SET created_at = now() WHERE created_at IS NULL;
        ALTER TABLE public.providers ALTER COLUMN created_at SET NOT NULL;
    ELSE
        ALTER TABLE public.providers ALTER COLUMN created_at SET DEFAULT now();
    END IF;

    -- Ensure updated_at has default now() and is NOT NULL
    SELECT is_nullable INTO _is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'updated_at';
    IF _is_nullable = 'YES' THEN
        ALTER TABLE public.providers ALTER COLUMN updated_at SET DEFAULT now();
        UPDATE public.providers SET updated_at = now() WHERE updated_at IS NULL;
        ALTER TABLE public.providers ALTER COLUMN updated_at SET NOT NULL;
    ELSE
        ALTER TABLE public.providers ALTER COLUMN updated_at SET DEFAULT now();
    END IF;

    -- Ensure id has default gen_random_uuid()
    ALTER TABLE public.providers ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error setting constraints/defaults: %', SQLERRM;
END $$;

-- Step 4: Ensure primary key constraint exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'public.providers'::regclass 
        AND conname = 'providers_pkey'
    ) THEN
        ALTER TABLE public.providers 
        ADD CONSTRAINT providers_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- Step 5: Ensure foreign key constraints exist
DO $$
BEGIN
    -- organization_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'providers'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'organization_id'
    ) THEN
        ALTER TABLE public.providers 
        ADD CONSTRAINT providers_organization_id_fkey 
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
    END IF;

    -- practice_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'providers'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'practice_id'
    ) THEN
        ALTER TABLE public.providers 
        ADD CONSTRAINT providers_practice_id_fkey 
        FOREIGN KEY (practice_id) REFERENCES public.practices(id);
    END IF;

    -- provider_type_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'providers'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'provider_type_id'
    ) THEN
        ALTER TABLE public.providers 
        ADD CONSTRAINT providers_provider_type_id_fkey 
        FOREIGN KEY (provider_type_id) REFERENCES public.provider_types(id);
    END IF;

    -- specialty_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'providers'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'specialty_id'
    ) THEN
        ALTER TABLE public.providers 
        ADD CONSTRAINT providers_specialty_id_fkey 
        FOREIGN KEY (specialty_id) REFERENCES public.specialties(id);
    END IF;

    -- location_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'providers'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'location_id'
    ) THEN
        ALTER TABLE public.providers 
        ADD CONSTRAINT providers_location_id_fkey 
        FOREIGN KEY (location_id) REFERENCES public.practice_locations(id);
    END IF;

    -- region_id foreign key
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'providers'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'region_id'
    ) THEN
        ALTER TABLE public.providers 
        ADD CONSTRAINT providers_region_id_fkey 
        FOREIGN KEY (region_id) REFERENCES public.regions(id);
    END IF;
END $$;

-- Step 6: Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_providers_organization_id ON public.providers(organization_id);
CREATE INDEX IF NOT EXISTS idx_providers_practice_id ON public.providers(practice_id);
CREATE INDEX IF NOT EXISTS idx_providers_provider_type_id ON public.providers(provider_type_id);
CREATE INDEX IF NOT EXISTS idx_providers_specialty_id ON public.providers(specialty_id);
CREATE INDEX IF NOT EXISTS idx_providers_location_id ON public.providers(location_id);
CREATE INDEX IF NOT EXISTS idx_providers_region_id ON public.providers(region_id);
CREATE INDEX IF NOT EXISTS idx_providers_is_active ON public.providers(is_active);
