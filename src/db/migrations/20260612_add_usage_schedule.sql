-- Weekly usage schedule: per-day time windows and duration limits
ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS usage_schedule JSONB;

COMMENT ON COLUMN requests.usage_schedule IS
  'Weekly schedule: timezone, per-day enabled flag, time slots, and limitMinutes';
