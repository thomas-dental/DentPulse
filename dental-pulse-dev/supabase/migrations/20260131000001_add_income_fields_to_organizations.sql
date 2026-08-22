-- Add income type mapping fields to organizations table
-- These fields store JSON data with account_type and selected_account array

DO $$ 
BEGIN
    -- Add private_income column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'organizations' 
        AND column_name = 'private_income'
    ) THEN
        ALTER TABLE public.organizations 
        ADD COLUMN private_income TEXT;
        
        RAISE NOTICE 'Added private_income column to organizations table';
    END IF;

    -- Add membership_income column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'organizations' 
        AND column_name = 'membership_income'
    ) THEN
        ALTER TABLE public.organizations 
        ADD COLUMN membership_income TEXT;
        
        RAISE NOTICE 'Added membership_income column to organizations table';
    END IF;

    -- Add nhs_income column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'organizations' 
        AND column_name = 'nhs_income'
    ) THEN
        ALTER TABLE public.organizations 
        ADD COLUMN nhs_income TEXT;
        
        RAISE NOTICE 'Added nhs_income column to organizations table';
    END IF;
END $$;
