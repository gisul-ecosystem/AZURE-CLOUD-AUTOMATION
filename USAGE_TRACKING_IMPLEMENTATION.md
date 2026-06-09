# Daily Usage Tracking + Auto Logout + Login Blocking - Implementation Guide

## Overview
Complete implementation of live usage tracking with automatic session management, enforcement, and blocking.

## Database Schema

### 1. User Usage Sessions Table
**File:** `src/db/migrations/20260609_create_user_usage_sessions.sql`

```sql
CREATE TABLE user_usage_sessions (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  user_id INTEGER NOT NULL REFERENCES azure_users(id),
  login_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  logout_at TIMESTAMP WITH TIME ZONE,
  minutes_used NUMERIC(10, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Run Migration:**
```bash
psql $DATABASE_URL -f src/db/migrations/20260609_create_user_usage_sessions.sql
```

### 2. Usage Enforcement Logs Table
**File:** `src/db/migrations/20260609_create_usage_enforcement_logs.sql`
Already exists - tracks enforcement actions.

## Backend Implementation

### 1. Auto Start Session on Login ✅

**File:** `src/services/managePortalService.js`
- Modified `exchangeAccessToken()` to return `userId`
- Fetches first azure_user for the request
- Returns userId in token exchange response

**File:** `src/controllers/manageController.js`
- Updated `exchangeToken()` to include userId in response

**Flow:**
```
User clicks email link with token
  → Frontend calls GET /api/access/token?token=XXX
  → Backend exchanges token → returns { sessionToken, requestId, userId }
  → Frontend stores userId in sessionStorage
  → Frontend calls POST /api/usage/start { requestId, userId }
  → Session starts automatically
```

### 2. Live Usage Calculation ✅

**File:** `src/services/usageService.js`

**Function:** `getUsageStatus({ requestId, userId })`

```javascript
// Calculates LIVE usage:
storedMinutes = azure_users.used_today_minutes  // Minutes from closed sessions
activeMinutes = NOW() - login_at                 // Minutes from current active session
usedMinutes = storedMinutes + activeMinutes     // Total usage
remainingMinutes = daily_limit_minutes - usedMinutes
```

**Returns:**
```json
{
  "usedMinutes": 45,           // Total used (stored + active)
  "storedUsedMinutes": 30,     // From closed sessions
  "currentSessionMinutes": 15, // From active session
  "remainingMinutes": 15,      // Remaining time
  "hasActiveSession": true,    // Is user logged in?
  "blocked": false,            // Is user blocked?
  "blockedUntil": null         // When block expires
}
```

### 3. Auto Enforcement (Every Minute) ✅

**File:** `src/scheduler/usageScheduler.js`

**Function:** `monitorActiveSessions()` - Runs every minute via cron

```javascript
// For each active session:
1. Calculate: totalMinutes = stored + active
2. If totalMinutes >= dailyLimitMinutes:
   → Call forceLogoutUser()
   → Close all sessions
   → Update used_today_minutes
   → Set blocked_until = tomorrow midnight
   → Trigger Azure enforcement (revoke roles, stop resources)
```

### 4. Force Logout ✅

**File:** `src/services/usageService.js`

**Function:** `forceLogoutUser({ requestId, userId })`

**Actions:**
1. Find all active sessions (logout_at IS NULL)
2. Calculate total minutes used
3. Close all sessions:
   ```sql
   UPDATE user_usage_sessions
   SET logout_at = NOW(),
       minutes_used = EXTRACT(EPOCH FROM (NOW() - login_at)) / 60
   WHERE logout_at IS NULL
   ```
4. Update user totals and block:
   ```sql
   UPDATE azure_users
   SET used_today_minutes = used_today_minutes + total_minutes,
       blocked_until = (CURRENT_DATE + INTERVAL '1 day')
   ```
5. Trigger Azure enforcement (async)

**Endpoint:** `POST /api/usage/force-logout`
```json
{
  "requestId": 51,
  "userId": 136
}
```

### 5. Login Blocking ✅

**File:** `src/middleware/usageMiddleware.js`

**Middleware:** `validateUserAccess`

Applied to:
- `POST /api/usage/start` (session start)
- `DELETE /api/access/user/:userId` (user deletion)
- `PATCH /api/access/user/:userId/roles` (role updates)

**Checks:**
1. Request expired or cancelled → 403
2. User blocked (blocked_until > NOW) → 403 "Daily usage limit reached"
3. Daily limit reached (used_today_minutes >= daily_limit_minutes) → 403
4. All checks pass → Allow access

**Error Response:**
```json
{
  "success": false,
  "message": "Daily usage limit reached. Access is blocked until 2026-06-10T00:00:00Z. Please try again tomorrow."
}
```

### 6. Azure Enforcement ✅

**File:** `src/services/usageEnforcementService.js`

**Function:** `enforceUsageLimit({ requestId, userId })`

**Fixed:** Changed query to use `au.resource_group_name` instead of `r.resource_group_name`

**Actions:**
1. Revoke Azure RBAC role assignments
2. Stop Azure resources (VMs, AKS, App Services)
3. Log enforcement action
4. User account preserved (NOT deleted)

### 7. Midnight Reset ✅

**File:** `src/scheduler/usageScheduler.js`

**Function:** `resetDailyUsageCounters()` - Runs daily at 00:00 via cron

```sql
UPDATE azure_users
SET used_today_minutes = 0,
    blocked_until = NULL,
    last_reset_date = CURRENT_DATE
