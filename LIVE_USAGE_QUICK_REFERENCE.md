# LIVE Usage Calculation - Quick Reference

## ✅ Fix Applied and Working!

The Daily Usage calculation now tracks usage **LIVE** while sessions are active.

---

## 🎯 What Changed?

### Before (❌ Broken)
```json
GET /api/usage/status/1/1

// User logged in 10 minutes ago
{
  "usedMinutes": 0,  // ❌ Wrong! Shows 0
  "hasActiveSession": true
}
```

### After (✅ Fixed)
```json
GET /api/usage/status/1/1

// User logged in 10 minutes ago
{
  "usedMinutes": 10,  // ✅ Correct! Shows 10
  "storedUsedMinutes": 0,
  "currentSessionMinutes": 10,
  "hasActiveSession": true,
  "remainingMinutes": 50
}
```

---

## 🧪 Quick Test

```bash
# 1. Start session
curl -X POST http://localhost:3000/api/usage/start \
  -H "Content-Type: application/json" \
  -d '{"requestId": 1, "userId": 1}'

# 2. Wait 2 minutes

# 3. Check status (should show ~2 minutes)
curl http://localhost:3000/api/usage/status/1/1

# 4. Wait 3 more minutes

# 5. Check again (should show ~5 minutes)
curl http://localhost:3000/api/usage/status/1/1

# 6. End session
curl -X POST http://localhost:3000/api/usage/end \
  -H "Content-Type: application/json" \
  -d '{"requestId": 1, "userId": 1}'
```

---

## 📊 Response Structure

### Status Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `usedMinutes` | number | **Total** = stored + current session (LIVE) |
| `storedUsedMinutes` | number | Minutes from completed sessions |
| `currentSessionMinutes` | number | Elapsed minutes of active session |
| `remainingMinutes` | number | Limit - usedMinutes |
| `hasActiveSession` | boolean | True if session is active |
| `activeSessionId` | number | ID of active session (if any) |
| `blocked` | boolean | True if limit exceeded |

### Example: User in Active Session

```json
{
  "requestId": 1,
  "userId": 1,
  "enableDailyUsage": true,
  "dailyLimitMinutes": 60,
  "usedMinutes": 37,           // 25 + 12
  "storedUsedMinutes": 25,     // From previous sessions
  "currentSessionMinutes": 12, // Elapsed in current session (LIVE)
  "remainingMinutes": 23,      // 60 - 37
  "blocked": false,
  "hasActiveSession": true,
  "activeSessionId": 128
}
```

---

## 🔍 Logs to Look For

### When Checking Status
```
[USAGE_STATUS_CALCULATED] Calculating live usage for request 1, user 1
[USAGE_STATUS_CALCULATED] Request 1, User 1: stored=25, active=12, total=37, limit=60, blocked=false
```

### When Starting Session
```
[SESSION_STARTED] Starting session for request 1, user 1
[SESSION_STARTED] New session created: 128 at 2026-06-09T15:30:00Z
```

### When Ending Session
```
[SESSION_ENDED] Ending session for request 1, user 1
[SESSION_ENDED] Session 128: login=..., logout=..., elapsed=12 minutes
[SESSION_ENDED] User 1 total usage: 37/60 minutes
[SESSION_ENDED] Session 128 ended successfully. 12 minutes used.
```

### When Limit Exceeded
```
[LIMIT_REACHED] User 1 exceeded limit. Blocking until tomorrow.
```

---

## 📝 Files Modified

1. **`src/services/usageService.js`**
   - `getUsageStatus()` - Calculates LIVE usage
   - `startUsageSession()` - Added logging
   - `endUsageSession()` - Added logging
   - `getActiveSessions()` - Shows LIVE totals

2. **`src/middleware/usageMiddleware.js`**
   - `validateDailyUsage()` - Validates using LIVE usage

---

## 🚀 Ready to Use!

The server is running with LIVE usage calculation. Your status endpoint now shows real-time usage!

**Test it:** Run `node test_live_usage.js <requestId> <userId>` to verify.

---

**Status:** ✅ Working  
**Updated:** June 9, 2026
