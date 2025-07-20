const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const { getAvailableVouchers, claimVoucher, createVoucher, validateVoucherPublic } = require('../controllers/vouchersController');

// Semua rute voucher memerlukan login
router.use(authMiddleware);

// Admin endpoints
// Ambil semua voucher global + user punya
router.get('/', getAvailableVouchers);

// Klaim voucher manual
router.post('/claim', claimVoucher);

// Admin: buat voucher
router.post('/create', createVoucher);

// User: validasi voucher
router.post('/validate', validateVoucherPublic);

module.exports = router;
