// src/middlewares/authMiddleware.js - VERSI FINAL DIPERBAIKI

const admin = require('firebase-admin');
const db = admin.firestore(); // <-- INI DIA PENYEBABNYA. Baris ini mungkin hilang.

/**
 * Middleware untuk memeriksa token Firebase.
 */
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).send({ message: 'Unauthorized: No token provided' });
    }
    
    const idToken = authHeader.split('Bearer ')[1];
    
    try {
      // Langkah 1: Verifikasi token
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      
      // --- PERUBAHAN UTAMA DIMULAI DI SINI ---
      
      // Langkah 2: Ambil role dari Firestore menggunakan UID dari token
      const userDocRef = db.collection('users').doc(decodedToken.uid);
      const userDoc = await userDocRef.get();
  
      if (!userDoc.exists) {
        return res.status(403).send({ message: 'Forbidden: User data not found in database.' });
      }
  
      // Langkah 3: Gabungkan data dari token dan data dari Firestore
      req.user = {
        ...decodedToken, // Isi token asli (uid, email, dll)
        role: userDoc.data().role, // Tambahkan role dari Firestore
      };
      
      // --- PERUBAHAN SELESAI ---
  
      next(); // Lanjutkan ke proses selanjutnya jika semua berhasil
  
    } catch (error) {
      res.status(403).send({ message: 'Unauthorized: Invalid token' });
    }
  };

/**
 * Middleware untuk memastikan pengguna adalah ADMIN.
 * Harus dijalankan SETELAH authMiddleware.
 */
const adminMiddleware = async (req, res, next) => {
    const { uid } = req.user; // UID didapat dari authMiddleware sebelumnya

    try {
        const userDocRef = db.collection('users').doc(uid);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: "User not found in database." });
        }

        const userData = userDoc.data();
        if (userData.role !== 'ADMIN') {
            return res.status(403).json({ message: "Forbidden: Access is restricted to administrators." });
        }

        next();

    } catch (error) {
        // Ini block yang mengirim pesan error di screenshot Anda
        res.status(500).json({ message: "Failed to verify admin role.", error: error.message });
    }
};


module.exports = {
    authMiddleware,
    adminMiddleware,
};