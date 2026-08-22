-- Add user_id column to integrations table with foreign key constraint
-- This tracks which user is currently associated with/managing the integration

-- Add user_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'integrations'
        AND column_name = 'user_id'
    ) THEN
        ALTER TABLE integrations ADD COLUMN user_id uuid;
        RAISE NOTICE 'Added user_id column to integrations table';
    END IF;
END $$;

-- Migrate existing data: copy created_by to user_id for existing records
UPDATE integrations
SET user_id = created_by
WHERE user_id IS NULL AND created_by IS NOT NULL;

RAISE NOTICE 'Migrated existing created_by values to user_id';

-- Add foreign key constraint with SET NULL on delete
-- This keeps the integration when user is deleted (since integration belongs to organization)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'integrations_user_id_fkey'
    ) THEN
        ALTER TABLE integrations
        ADD CONSTRAINT integrations_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES auth.users(id)
        ON DELETE SET NULL;

        RAISE NOTICE 'Added foreign key constraint integrations_user_id_fkey';
    END IF;
END $$;

-- Create index on user_id for performance
CREATE INDEX IF NOT EXISTS idx_integrations_user_id ON integrations(user_id);

-- Add comment
COMMENT ON COLUMN integrations.user_id IS 'User associated with this integration - references auth.users(id) with SET NULL on delete';

RAISE NOTICE 'Successfully added user_id to integrations table with foreign key constraint';