WHERE request_id IN (
  SELECT id FROM requests 
  WHERE enable_daily_usage = true
)
```

**Logging:**
- Logs reset for each user
- Logs enforcement action to `usage_enforcement_logs`

## Frontend Implementation

### 1. Auto Start Session on Login ✅

**File:** `frontend/components/ManageUsersClient.jsx`

**Function:** `autoStartUsageSession(reqId, usrId)`

**Flow:**
```javascript
// On component mount (useEffect):
1. Exchange token → Get { sessionToken, requestId, userId }
2. Store userId in sessionStorage
3. Call autoStartUsageSession(requestId, userId)
4. POST /api/usage/start { requestId, userId }
5. Session started → Live tracking begins
```

### 2. Handle 403 Blocking Errors ✅

**File:** `frontend/components/ManageUsersClient.jsx`

**Function:** `handleAccessError(error)`

```javascript
if (error.status === 403 && message.includes('Daily usage limit')) {
  // Clear session
  window.sessionStorage.clear();
  
  // Show error message
  setError('Daily usage limit reached. Access will be restored tomorrow.');
  
  // Force logout from portal
  setSessionToken('');
}
```

### 3. Live Usage Display (Optional Enhancement)

**File:** `frontend/services/api.js`

Already has:
```javascript
export async function getUsageStatus(requestId, userId) {
  return requestJson(`/api/usage/status/${requestId}/${userId}`);
}
```

**To add live usage bar to portal:**
```jsx
const [usageStatus, setUsageStatus] = useState(null);

useEffect(() => {
  const interval = setInterval(async () => {
    const status = await getUsageStatus(requestId, userId);
    setUsageStatus(status);
  }, 30000); // Update every 30 seconds
  
  return () => clearInterval(interval);
}, [requestId, userId]);

// Display:
<div className="usage-bar">
  {usageStatus?.usedMinutes} / {usageStatus?.dailyLimitMinutes} minutes
  ({usageStatus?.remainingMinutes} remaining)
</div>
```

## API Endpoints Summary

### Session Management
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/usage/start` | POST | Start usage session | Hard blocking |
| `/api/usage/end` | POST | End usage session | None |
| `/api/usage/status/:requestId/:userId` | GET | Get live usage status | None |
| `/api/usage/sessions/active` | GET | List active sessions | None |
| `/api/usage/force-logout` | POST | Force logout user | None |

### Portal Access
| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/access/token?token=XXX` | GET | Exchange token for session | None |
| `/api/access/request/:requestId` | GET | Get request users | Session |
| `/api/access/user/:userId` | DELETE | Delete user | Hard blocking |
| `/api/access/user/:userId/roles` | PATCH | Update user roles | Hard blocking |

## Logging Events

All logged to console with structured JSON:

### Session Events
- `[SESSION_STARTED]` - Session created
- `[SESSION_ENDED]` - Session closed
- `[FORCE_LOGOUT]` - User force logged out
- `[AUTO_SESSION]` - Auto-start session attempt

### Enforcement Events
- `[LIMIT_REACHED]` - User exceeded limit
- `[LOGIN_BLOCKED]` - Login attempt blocked
- `[ENFORCEMENT]` - Azure enforcement triggered
- `[USAGE_RESET]` - Daily reset executed
- `[ACCESS_RESTORED]` - Access restored after reset

### Database Logs
- `usage_enforcement_logs` table tracks all enforcement actions
- `access_portal_audit_logs` tracks portal actions

## Testing

### 1. Test Auto Session Start
```bash
# Get a fresh token
curl http://localhost:5001/api/provision/request/51/portal-token

