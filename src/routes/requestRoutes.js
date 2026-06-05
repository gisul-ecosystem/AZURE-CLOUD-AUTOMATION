const express = require('express');
const requestController = require('../controllers/requestController');

const router = express.Router();

router.get('/', requestController.getAllRequests);
router.post('/', requestController.createRequest);
router.get('/:id', requestController.getRequestById);

module.exports = router;
