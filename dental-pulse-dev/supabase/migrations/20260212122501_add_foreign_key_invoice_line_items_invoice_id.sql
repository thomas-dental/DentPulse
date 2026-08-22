-- Add foreign key constraint for platform_integration_invoice_line_items.invoice_id
-- References platform_integration_invoices.id

DO $$
DECLARE
    column_type TEXT;
    constraint_exists BOOLEAN;
    unmatched_count INTEGER;
BEGIN
    -- Check if the column exists and get its type
    SELECT data_type INTO column_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'platform_integration_invoice_line_items'
      AND column_name = 'invoice_id';

    -- Check if foreign key constraint already exists
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = 'platform_integration_invoice_line_items'
          AND kcu.column_name = 'invoice_id'
    ) INTO constraint_exists;

    -- If constraint already exists, skip
    IF constraint_exists THEN
        RAISE NOTICE 'Foreign key constraint on invoice_id already exists. Skipping.';
    ELSIF column_type IS NULL THEN
        RAISE EXCEPTION 'Column invoice_id does not exist in platform_integration_invoice_line_items table';
    ELSIF column_type = 'uuid' THEN
        -- Column is already UUID, add foreign key constraint
        ALTER TABLE public.platform_integration_invoice_line_items
        ADD CONSTRAINT platform_integration_invoice_line_items_invoice_id_fkey
        FOREIGN KEY (invoice_id)
        REFERENCES public.platform_integration_invoices(id)
        ON DELETE CASCADE;

        RAISE NOTICE 'Added foreign key constraint: platform_integration_invoice_line_items.invoice_id -> platform_integration_invoices.id';
    ELSIF column_type = 'character varying' OR column_type = 'varchar' THEN
        -- Column is VARCHAR, need to convert to UUID first
        -- Try direct conversion first (if values are UUID strings), 
        -- otherwise use join with invoices table (if values are platform_invoice_id)
        RAISE NOTICE 'Converting invoice_id from VARCHAR to UUID...';
        
        BEGIN
            -- Try direct conversion first (will fail if values are not valid UUIDs)
            ALTER TABLE public.platform_integration_invoice_line_items
            ALTER COLUMN invoice_id TYPE UUID USING invoice_id::uuid;
            
            RAISE NOTICE 'Converted invoice_id from VARCHAR to UUID (direct conversion - values were UUID strings)';
        EXCEPTION WHEN OTHERS THEN
            -- Direct conversion failed - values are likely platform_invoice_id strings
            -- Need to join with invoices table to get the UUID
            RAISE NOTICE 'Direct conversion failed. invoice_id contains platform_invoice_id values. Converting via join with invoices table...';
            
            -- Add temporary UUID column
            ALTER TABLE public.platform_integration_invoice_line_items
            ADD COLUMN invoice_id_uuid UUID;

            -- Populate UUID column by joining with invoices table
            UPDATE public.platform_integration_invoice_line_items l
            SET invoice_id_uuid = i.id
            FROM public.platform_integration_invoices i
            WHERE i.platform_invoice_id = l.invoice_id;

            -- Check if all rows were updated
            SELECT COUNT(*) INTO unmatched_count
            FROM public.platform_integration_invoice_line_items 
            WHERE invoice_id_uuid IS NULL AND invoice_id IS NOT NULL;
            
            IF unmatched_count > 0 THEN
                RAISE WARNING 'Some invoice_id values (%) could not be matched to invoices. These rows will have NULL invoice_id_uuid.', unmatched_count;
            END IF;

            -- Drop old column and rename new one
            ALTER TABLE public.platform_integration_invoice_line_items
            DROP COLUMN invoice_id;

            ALTER TABLE public.platform_integration_invoice_line_items
            RENAME COLUMN invoice_id_uuid TO invoice_id;

            -- Try to make it NOT NULL (will fail if there are NULLs)
            BEGIN
                ALTER TABLE public.platform_integration_invoice_line_items
                ALTER COLUMN invoice_id SET NOT NULL;
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'Could not set invoice_id to NOT NULL. Some rows may have NULL values that need to be cleaned up.';
            END;

            RAISE NOTICE 'Converted invoice_id from VARCHAR to UUID (via join with invoices table)';
        END;

        -- Add foreign key constraint
        ALTER TABLE public.platform_integration_invoice_line_items
        ADD CONSTRAINT platform_integration_invoice_line_items_invoice_id_fkey
        FOREIGN KEY (invoice_id)
        REFERENCES public.platform_integration_invoices(id)
        ON DELETE CASCADE;

        RAISE NOTICE 'Added foreign key constraint: platform_integration_invoice_line_items.invoice_id -> platform_integration_invoices.id';
    ELSE
        RAISE EXCEPTION 'Column invoice_id has unexpected type: %. Expected UUID or VARCHAR.', column_type;
    END IF;
END $$;

-- Add comment
COMMENT ON COLUMN public.platform_integration_invoice_line_items.invoice_id
IS 'Foreign key reference to platform_integration_invoices.id';
