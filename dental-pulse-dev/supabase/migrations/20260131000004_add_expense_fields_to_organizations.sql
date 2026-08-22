-- Add expense type mapping fields to organizations table
-- These fields store JSON data with account_type and selected_account array
-- Same structure as income fields (private_income, membership_income, nhs_income)

DO $$
BEGIN
    -- Add lab_fees column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'organizations'
        AND column_name = 'lab_fees'
    ) THEN
        ALTER TABLE public.organizations
        ADD COLUMN lab_fees TEXT;

        RAISE NOTICE 'Added lab_fees column to organizations table';
    END IF;

    -- Add staff_costs column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'organizations'
        AND column_name = 'staff_costs'
    ) THEN
        ALTER TABLE public.organizations
        ADD COLUMN staff_costs TEXT;

        RAISE NOTICE 'Added staff_costs column to organizations table';
    END IF;

    -- Add operating_lease column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'organizations'
        AND column_name = 'operating_lease'
    ) THEN
        ALTER TABLE public.organizations
        ADD COLUMN operating_lease TEXT;

        RAISE NOTICE 'Added operating_lease column to organizations table';
    END IF;
END $$;

-- Add comments for documentation
COMMENT ON COLUMN public.organizations.lab_fees IS 'JSON: {account_type: string, selected_account: string[]} - Lab fees expense account mapping';
COMMENT ON COLUMN public.organizations.staff_costs IS 'JSON: {account_type: string, selected_account: string[]} - Staff costs expense account mapping';
COMMENT ON COLUMN public.organizations.operating_lease IS 'JSON: {account_type: string, selected_account: string[]} - Operating lease expense account mapping';
