const express = require('express');
const usageController = require('../controllers/usageController');
const { validateDailyUsage, validateUserAccess } = require('../middleware/usageMiddleware');

const router = express.Router();

// Start usage session - HARD ENFORCEMENT
router.post('/start', validateUserAccess, usageController.startUsageSession);

// End usage session
router.post('/end', usageController.endUsageSession);

// Get usage status for a specific user and request
router.get('/status/:requestId/:userId', usageController.getUsageStatus);

// Get all active sessions (for monitoring)
router.get('/sessions/active', usageController.getActiveSessions);

// Force logout a user (admin action or enforcement)
router.post('/force-logout', usageController.forceLogout);

// Example of protected route using validateDailyUsage middleware
// router.post('/protected-action', validateDailyUsage, (req, res) => {
//   res.json({ success: true, usageInfo: req.usageInfo });
// });

module.exports = router;
