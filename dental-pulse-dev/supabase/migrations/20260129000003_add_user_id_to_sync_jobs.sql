-- Add user_id column to sync_jobs table to track who initiated the sync
-- This helps with auditing and user-specific sync management

-- Add user_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'sync_jobs'
        AND column_name = 'user_id'
    ) THEN
        ALTER TABLE sync_jobs ADD COLUMN user_id uuid;
        RAISE NOTICE 'Added user_id column to sync_jobs table';
    END IF;
END $$;

-- Add foreign key constraint with SET NULL on delete
-- This keeps the sync job record when user is deleted (since it belongs to organization)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sync_jobs_user_id_fkey'
    ) THEN
        ALTER TABLE sync_jobs
        ADD CONSTRAINT sync_jobs_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES auth.users(id)
        ON DELETE SET NULL;

        RAISE NOTICE 'Added foreign key constraint sync_jobs_user_id_fkey';
    END IF;
END $$;

-- Create index on user_id for performance
CREATE INDEX IF NOT EXISTS idx_sync_jobs_user_id ON sync_jobs(user_id);

-- Add comment
COMMENT ON COLUMN sync_jobs.user_id IS 'User who initiated this sync job - references auth.users(id) with SET NULL on delete';
