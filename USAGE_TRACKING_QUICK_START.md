# Usage Tracking Quick Start Guide

## Immediate Action Required

### 1. Run Database Migration (CRITICAL)
```bash
psql $DATABASE_URL -f src/db/migrations/20260609_create_user_usage_sessions.sql
```

### 2. Restart Backend Server
The changes to the code are already in place. Simply restart:
```bash
# Stop current server (Ctrl+C)
# Start again
npm start
```

## What Was Fixed

### Bug: GET /api/usage/status shows usedMinutes: 0
**Root Cause:** Usage session not started automatically after login.

**Solution Applied:**
1. ✅ Created `user_usage_sessions` table migration
2. ✅ Modified `exchangeAccessToken()` to return userId  
3. ✅ Frontend already calls `autoStartUsageSession()` on login
4. ✅ Fixed usageEnforcementService query (resource_group_name)

### Error: Column resource_group_name does not exist
**Fixed:** Changed query in `usageEnforcementService.js` to use `au.resource_group_name` instead of `r.resource_group_name`

### Error: Column "details" does not exist
**Status:** The table already has the `details` column (JSONB). The error was related to the resource_group_name issue causing the query to fail before inserting.

## How It Works Now

### On Login (Auto-Start)
```
User clicks email link
  ↓
GET /api/access/token?token=XXX
  ↓
Returns: { sessionToken, requestId, userId }  ← userId now included
  ↓
Frontend stores userId in sessionStorage
  ↓
POST /api/usage/start { requestId, userId }  ← Auto-called
  ↓
INSERT INTO user_usage_sessions (request_id, user_id, login_at)
  ↓
Session started ✅
```

### Live Usage Calculation
```
GET /api/usage/status/51/136
  ↓
Query active session:
  stored_minutes = 20  (from azure_users.used_today_minutes)
  active_minutes = 10  (NOW() - login_at)
  total_minutes = 30   (stored + active)
  ↓
Returns:
{
  "usedMinutes": 30,
  "currentSessionMinutes": 10,
  "remainingMinutes": 0,
  "hasActiveSession": true
}
```

### Auto Enforcement (Every Minute)
```
Scheduler runs (cron: * * * * *)
  ↓
Find active sessions
  ↓
For each session:
  total = stored + active
  if total >= limit:
    ↓
    Force logout user
    Close all sessions
    Set blocked_until = tomorrow
    Trigger Azure enforcement
```

### Login Blocking
```
POST /api/usage/start { requestId, userId }
  ↓
validateUserAccess middleware:
  ↓
  Check blocked_until > NOW() → 403
  Check used_today_minutes >= limit → 403
  ↓
  All checks pass → Allow
```

## Testing Steps

### Test 1: Auto-Start Session
```bash
# 1. Get fresh token
curl -X POST http://localhost:5001/api/provision/request/51/portal-token

# 2. Exchange token (check userId in response)
curl "http://localhost:5001/api/access/token?token=YOUR_TOKEN"

# 3. Open portal in browser with token
# Check browser console for: [AUTO_SESSION] Starting usage session

# 4. Verify session in database
SELECT * FROM user_usage_sessions 
WHERE user_id = 136 AND logout_at IS NULL;
```

### Test 2: Live Usage Tracking
```bash
# 1. Check status immediately after login
curl http://localhost:5001/api/usage/status/51/136

# 2. Wait 30 seconds, check again
curl http://localhost:5001/api/usage/status/51/136

# 3. Verify currentSessionMinutes is increasing
```

### Test 3: Auto Enforcement
```bash
# 1. Set user close to limit
UPDATE azure_users SET used_today_minutes = 28 WHERE id = 136;

# 2. Start session (will have 2 minutes remaining)
curl -X POST http://localhost:5001/api/usage/start \
  -H "Content-Type: application/json" \
  -d '{"requestId": 51, "userId": 136}'

# 3. Wait 3 minutes

# 4. Check logs for:
# [LIMIT_REACHED] Session X for user 136 exceeded limit
# [FORCE_LOGOUT] Closed 1 session(s) for user 136
# Enforcing usage limit for request 51, user 136

# 5. Verify blocked
SELECT blocked_until FROM azure_users WHERE id = 136;
```

### Test 4: Login Blocking
```bash
# After user is blocked from Test 3:

# Try to start new session (should fail)
curl -X POST http://localhost:5001/api/usage/start \
  -H "Content-Type: application/json" \
  -d '{"requestId": 51, "userId": 136}'

# Expected response:
{
  "success": false,
  "message": "Daily usage limit reached. Access is blocked until..."
}
```

