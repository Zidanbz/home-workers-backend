// src/routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const {
    getPendingServices,
    approveService,
    rejectService
} = require('../controllers/adminController');

// Impor kedua middleware
const { authMiddleware, adminMiddleware } = require('../middlewares/authMiddleware');

// Gunakan kedua middleware ini untuk SEMUA rute di dalam file ini
// authMiddleware akan dijalankan dulu, baru adminMiddleware
router.use(authMiddleware, adminMiddleware);

// Rute untuk mendapatkan layanan pending
router.get('/services/pending', getPendingServices);

// Rute untuk menyetujui layanan
router.put('/services/:serviceId/approve', approveService);

// Rute untuk menolak layanan
router.put('/services/:serviceId/reject', rejectService);


module.exports = router;