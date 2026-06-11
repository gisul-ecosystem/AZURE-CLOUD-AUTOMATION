const express = require('express');
const adminAccessRequestController = require('../controllers/adminAccessRequestController');

const router = express.Router();

router.post('/', adminAccessRequestController.createAdminAccessRequest);

module.exports = router;
