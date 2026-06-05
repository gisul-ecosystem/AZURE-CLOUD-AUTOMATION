const express = require('express');
const azureController = require('../controllers/azureController');

const router = express.Router();

router.get('/test', azureController.testAzureConnection);

module.exports = router;
