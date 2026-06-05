const express = require('express');
const servicePricingController = require('../controllers/servicePricingController');

const router = express.Router();

router.get('/', servicePricingController.getServicePricing);

module.exports = router;
