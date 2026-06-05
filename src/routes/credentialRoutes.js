const express = require('express');
const credentialController = require('../controllers/credentialController');

const router = express.Router();

router.post('/request/:id/send-credentials', credentialController.sendCredentialsForRequest);
router.get('/request/:id/credentials', credentialController.getCredentialDelivery);

module.exports = router;