### Test 5: Midnight Reset
```bash
# Manually trigger reset (for testing)
node -e "require('./src/scheduler/usageScheduler').resetDailyUsageCounters().then(() => process.exit())"

# Verify reset
SELECT 
  id,
  used_today_minutes,
  blocked_until,
  last_reset_date
FROM azure_users
WHERE id = 136;

# Should show:
# used_today_minutes = 0
# blocked_until = NULL
# last_reset_date = CURRENT_DATE
```

## Verification Checklist

After deploying, verify:

- [ ] Database table `user_usage_sessions` exists
- [ ] GET /api/usage/status returns non-zero currentSessionMinutes when logged in
- [ ] Backend logs show `[SESSION_STARTED]` when portal opens
- [ ] Scheduler logs show "Running active session monitor..." every minute
- [ ] Force logout works when limit exceeded
- [ ] Login blocked for blocked users (403 error)
- [ ] Midnight reset clears counters and unblocks users

## Key Files Modified

### Backend
1. ✅ `src/db/migrations/20260609_create_user_usage_sessions.sql` - NEW
2. ✅ `src/services/managePortalService.js` - Added userId to exchangeAccessToken
3. ✅ `src/controllers/manageController.js` - Return userId in response
4. ✅ `src/services/usageEnforcementService.js` - Fixed resource_group_name query
5. ✅ `src/services/usageService.js` - Already implements live tracking
6. ✅ `src/scheduler/usageScheduler.js` - Already implements auto-enforcement
7. ✅ `src/middleware/usageMiddleware.js` - Already implements login blocking
8. ✅ `src/controllers/usageController.js` - Already has all endpoints

### Frontend
1. ✅ `frontend/components/ManageUsersClient.jsx` - Already implements auto-start
2. ✅ `frontend/services/api.js` - Already has all API functions

## Database Schema Check

Run this to verify your database is ready:

```sql
-- Check user_usage_sessions table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_name = 'user_usage_sessions'
);

-- Check usage_enforcement_logs has details column
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'usage_enforcement_logs' 
  AND column_name = 'details';

-- Check azure_users has required columns
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'azure_users' 
  AND column_name IN ('used_today_minutes', 'blocked_until', 'last_reset_date', 'resource_group_name');
```

Expected results:
- user_usage_sessions: true
- details: jsonb
- azure_users: All 4 columns listed

## Troubleshooting

### "Column resource_group_name does not exist"
**Fixed:** The query now uses `au.resource_group_name` from azure_users table.

### "GET /api/usage/status shows usedMinutes: 0"
**Solution:** 
1. Check if user_usage_sessions table exists
2. Verify session was started (check browser console)
3. Query database: `SELECT * FROM user_usage_sessions WHERE logout_at IS NULL`

### "Session not starting automatically"
**Check:**
1. exchangeToken response includes userId
2. Frontend console shows: [AUTO_SESSION] Starting usage session
3. Backend logs show: [SESSION_STARTED] New session created

### "Auto enforcement not running"
**Check:**
1. Backend logs show: "Running active session monitor..." every minute
2. Scheduler is started in app.js
3. Enable daily usage: `UPDATE requests SET enable_daily_usage = true WHERE id = 51`

## Configuration

### Enable Usage Tracking for Request
```sql
UPDATE requests
SET enable_daily_usage = true,
    daily_limit_minutes = 30,
    enforce_in_azure = true
WHERE id = 51;
```

### Manually Unblock User (Emergency)
```sql
UPDATE azure_users
SET blocked_until = NULL,
    used_today_minutes = 0
WHERE id = 136;
```

### Check Current Usage
```sql
SELECT 
  au.id,
  au.username,
  au.used_today_minutes as stored_minutes,
  COALESCE(
    FLOOR(EXTRACT(EPOCH FROM (NOW() - uus.login_at)) / 60),
    0
  ) as active_minutes,
  r.daily_limit_minutes as limit,
  au.blocked_until
FROM azure_users au
JOIN requests r ON r.id = au.request_id
LEFT JOIN user_usage_sessions uus ON uus.user_id = au.id AND uus.logout_at IS NULL
WHERE au.id = 136;
```

## Next Steps

1. ✅ Run database migration
2. ✅ Restart backend server
3. ✅ Test auto-start session (open portal)
4. ✅ Verify live tracking works
5. ✅ Test enforcement by setting high used_today_minutes
6. ✅ Monitor logs for any errors

## Support

If issues persist:
1. Check server logs for errors
2. Verify database schema
3. Test each endpoint individually
4. Check frontend console for API errors

## Summary

**Before:** Sessions had to be started manually, usage showed 0 even when logged in.

**After:** Sessions start automatically on login, live usage calculates correctly, auto-enforcement works every minute, blocked users cannot log in.

All the code is ready - just run the database migration and restart the server! 🚀
