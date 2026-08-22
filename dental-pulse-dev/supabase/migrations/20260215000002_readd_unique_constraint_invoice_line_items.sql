-- Re-add unique constraint for platform_integration_invoice_line_items
-- The previous constraint was destroyed when migration 20260212122501
-- dropped and recreated the invoice_id column (VARCHAR -> UUID conversion).
-- This constraint is required for the sync upsert to work.

DO $$
BEGIN
    -- Drop the old constraint if it somehow still exists (it shouldn't)
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'platform_integration_invoice_line_items_unique'
    ) THEN
        ALTER TABLE public.platform_integration_invoice_line_items
        DROP CONSTRAINT platform_integration_invoice_line_items_unique;
        RAISE NOTICE 'Dropped existing constraint';
    END IF;

    -- Re-create the unique constraint
    ALTER TABLE public.platform_integration_invoice_line_items
    ADD CONSTRAINT platform_integration_invoice_line_items_unique
    UNIQUE (organization_id, platform_line_id, invoice_id);

    RAISE NOTICE 'Re-added unique constraint on (organization_id, platform_line_id, invoice_id)';
END $$;
