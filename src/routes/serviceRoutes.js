const express = require('express');
const serviceController = require('../controllers/serviceController');

const router = express.Router();

router.get('/catalog', serviceController.getCatalogServices);
router.get('/available-instances', serviceController.getAvailableInstances);
router.get('/available-locations', serviceController.getAvailableLocations);
router.get('/pricing', serviceController.getServicePricing);
router.get('/:serviceId/roles', serviceController.getServiceRoles);
router.get('/', serviceController.getServices);

module.exports = router;
