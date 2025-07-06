const express = require('express');
const cors = require('cors');
require('dotenv').config();
const admin = require('firebase-admin');
const functions = require("firebase-functions");
// Konfigurasi Kunci Service Account
const serviceAccount = require('../serviceAccountKey.json');

// Inisialisasi Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
const authRoutes = require('./routes/authRoutes');
const workerRoutes = require('./routes/workerRoutes');
const orderRoutes = require('./routes/orderRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const chatRoutes = require('./routes/chatRoutes');
const walletRoutes = require('./routes/walletRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
//...
app.use('/api/auth', authRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/orders', orderRoutes); 
app.use('/api', reviewRoutes); 
app.use('/api/services', serviceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes); 
app.use('/api/chats', chatRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payments', paymentRoutes);
// Test Route
app.get('/api', (req, res) => {
  res.status(200).json({ message: 'Welcome to Home Workers API!' });
});

// Hanya jalankan server lokal jika tidak sedang di-deploy ke Firebase
// if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 8080;
//   app.listen(PORT, () => {
//     console.log(`Server lokal berjalan di port ${PORT}`);
//   });
// }
exports.api = functions.https.onRequest(app);