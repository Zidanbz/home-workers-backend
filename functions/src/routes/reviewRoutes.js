// src/routes/reviewRoutes.js

const express = require('express');
const router = express.Router();
const { createReview } = require('../controllers/reviewController');
const { authMiddleware } = require('../middlewares/authMiddleware');



// Endpoint untuk customer membuat review pada sebuah order
// Rute ini dilindungi, hanya user yang login (customer) yang bisa mengakses
router.post('/orders/:orderId/review', authMiddleware, createReview);

module.exports = router;