const express = require('express');
const cleanupController = require('../controllers/cleanupController');

const router = express.Router();

router.post('/request/:id', cleanupController.cleanupRequest);
router.get('/request/:id', cleanupController.getCleanupStatus);

module.exports = router;
