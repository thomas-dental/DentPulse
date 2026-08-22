-- Fix practice_id foreign key constraint to allow NULL and handle invalid values
-- Since we're now using location_id, practice_id should be optional

-- Step 1: Drop the existing foreign key constraint if it exists
DO $$
DECLARE
    _constraint_name TEXT;
BEGIN
    -- Find the foreign key constraint name for practice_id
    SELECT conname INTO _constraint_name
    FROM pg_constraint
    WHERE conrelid = 'public.providers'::regclass
      AND confrelid = 'public.practices'::regclass
      AND conkey::text LIKE '%practice_id%';
    
    IF _constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.providers DROP CONSTRAINT IF EXISTS %I', _constraint_name);
        RAISE NOTICE 'Dropped constraint: %', _constraint_name;
    END IF;
END $$;

-- Step 2: Ensure practice_id column allows NULL and has default NULL
DO $$
BEGIN
    -- Make sure practice_id allows NULL
    ALTER TABLE public.providers 
    ALTER COLUMN practice_id DROP NOT NULL;
    
    -- Set default to NULL if not already
    ALTER TABLE public.providers 
    ALTER COLUMN practice_id SET DEFAULT NULL;
    
    RAISE NOTICE 'Updated practice_id to allow NULL and default to NULL';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'practice_id column may not exist or already allows NULL: %', SQLERRM;
END $$;

-- Step 3: Update existing foreign key constraint to handle NULL properly
-- The constraint should already allow NULL, but we'll ensure it's set up correctly
DO $$
DECLARE
    _constraint_exists BOOLEAN;
BEGIN
    -- Check if constraint exists using information_schema
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'providers'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'practice_id'
    ) INTO _constraint_exists;
    
    -- If constraint exists, it should already allow NULL (since practice_id is nullable)
    -- We just need to ensure invalid values are cleaned up
    IF _constraint_exists THEN
        RAISE NOTICE 'practice_id foreign key constraint exists and allows NULL';
    END IF;
END $$;

-- Step 4: Clean up invalid practice_id values (set to NULL if they don't exist in practices table)
DO $$
BEGIN
    UPDATE public.providers
    SET practice_id = NULL
    WHERE practice_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM public.practices
        WHERE id = providers.practice_id
    );
    
    RAISE NOTICE 'Cleaned up invalid practice_id values';
END $$;

-- Step 5: Add comment
COMMENT ON COLUMN public.providers.practice_id IS 'Foreign key reference to practices table (optional, can be NULL). For backward compatibility. Use location_id for new records.';
