-- Test Setup for Hard Daily Usage Enforcement
-- Run these commands to test the hard enforcement feature

-- ============================================================================
-- 1. Check current usage status for a user
-- ============================================================================
SELECT 
  au.id as user_id,
  au.request_id,
  au.used_today_minutes,
  au.blocked_until,
  au.last_reset_date,
  r.daily_limit_minutes,
  r.enable_daily_usage,
  CASE 
    WHEN au.blocked_until IS NOT NULL AND au.blocked_until > NOW() THEN 'BLOCKED'
    WHEN au.used_today_minutes >= r.daily_limit_minutes THEN 'LIMIT_REACHED'
    ELSE 'ACTIVE'
  END as status
FROM azure_users au
JOIN requests r ON r.id = au.request_id
WHERE au.id = 1 AND au.request_id = 1;  -- Change IDs as needed

-- ============================================================================
-- 2. Simulate user reaching daily limit (for testing)
-- ============================================================================
-- Replace 1, 1 with your actual requestId and userId
UPDATE azure_users 
SET used_today_minutes = (
  SELECT daily_limit_minutes 
  FROM requests 
  WHERE id = 1
)
WHERE id = 1 AND request_id = 1;

-- ============================================================================
-- 3. Verify user is now at limit
-- ============================================================================
SELECT 
  au.id,
  au.used_today_minutes,
  r.daily_limit_minutes,
  (au.used_today_minutes >= r.daily_limit_minutes) as is_blocked
FROM azure_users au
JOIN requests r ON r.id = au.request_id
WHERE au.id = 1 AND au.request_id = 1;

-- ============================================================================
-- 4. Check active sessions
-- ============================================================================
SELECT 
  id,
  request_id,
  user_id,
  login_at,
  logout_at,
  EXTRACT(EPOCH FROM (NOW() - login_at)) / 60 as elapsed_minutes
FROM user_usage_sessions
WHERE user_id = 1 
  AND request_id = 1
  AND logout_at IS NULL;

-- ============================================================================
-- 5. Manually reset user (to test daily reset)
-- ============================================================================
UPDATE azure_users
SET 
  used_today_minutes = 0,
  blocked_until = NULL,
  last_reset_date = CURRENT_DATE
WHERE id = 1 AND request_id = 1;

-- ============================================================================
-- 6. Check enforcement logs
-- ============================================================================
SELECT 
  id,
  request_id,
  user_id,
  action,
  details,
  created_at
FROM usage_enforcement_logs
WHERE user_id = 1 AND request_id = 1
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================================
-- 7. View all blocked users
-- ============================================================================
SELECT 
  au.id,
  au.request_id,
  r.customer_email,
  au.used_today_minutes,
  r.daily_limit_minutes,
  au.blocked_until,
  au.last_reset_date
FROM azure_users au
JOIN requests r ON r.id = au.request_id
WHERE (au.blocked_until IS NOT NULL AND au.blocked_until > NOW())
   OR (r.enable_daily_usage = true AND au.used_today_minutes >= r.daily_limit_minutes)
ORDER BY au.blocked_until;

-- ============================================================================
-- 8. Simulate blocking a user until tomorrow
-- ============================================================================
UPDATE azure_users
SET blocked_until = DATE_TRUNC('day', NOW()) + INTERVAL '1 day'
WHERE id = 1 AND request_id = 1;

-- ============================================================================
-- 9. Test Scenario: User exceeds limit by 5 minutes
-- ============================================================================
UPDATE azure_users 
SET used_today_minutes = (
  SELECT daily_limit_minutes + 5
  FROM requests 
  WHERE id = 1
)
WHERE id = 1 AND request_id = 1;

-- ============================================================================
-- 10. Clean up test data (reset everything)
-- ============================================================================
UPDATE azure_users
SET 
  used_today_minutes = 0,
  blocked_until = NULL,
  last_reset_date = CURRENT_DATE
WHERE id = 1 AND request_id = 1;

-- Close any active sessions
UPDATE user_usage_sessions
SET 
  logout_at = NOW(),
  minutes_used = EXTRACT(EPOCH FROM (NOW() - login_at)) / 60
WHERE user_id = 1 
  AND request_id = 1
  AND logout_at IS NULL;
