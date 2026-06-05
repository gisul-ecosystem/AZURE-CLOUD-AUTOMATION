const express = require('express');
const serviceController = require('../controllers/serviceController');

const router = express.Router();

router.get('/locations', serviceController.getLocations);

module.exports = router;
