const express = require('express');
const serviceController = require('../controllers/serviceController');

const router = express.Router();

router.get('/pricing', serviceController.getServicePricing);
router.get('/', serviceController.getServices);

module.exports = router;
