-- Add user_id column to organizations table
-- This field represents the primary user/owner of the organization

DO $$ 
BEGIN
    -- Add user_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'organizations' 
        AND column_name = 'user_id'
    ) THEN
        ALTER TABLE public.organizations 
        ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
        
        RAISE NOTICE 'Added user_id column to organizations table';
    END IF;
END $$;

-- Create index for user_id for better query performance
CREATE INDEX IF NOT EXISTS idx_organizations_user_id ON public.organizations(user_id);

-- Update existing organizations to set user_id from created_by if user_id is null
UPDATE public.organizations 
SET user_id = created_by 
WHERE user_id IS NULL AND created_by IS NOT NULL;
