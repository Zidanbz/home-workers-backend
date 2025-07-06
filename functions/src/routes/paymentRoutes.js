const express = require('express');
const router = express.Router();
const { initiatePayment } = require('../controllers/paymentController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/initiate', authMiddleware, initiatePayment);

module.exports = router;