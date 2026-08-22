-- Add unique constraint for batch upsert on platform_integration_invoice_line_items
-- Required for efficient batch upsert operations in iplicit-sync function

DO $$
BEGIN
    -- Check if the unique constraint already exists
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'platform_integration_invoice_line_items_unique'
    ) THEN
        -- Create unique constraint on (organization_id, platform_line_id, invoice_id)
        ALTER TABLE public.platform_integration_invoice_line_items
        ADD CONSTRAINT platform_integration_invoice_line_items_unique
        UNIQUE (organization_id, platform_line_id, invoice_id);

        RAISE NOTICE 'Added unique constraint on (organization_id, platform_line_id, invoice_id)';
    ELSE
        RAISE NOTICE 'Unique constraint already exists';
    END IF;
END $$;
