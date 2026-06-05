const express = require('express');
const adminController = require('../controllers/adminController');

const router = express.Router();

router.post('/sync-services', adminController.syncServices);

module.exports = router;
