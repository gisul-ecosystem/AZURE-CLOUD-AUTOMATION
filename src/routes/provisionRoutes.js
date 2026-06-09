const express = require('express');
const provisionController = require('../controllers/provisionController');

const router = express.Router();

// Admin routes - don't enforce user-specific daily usage limits
router.post('/request/:id', provisionController.provisionRequestResourceGroup);
router.get('/request/:id', provisionController.getProvisionedRequest);

module.exports = router;
