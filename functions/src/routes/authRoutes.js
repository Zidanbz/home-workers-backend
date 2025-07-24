// src/routes/authRoutes.js

const express = require('express');
const router = express.Router();

const parseFormData = require('../middlewares/busboyupload');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { tryCatch } = require('../utils/responseHelper');

const {
  registerCustomer,
  registerWorker,
  loginUser,
  resendVerificationEmail,
  getMyProfile,
  updateFcmToken,
  forgotPassword,
  resetPassword,
  checkEmailVerification,
  verifyEmail,
} = require('../controllers/authController');

// -----------------------------------------------------------------------------
// AUTH ROUTES
// Base path assumed: /api/auth  (adjust in app.js when mounting)
// -----------------------------------------------------------------------------

// Login (returns customToken + idToken + requireEmailVerification flag)
router.post('/login', tryCatch(loginUser));

// Register Customer
router.post('/register/customer', tryCatch(registerCustomer));

// Register Worker (multipart: ktp, fotoDiri)
router.post('/register/worker', parseFormData, tryCatch(registerWorker));

// Resend verification email (auth optional; controller can use req.user OR body.email)
router.post('/resend-verification', tryCatch(resendVerificationEmail));

// Get profile of logged-in user (requires auth)
router.get('/me', authMiddleware, tryCatch(getMyProfile));

// Update FCM token (requires auth)
// New canonical path:
router.post('/update-fcm-token', authMiddleware, tryCatch(updateFcmToken));
// Legacy path retained for backward compatibility:
router.post('/user/update-fcm-token', authMiddleware, tryCatch(updateFcmToken));

// Forgot password (send reset email)
router.post('/forgot-password', tryCatch(forgotPassword));

// Reset password (handle OOB code)
router.post('/reset-password', tryCatch(resetPassword));

// Check email verification
router.post('/check-email-verification', tryCatch(checkEmailVerification));

// Verify email
router.get('/verify-email', verifyEmail);


module.exports = router;
