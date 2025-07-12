const express = require('express');
const router = express.Router();
const { handleMidtransCallback } = require('../controllers/midtransController');
const { tryCatch } = require('../utils/responseHelper');

// Endpoint untuk menerima callback dari Midtrans
router.post('/callback', tryCatch(handleMidtransCallback));

module.exports = router;
