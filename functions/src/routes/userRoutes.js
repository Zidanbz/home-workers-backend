const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middlewares/authMiddleware');
const { addAddress, getAddresses, updateAvatar, uploadDocuments, updateMyProfile, getMyNotifications } = require('../controllers/userController');

// Endpoint untuk update avatar. Harus login.
router.post('/me/avatar', authMiddleware, updateAvatar);
// Endpoint untuk menambah alamat baru.
router.post('/me/addresses', authMiddleware, addAddress);

// Endpoint untuk mengambil daftar alamat.
router.get('/me/addresses', authMiddleware, getAddresses);

// Endpoint untuk worker mengunggah dokumen.
router.post('/me/documents', authMiddleware, uploadDocuments);

// Endpoint untuk memperbarui profil umum pengguna
router.put('/me', authMiddleware, updateMyProfile);

// Endpoint untuk mendapatkan daftar notifikasi
router.get('/me/notifications', authMiddleware, getMyNotifications);

module.exports = router;