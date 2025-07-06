// src/routes/authRoutes.js

const express = require('express');
const router = express.Router();
const { registerCustomer, registerWorker, loginUser, getMyProfile } = require('../controllers/authController');
const multer = require('multer');
const upload = multer({ dest: 'uploads/ktp/' }); // Atau gunakan Firebase Storage nanti

// const authMiddleware = require('../middlewares/authMiddleware');

router.post('/login', loginUser);
// Endpoint untuk registrasi sebagai Customer
router.post('/register/customer', registerCustomer);

// Endpoint untuk registrasi sebagai Worker
router.post('/auth/register/worker', upload.single('ktp'), registerWorker);
// Endpoint untuk mendapatkan data user yang sedang login
router.get('/me', getMyProfile);    

module.exports = router;