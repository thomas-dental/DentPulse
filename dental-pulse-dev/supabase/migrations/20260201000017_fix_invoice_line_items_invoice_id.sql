-- Fix invoice_id column in platform_integration_invoice_line_items table
-- Change from UUID to VARCHAR(255) to match platform_invoice_id from parent table

DO $$
BEGIN
    -- Check if invoice_id column exists and is UUID type
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'invoice_id'
        AND data_type = 'uuid'
    ) THEN
        -- Drop the column and recreate with correct type
        ALTER TABLE public.platform_integration_invoice_line_items
        DROP COLUMN invoice_id;

        ALTER TABLE public.platform_integration_invoice_line_items
        ADD COLUMN invoice_id CHARACTER VARYING(255) NOT NULL;

        RAISE NOTICE 'Changed invoice_id column from UUID to VARCHAR(255)';
    ELSIF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'platform_integration_invoice_line_items'
        AND column_name = 'invoice_id'
    ) THEN
        -- Column doesn't exist, create it
        ALTER TABLE public.platform_integration_invoice_line_items
        ADD COLUMN invoice_id CHARACTER VARYING(255) NOT NULL;

        RAISE NOTICE 'Added invoice_id column as VARCHAR(255)';
    ELSE
        RAISE NOTICE 'invoice_id column already exists with correct type';
    END IF;
END $$;

-- Add comment
COMMENT ON COLUMN public.platform_integration_invoice_line_items.invoice_id
IS 'References platform_invoice_id from platform_integration_invoices table';
