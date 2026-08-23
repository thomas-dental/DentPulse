-- One Dentally PAT per practice: remove duplicate rows, restore unique constraint.

DELETE FROM public.dentally_credentials
WHERE id NOT IN (
  SELECT DISTINCT ON (practice_id) id
  FROM public.dentally_credentials
  ORDER BY
    practice_id,
    (validated_at IS NOT NULL) DESC,
    updated_at DESC,
    created_at DESC
);

ALTER TABLE public.dentally_credentials
  DROP CONSTRAINT IF EXISTS dentally_credentials_practice_id_unique;

ALTER TABLE public.dentally_credentials
  ADD CONSTRAINT dentally_credentials_practice_id_unique UNIQUE (practice_id);

COMMENT ON COLUMN public.dentally_credentials.label IS
  'Dentally account email from GET /v1/user — display only, set on successful validation.';
