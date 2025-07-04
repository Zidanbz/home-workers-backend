const express = require('express');
const router = express.Router();
const { getMyWallet, requestWithdrawal } = require('../controllers/walletController');
const { authMiddleware } = require('../middlewares/authMiddleware');

// Semua rute di sini memerlukan login
router.use(authMiddleware);

// Endpoint untuk mengambil info wallet
router.get('/me', getMyWallet);

// Endpoint untuk mengajukan penarikan
router.post('/me/withdraw', requestWithdrawal);

module.exports = router;