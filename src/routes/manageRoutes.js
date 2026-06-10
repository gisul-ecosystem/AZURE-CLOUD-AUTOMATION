const express = require('express');
const manageController = require('../controllers/manageController');
const { validateUserAccess } = require('../middleware/usageMiddleware');

const router = express.Router();

router.get('/token', manageController.exchangeToken);
router.post('/login', manageController.exchangeToken);
router.get('/request/:requestId', manageController.getRequest);
// Protected routes - require access validation (these have userId)
router.delete('/user/:userId', validateUserAccess, manageController.deleteUser);
router.patch('/user/:userId/roles', validateUserAccess, manageController.updateRoles);

module.exports = router;
