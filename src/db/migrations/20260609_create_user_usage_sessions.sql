-- Create user_usage_sessions table for tracking login/logout sessions
-- This table tracks when users log in and out of the portal for daily usage enforcement

CREATE TABLE IF NOT EXISTS user_usage_sessions (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES azure_users(id) ON DELETE CASCADE,
  login_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  logout_at TIMESTAMP WITH TIME ZONE,
  minutes_used NUMERIC(10, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_user_usage_sessions_request_id 
  ON user_usage_sessions(request_id);

CREATE INDEX IF NOT EXISTS idx_user_usage_sessions_user_id 
  ON user_usage_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_user_usage_sessions_active 
  ON user_usage_sessions(request_id, user_id, logout_at) 
  WHERE logout_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_usage_sessions_login_at 
  ON user_usage_sessions(login_at DESC);

-- Add comment
COMMENT ON TABLE user_usage_sessions IS 'Tracks user login/logout sessions for daily usage enforcement';
COMMENT ON COLUMN user_usage_sessions.login_at IS 'When the user logged into the portal';
COMMENT ON COLUMN user_usage_sessions.logout_at IS 'When the user logged out (NULL = still active)';
COMMENT ON COLUMN user_usage_sessions.minutes_used IS 'Total minutes used in this session';
