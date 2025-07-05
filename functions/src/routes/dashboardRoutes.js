const express = require('express');
const router = express.Router();
const { getCustomerDashboardSummary } = require('../controllers/dashboardController');

// Endpoint ini publik, tidak perlu login untuk melihatnya
router.get('/customer-summary', getCustomerDashboardSummary);

module.exports = router;