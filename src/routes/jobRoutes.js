const express = require('express');
const jobController = require('../controllers/jobController');

const router = express.Router();

router.post('/', express.text({ type: ['text/csv', 'text/plain'] }), jobController.createProvisioningJob);
router.get('/:jobId', jobController.getProvisioningJob);

module.exports = router;