# Exchange token (should return userId)
curl "http://localhost:5001/api/access/token?token=XXX"

# Check session started automatically (from browser console or logs)
```

### 2. Test Live Usage
```bash
# Start session
curl -X POST http://localhost:5001/api/usage/start \
  -H "Content-Type: application/json" \
  -d '{"requestId": 51, "userId": 136}'

# Check status multiple times (watch currentSessionMinutes increase)
curl http://localhost:5001/api/usage/status/51/136

# Wait 1 minute, check again
curl http://localhost:5001/api/usage/status/51/136
```

### 3. Test Auto Enforcement
```bash
# Manually set used_today_minutes close to limit
UPDATE azure_users 
SET used_today_minutes = 28 
WHERE id = 136;

# Start session
curl -X POST http://localhost:5001/api/usage/start \
  -H "Content-Type: application/json" \
  -d '{"requestId": 51, "userId": 136}'

# Wait 2-3 minutes for scheduler to run
# Check logs for [FORCE_LOGOUT] message

# Verify blocked
curl http://localhost:5001/api/usage/status/51/136
# Should show blocked: true

# Try to start new session (should fail with 403)
curl -X POST http://localhost:5001/api/usage/start \
  -H "Content-Type: application/json" \
  -d '{"requestId": 51, "userId": 136}'
```

### 4. Test Login Blocking
```bash
# After user is blocked, try to access portal
curl "http://localhost:5001/api/access/token?token=FRESH_TOKEN"
# Should succeed (token exchange doesn't block)

# Try to start session (should fail)
curl -X POST http://localhost:5001/api/usage/start \
  -H "Content-Type: application/json" \
  -d '{"requestId": 51, "userId": 136}'
# Should return 403 with "Daily usage limit reached"
```

### 5. Test Midnight Reset
```bash
# Manually trigger reset
curl -X POST http://localhost:5001/api/test/reset-usage

# Or run via scheduler function directly
node -e "require('./src/scheduler/usageScheduler').resetDailyUsageCounters()"

# Verify reset
SELECT id, used_today_minutes, blocked_until, last_reset_date 
FROM azure_users 
WHERE id = 136;
```

## Deployment Checklist

- [x] Run database migration for user_usage_sessions table
- [x] Verify usage_enforcement_logs table has details column
- [x] Update backend services (usageService, usageEnforcementService)
- [x] Update middleware (usageMiddleware)
- [x] Update controllers (manageController, usageController)
- [x] Update portal service (managePortalService)
- [x] Verify schedulers running (usageScheduler)
- [x] Update frontend (ManageUsersClient)
- [x] Test auto-start session on login
- [x] Test live usage calculation
- [x] Test auto-enforcement
- [x] Test login blocking
- [x] Test midnight reset

## Troubleshooting

### Session Not Starting
Check:
1. userId returned from token exchange
2. Frontend storing userId in sessionStorage
3. POST /api/usage/start being called
4. Backend logs for [SESSION_STARTED]

### Usage Shows 0 Minutes
Check:
1. Active session exists (SELECT * FROM user_usage_sessions WHERE logout_at IS NULL)
2. GET /api/usage/status/:requestId/:userId being called
3. Query calculating elapsed minutes correctly

### Auto Enforcement Not Working
Check:
1. Scheduler running (logs show "Running active session monitor...")
2. enable_daily_usage = true for request
3. Active sessions returned by getActiveSessions()
4. used_today_minutes + current_session_minutes >= daily_limit_minutes

### Login Not Blocked
Check:
1. blocked_until set in azure_users table
2. blocked_until > NOW()
3. validateUserAccess middleware applied to route
4. Middleware checking blocked_until correctly

### Azure Enforcement Fails
Check:
1. resource_group_name exists in azure_users table
2. principal_id valid
3. Azure credentials configured
4. enforce_in_azure = true for request

## Configuration

### Enable Daily Usage for Request
```sql
UPDATE requests
SET enable_daily_usage = true,
    daily_limit_minutes = 30,
    enforce_in_azure = true
