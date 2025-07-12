const express = require('express');
const router = express.Router();
const {  createOrderWithPayment, getMidtransStatus } = require('../controllers/paymentController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { auth } = require('firebase-admin');

router.post('/initiate', authMiddleware, createOrderWithPayment);

// ✅ Tambahkan route baru untuk cek status Midtrans
router.get('/status/:orderId', authMiddleware, getMidtransStatus);

module.exports = router;