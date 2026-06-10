-- Fix cleanup_logs table schema if event_name column is missing
-- This ensures the table has the correct structure

-- Check if cleanup_logs table exists, if not create it
CREATE TABLE IF NOT EXISTS cleanup_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  log_level TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add event_name column if it doesn't exist (for tables created without it)
ALTER TABLE cleanup_logs
  ADD COLUMN IF NOT EXISTS event_name TEXT NOT NULL DEFAULT 'unknown_event';

-- Remove default after adding (so new rows must specify event_name)
ALTER TABLE cleanup_logs
  ALTER COLUMN event_name DROP DEFAULT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_cleanup_logs_request_id
  ON cleanup_logs (request_id);

CREATE INDEX IF NOT EXISTS idx_cleanup_logs_created_at
  ON cleanup_logs (created_at DESC);