WHERE id = 51;
```

### Check User Status
```sql
SELECT 
  au.id,
  au.username,
  au.used_today_minutes,
  au.blocked_until,
  au.last_reset_date,
  r.daily_limit_minutes,
  r.enable_daily_usage,
  (SELECT COUNT(*) FROM user_usage_sessions 
   WHERE user_id = au.id AND logout_at IS NULL) as active_sessions
FROM azure_users au
JOIN requests r ON r.id = au.request_id
WHERE au.id = 136;
```

### Manually Unblock User (Emergency)
```sql
UPDATE azure_users
SET blocked_until = NULL,
    used_today_minutes = 0
WHERE id = 136;

-- Close any active sessions
UPDATE user_usage_sessions
SET logout_at = NOW(),
    minutes_used = EXTRACT(EPOCH FROM (NOW() - login_at)) / 60
WHERE user_id = 136 AND logout_at IS NULL;
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ManageUsersClient.jsx                               │  │
│  │  1. Exchange token → Get userId                      │  │
│  │  2. Auto-start session                               │  │
│  │  3. Handle 403 blocking errors                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Backend API                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  POST /api/usage/start                               │  │
│  │  → validateUserAccess middleware                     │  │
│  │  → usageController.startUsageSession                 │  │
│  │  → usageService.startUsageSession                    │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  GET /api/usage/status/:requestId/:userId            │  │
│  │  → usageController.getUsageStatus                    │  │
│  │  → usageService.getUsageStatus                       │  │
│  │  → Calculate LIVE usage                              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Scheduler                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  usageScheduler.js                                   │  │
│  │  • Every minute: monitorActiveSessions()            │  │
│  │    → Check if limit exceeded                         │  │
│  │    → Force logout                                    │  │
│  │    → Block user                                      │  │
│  │    → Trigger Azure enforcement                       │  │
│  │  • Midnight: resetDailyUsageCounters()              │  │
│  │    → Reset used_today_minutes                        │  │
│  │    → Clear blocked_until                             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Database                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  user_usage_sessions                                 │  │
│  │  • id, request_id, user_id                           │  │
│  │  • login_at, logout_at, minutes_used                 │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  azure_users                                         │  │
│  │  • used_today_minutes (stored)                       │  │
│  │  • blocked_until, last_reset_date                    │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  usage_enforcement_logs                              │  │
│  │  • action, details, created_at                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Azure Enforcement                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  usageEnforcementService.js                          │  │
│  │  • Revoke RBAC role assignments                      │  │
│  │  • Stop VMs, AKS, App Services                       │  │
│  │  • Preserve user account                             │  │
│  │  • Log enforcement actions                           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

✅ **Auto Start Session**: Session starts automatically when user logs into portal
✅ **Live Usage Tracking**: Real-time calculation of used minutes (stored + active)
✅ **Auto Enforcement**: Scheduler monitors every minute, force logout when limit reached
✅ **Login Blocking**: Hard enforcement prevents blocked users from accessing portal
✅ **Azure Enforcement**: Revokes roles and stops resources (user account preserved)
✅ **Midnight Reset**: Automatic daily reset of counters and blocks
✅ **Comprehensive Logging**: All actions logged to console and database
✅ **Frontend Integration**: Auto-start and error handling built into portal
✅ **Session Management**: Multiple sessions tracked, all closed on limit exceeded
✅ **Grace Handling**: Active session time included in limit calculations

## Known Issues & Solutions

### Issue: Column resource_group_name does not exist on requests table
**Solution:** Changed query in usageEnforcementService.js to use `au.resource_group_name` from azure_users table instead.

### Issue: GET /api/usage/status shows usedMinutes: 0 even when logged in
**Root Cause:** Session not started automatically after login.
**Solution:** Modified exchangeAccessToken to return userId, frontend auto-starts session on login.

### Issue: Auto enforcement async errors don't block the flow
**Solution:** Errors are logged but don't throw, allowing graceful degradation.

## Success Metrics

- Session start success rate: >99%
- Live usage accuracy: ±1 minute
- Enforcement latency: <2 minutes from limit exceeded
- Login blocking accuracy: 100%
- Midnight reset reliability: 100%
