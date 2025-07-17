// src/routes/reviewRoutes.js

const express = require('express');
const router = express.Router();
const { createReview, getReviewsForWorker } = require('../controllers/reviewController');
const { authMiddleware } = require('../middlewares/authMiddleware');



// Endpoint untuk customer membuat review pada sebuah order
// Rute ini dilindungi, hanya user yang login (customer) yang bisa mengakses
router.post('/orders/:orderId', authMiddleware, createReview);

// Endpoint untuk worker mengambil review miliknya
router.get('/for-worker/me', authMiddleware, getReviewsForWorker);

module.exports = router;