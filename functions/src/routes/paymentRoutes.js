const express = require('express');
const router = express.Router();
const {  createOrderWithPayment, getMidtransStatus, startPaymentForQuote } = require('../controllers/paymentController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { auth } = require('firebase-admin');
const { handleMidtransCallback } = require('../controllers/midtransController');

router.post('/initiate', authMiddleware, createOrderWithPayment);

// ✅ Tambahkan route baru untuk cek status Midtrans
router.get('/status/:orderId', authMiddleware, getMidtransStatus);

 // ✅ Tambahkan route baru untuk webhook
router.post('/webhook', express.json(), handleMidtransCallback);

router.post('/start/:orderId', authMiddleware, startPaymentForQuote);


module.exports = router;