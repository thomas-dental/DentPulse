-- ============================================================
-- Add invite workflow columns to existing team_members table
-- and drop the team_invitations table if it exists
-- ============================================================

BEGIN;

-- Drop team_invitations if it was created
DROP TABLE IF EXISTS public.team_invitations;

-- Add invite-related columns to team_members
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'active'
    CHECK (invite_status IN ('pending', 'accepted', 'expired', 'cancelled', 'active')),
  ADD COLUMN IF NOT EXISTS invite_token UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- Mark all existing rows as 'active' (they pre-date invites)
UPDATE public.team_members SET invite_status = 'active' WHERE invite_status IS NULL;

-- Indexes for invite lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_invite_token
  ON public.team_members(invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_members_invite_status
  ON public.team_members(organization_id, invite_status);
CREATE INDEX IF NOT EXISTS idx_team_members_email_org
  ON public.team_members(organization_id, email);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id
  ON public.team_members(user_id) WHERE user_id IS NOT NULL;

-- RLS: allow anon to read by invite_token (for accept-invite page)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'team_members' AND policyname = 'anon_read_team_member_by_token'
  ) THEN
    CREATE POLICY "anon_read_team_member_by_token"
      ON public.team_members FOR SELECT TO anon
      USING (true);
  END IF;
END $$;

COMMIT;
