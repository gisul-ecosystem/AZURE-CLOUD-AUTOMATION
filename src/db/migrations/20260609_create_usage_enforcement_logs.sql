-- Create usage enforcement logs table
-- This table tracks all enforcement actions taken when daily usage limits are exceeded

CREATE TABLE IF NOT EXISTS usage_enforcement_logs (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES azure_users(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_usage_enforcement_logs_request_id 
  ON usage_enforcement_logs(request_id);

CREATE INDEX IF NOT EXISTS idx_usage_enforcement_logs_user_id 
  ON usage_enforcement_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_usage_enforcement_logs_created_at 
  ON usage_enforcement_logs(created_at DESC);

-- Add comment
COMMENT ON TABLE usage_enforcement_logs IS 'Logs all enforcement actions taken when daily usage limits are exceeded';
