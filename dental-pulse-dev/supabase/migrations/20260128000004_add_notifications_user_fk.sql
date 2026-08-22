-- Add foreign key constraint to notifications.user_id with CASCADE DELETE
-- This ensures notifications are automatically deleted when a user is deleted

-- First, check if the constraint already exists and drop it if it does
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'notifications_user_id_fkey'
    ) THEN
        ALTER TABLE notifications DROP CONSTRAINT notifications_user_id_fkey;
        RAISE NOTICE 'Dropped existing constraint notifications_user_id_fkey';
    END IF;
END $$;

-- Add foreign key constraint with CASCADE DELETE
ALTER TABLE notifications
ADD CONSTRAINT notifications_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE CASCADE;

-- Add comment
COMMENT ON CONSTRAINT notifications_user_id_fkey ON notifications IS
'Foreign key to auth.users with CASCADE DELETE - notifications are automatically deleted when user is deleted';

-- Create index on user_id if it doesn't exist (for performance)
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

RAISE NOTICE 'Successfully added foreign key constraint with CASCADE DELETE to notifications.user_id';
