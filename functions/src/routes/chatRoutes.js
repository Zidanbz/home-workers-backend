// src/routes/chatRoutes.js

const express = require('express');
const router = express.Router();

// Impor semua fungsi yang dibutuhkan dari controller
const { 
    createChat, 
    getMyChats,
    sendMessage,
    getMessages,
    markChatAsRead,
} = require('../controllers/chatController');

// Impor middleware untuk keamanan
const { authMiddleware } = require('../middlewares/authMiddleware');

// Endpoint untuk membuat ruang obrolan baru
router.post('/', authMiddleware, createChat);

// Endpoint untuk mengambil daftar semua obrolan pengguna
router.get('/', authMiddleware, getMyChats);

// Endpoint untuk mengirim pesan ke dalam sebuah ruang obrolan
router.post('/:chatId/messages', authMiddleware, sendMessage);

// Endpoint untuk mengambil semua riwayat pesan dari sebuah ruang obrolan
router.get('/:chatId/messages', authMiddleware, getMessages);

// Endpoint untuk mereset unread count
router.post('/:chatId/read', authMiddleware, markChatAsRead);
module.exports = router;
