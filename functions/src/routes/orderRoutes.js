const express = require('express');
const router = express.Router();
const {
    createOrder,
    getMyOrders,
    acceptOrder,
    cancelOrder,
    completeOrder,
    getOrderById,
    proposeQuote,
    respondToQuote,
    rejectOrder,
    getWorkerAvailability,
    getBookedSlots,
    createPaymentAfterQuote,
    updateOrderStatus
} = require('../controllers/orderController');
const { authMiddleware } = require('../middlewares/authMiddleware');


// Semua rute di sini memerlukan login, jadi kita gunakan middleware di semua
router.use(authMiddleware);

// Customer membuat pesanan baru
// router.post('/', createOrder);

// Pengguna mengambil daftar pesanannya
router.get('/my-orders', getMyOrders);

// Worker menerima sebuah pesanan
router.put('/:orderId/accept', acceptOrder);

// Worker menandai order selesai
router.put('/:orderId/complete', completeOrder);

// Customer membatalkan order
router.put('/:orderId/cancel', cancelOrder);

router.get('/:orderId', getOrderById);

// Endpoint untuk worker mengajukan penawaran harga
router.post('/:orderId/quote', authMiddleware, proposeQuote);

// Endpoint untuk customer merespons penawaran harga
router.put('/:orderId/quote/respond', authMiddleware, respondToQuote);

// Endpoint untuk worker menolak order
router.put('/:orderId/reject', authMiddleware, rejectOrder);

// Endpoint untuk mendapatkan availability worker
router.get('/availability/:workerId', authMiddleware, getWorkerAvailability);

// Endpoint untuk mendapatkan daftar slot yang telah dibooking
router.get('/orders/booked-slots', getBookedSlots);

// Endpoint untuk membuat pembayaran
router.post('/orders/:orderId/pay',  createPaymentAfterQuote);

router.patch('/:id/status', authMiddleware, updateOrderStatus);

module.exports = router;