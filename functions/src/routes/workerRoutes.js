// src/routes/workerRoutes.js - VERSI FINAL YANG SUDAH DIPERBAIKI

const express = require('express');
const router = express.Router();
const {
    getMyProfile,
    updateMyProfile,
    getAllWorkers,
    getWorkerById,
    getDashboardSummary
} = require('../controllers/workerController');

// --- INI BARIS YANG DIPERBAIKI ---
const { authMiddleware } = require('../middlewares/authMiddleware');

// Endpoint publik untuk marketplace (melihat semua worker)
router.get('/', getAllWorkers);

// Endpoint untuk worker melihat profilnya sendiri
router.get('/profile/me', authMiddleware, getMyProfile);

// Endpoint untuk worker memperbarui profilnya sendiri
router.put('/profile/me', authMiddleware, updateMyProfile);

// Endpoint publik untuk melihat detail satu worker
router.get('/:workerId', getWorkerById);

// Endpoint untuk mendapatkan data ringkasan dasbor
router.get('/dashboard/summary', authMiddleware, getDashboardSummary);

module.exports = router;