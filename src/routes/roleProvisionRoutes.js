const express = require('express');
const roleProvisionController = require('../controllers/roleProvisionController');

const router = express.Router();

router.post('/request/:id/roles', roleProvisionController.provisionRolesForRequest);
router.get('/request/:id/roles', roleProvisionController.getRoleAssignmentsForRequest);

module.exports = router;
