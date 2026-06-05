const express = require('express');
const provisionController = require('../controllers/provisionController');

const router = express.Router();

router.post('/request/:id', provisionController.provisionRequestResourceGroup);
router.get('/request/:id', provisionController.getProvisionedRequest);

module.exports = router;
