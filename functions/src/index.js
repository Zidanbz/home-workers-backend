const express = require('express');
const cors = require('cors');
const functions = require('firebase-functions');
const admin = require('firebase-admin');
require('dotenv').config();
const morgan = require('morgan');

// Konfigurasi Firebase
const serviceAccount = require('../serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'home-workers-fa5cd.appspot.com',
});

const db = admin.firestore();
const app = express();
app.set('db', db);

// Middleware dasar
app.use(cors());
app.use(morgan('dev'));

// ❗ PENTING: HAPUS express.json() dan express.urlencoded()
// Di Cloud Functions Gen 2, parsing body (JSON, urlencoded, multipart)
// sudah ditangani secara otomatis oleh lingkungan sebelum request masuk ke Express.
// Menambahkan parser Express akan menyebabkan konflik dan mengosongkan req.body.
// app.use(express.json()); // <-- HAPUS BARIS INI
// app.use(express.urlencoded({ extended: true })); // <-- HAPUS BARIS INI

// Daftarkan semua rute API Anda
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/workers', require('./routes/workerRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api', require('./routes/reviewRoutes'));
app.use('/api/services', require('./routes/serviceRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/chats', require('./routes/chatRoutes'));
app.use('/api/wallet', require('./routes/walletRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
// app.use('/api/payments', require('./routes/notificationRoutes'));
app.use('/api/midtrans', require('./routes/midtransRoutes'));

// Test Route
app.get('/api', (req, res) => {
  res.status(200).json({ message: 'Welcome to Home Workers API!' });
});

// Global error handler
const { sendError } = require('./utils/responseHelper');
app.use((err, req, res, next) => {
  console.error('🔥 GLOBAL ERROR HANDLER:', err);
  sendError(res, 500, 'Unhandled server error', err.message || err);
});
// // Export aplikasi Express sebagai Firebase Function dengan region yang benar
// exports.api = functions.runWith({ region: 'asia-southeast2' }).https.onRequest(app);
// Export sebagai Firebase Function (Cloud Run)
exports.api = functions.https.onRequest(app);
