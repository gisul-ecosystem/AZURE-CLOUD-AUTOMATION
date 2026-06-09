const express = require('express');
const credentialController = require('../controllers/credentialController');

const router = express.Router();

// Admin routes - don't enforce user-specific daily usage limits at route level
router.get('/request/:id/send-credentials', credentialController.sendCredentials);
router.post('/request/:id/send-credentials', credentialController.sendCredentials);
router.get('/request/:id/credentials', credentialController.getCredentialDelivery);

module.exports = router;
