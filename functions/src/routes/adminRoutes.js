// src/routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const {
    getPendingServices,
    getAllServices, // Added
    getServiceDetail, // Added
    approveService,
    rejectService,
    sendBroadcast,
    getPendingWorkers,
    approveWorker,
    rejectWorker,
    getAllWorkers,
    getAllOrders
} = require('../controllers/adminController');

// Impor kedua middleware
const { authMiddleware, adminMiddleware } = require('../middlewares/authMiddleware');
const parseFormData = require('../middlewares/busboyupload');

// Gunakan kedua middleware ini untuk SEMUA rute di dalam file ini
// authMiddleware akan dijalankan dulu, baru adminMiddleware
router.use(authMiddleware, adminMiddleware);

// Rute untuk mendapatkan layanan pending
router.get('/services/pending', getPendingServices);

// Rute untuk mendapatkan semua layanan (Added)
router.get('/services', getAllServices);

// Rute untuk mendapatkan detail layanan berdasarkan ID (Added)
router.get('/services/:serviceId', getServiceDetail);

// Rute untuk menyetujui layanan
router.put('/services/:serviceId/approve', approveService);

// Rute untuk menolak layanan
router.put('/services/:serviceId/reject', rejectService);

// Endpoint untuk admin mengirim pesan broadcast
router.post('/broadcast', parseFormData, sendBroadcast);

// Rute untuk mendapatkan daftar worker
router.get('/workers/pending', getPendingWorkers);

// Rute untuk menyetujui worker
router.put('/workers/:workerId/approve', approveWorker);

// Rute untuk menolak worker
router.put('/workers/:workerId/reject', rejectWorker);

// Rute untuk mendapatkan daftar worker
router.get('/workers', getAllWorkers);

// Rute untuk mendapatkan daftar order
router.get('/orders', getAllOrders);


module.exports = router;