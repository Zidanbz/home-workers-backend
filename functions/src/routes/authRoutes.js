// src/routes/authRoutes.js

const express = require('express');
const router = express.Router();
// const multer = require('multer');
const { registerCustomer, registerWorker, loginUser, getMyProfile, updateFcmToken } = require('../controllers/authController');
const { tryCatch } = require('../utils/responseHelper');
const parseFormData = require('../middlewares/busboyupload');
const { authMiddleware } = require('../middlewares/authMiddleware');


// const authMiddleware = require('../middlewares/authMiddleware');

// const storage = multer.memoryStorage();
// const upload = multer({ storage: storage });

router.post('/login', loginUser);
// Endpoint untuk registrasi sebagai Customer
router.post('/register/customer', registerCustomer);

// Endpoint untuk registrasi sebagai Worker
router.post('/register/worker', parseFormData, tryCatch(registerWorker));
// Endpoint untuk mendapatkan data user yang sedang login
router.get('/me', getMyProfile);    
router.post('/user/update-fcm-token', authMiddleware, tryCatch(updateFcmToken));

module.exports = router;