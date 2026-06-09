ALTER TABLE credential_delivery
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE credential_delivery
SET created_at = COALESCE(created_at, sent_at, NOW())
WHERE created_at IS NULL;
