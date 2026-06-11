const express = require('express');
const pricingController = require('../controllers/pricingController');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true
  });
});

router.get('/', pricingController.getRetailPricing);
router.post('/calculate', pricingController.calculatePricing);

module.exports = router;
