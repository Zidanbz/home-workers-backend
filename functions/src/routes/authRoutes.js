// src/routes/authRoutes.js

const express = require('express');
const router = express.Router();
const { registerCustomer, registerWorker, loginUser, getMyProfile } = require('../controllers/authController');
// const authMiddleware = require('../middlewares/authMiddleware');

router.post('/login', loginUser);
// Endpoint untuk registrasi sebagai Customer
router.post('/register/customer', registerCustomer);

// Endpoint untuk registrasi sebagai Worker
router.post('/register/worker', registerWorker);
// Endpoint untuk mendapatkan data user yang sedang login
router.get('/me', getMyProfile);    

module.exports = router;