-- Remove data_sync_json column from integrations table
-- We now use integration_sync_entities table instead

DO $$
BEGIN
    -- Check if column exists before dropping
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'integrations'
        AND column_name = 'data_sync_json'
    ) THEN
        ALTER TABLE public.integrations DROP COLUMN data_sync_json;
        RAISE NOTICE 'Dropped column data_sync_json from integrations table';
    ELSE
        RAISE NOTICE 'Column data_sync_json does not exist in integrations table';
    END IF;
END $$;
