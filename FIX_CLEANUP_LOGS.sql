-- ============================================================================
-- FIX: cleanup_logs table missing event_name column
-- ============================================================================
-- Error: column "event_name" of relation "cleanup_logs" does not exist
-- This script ensures the cleanup_logs table has the correct schema
-- ============================================================================

-- STEP 1: Check if table exists and recreate with correct schema if needed
-- ============================================================================

-- Drop and recreate (WARNING: This will lose existing cleanup logs)
-- Uncomment the next line if you want to start fresh:
-- DROP TABLE IF EXISTS cleanup_logs CASCADE;

-- Create table with correct schema (IF NOT EXISTS will skip if already exists)
CREATE TABLE IF NOT EXISTS cleanup_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  log_level TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- STEP 2: Add missing column if table exists without it
-- ============================================================================

-- This will add the column if it's missing
-- The DEFAULT is temporary to allow existing rows to get a value
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'cleanup_logs' 
    AND column_name = 'event_name'
  ) THEN
    ALTER TABLE cleanup_logs
      ADD COLUMN event_name TEXT NOT NULL DEFAULT 'unknown_event';
    
    -- Remove default after adding (so new rows must specify event_name)
    ALTER TABLE cleanup_logs
      ALTER COLUMN event_name DROP DEFAULT;
    
    RAISE NOTICE 'Added event_name column to cleanup_logs table';
  ELSE
    RAISE NOTICE 'event_name column already exists in cleanup_logs table';
  END IF;
END $$;

-- STEP 3: Create indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cleanup_logs_request_id
  ON cleanup_logs (request_id);

CREATE INDEX IF NOT EXISTS idx_cleanup_logs_created_at
  ON cleanup_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cleanup_logs_event_name
  ON cleanup_logs (event_name);

-- STEP 4: Verify schema
-- ============================================================================

SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'cleanup_logs'
ORDER BY ordinal_position;

-- Expected output:
-- column_name   | data_type | is_nullable | column_default
-- id            | bigint    | NO          | nextval('cleanup_logs_id_seq'::regclass)
-- request_id    | integer   | NO          | NULL
-- event_name    | text      | NO          | NULL
-- log_level     | text      | NO          | NULL
-- message       | text      | NO          | NULL
-- details_json  | jsonb     | YES         | NULL
-- created_at    | timestamp | NO          | now()

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check if table exists
SELECT EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_name = 'cleanup_logs'
) AS table_exists;

-- Check column count
SELECT COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_name = 'cleanup_logs';

-- Check if event_name column exists
SELECT EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_name = 'cleanup_logs'
  AND column_name = 'event_name'
) AS event_name_exists;

-- ============================================================================
-- TEST INSERT (Optional - uncomment to test)
-- ============================================================================

/*
INSERT INTO cleanup_logs (
  request_id,
  event_name,
  log_level,
  message,
  details_json
)
VALUES (
  1,
  'test_event',
  'info',
  'Test message',
  '{"test": true}'::jsonb
);

SELECT * FROM cleanup_logs ORDER BY id DESC LIMIT 1;
*/

-- ============================================================================
-- DONE
-- ============================================================================

SELECT 'cleanup_logs table schema fix completed' AS status;
