const express = require('express');
const userProvisionController = require('../controllers/userProvisionController');

const router = express.Router();

router.post('/request/:id/users', userProvisionController.provisionUsersForRequest);
router.get('/request/:id/users', userProvisionController.getUsersForRequest);

module.exports = router;
