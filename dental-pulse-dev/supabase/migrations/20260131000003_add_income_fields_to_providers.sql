-- Add income type mapping fields to providers table
-- These fields store JSON array data with selected accounts

DO $$ 
BEGIN
    -- Add membership_income column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'membership_income'
    ) THEN
        ALTER TABLE public.providers 
        ADD COLUMN membership_income TEXT;
        
        RAISE NOTICE 'Added membership_income column to providers table';
    END IF;

    -- Add nhs_income column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'providers' 
        AND column_name = 'nhs_income'
    ) THEN
        ALTER TABLE public.providers 
        ADD COLUMN nhs_income TEXT;
        
        RAISE NOTICE 'Added nhs_income column to providers table';
    END IF;
END $$;
