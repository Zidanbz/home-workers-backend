// src/controllers/authController.js

const admin = require('firebase-admin');
const db = admin.firestore();
const axios = require('axios'); 

/**
 * Registrasi untuk pengguna yang HANYA ingin menjadi CUSTOMER.
 */
/**
 * Registrasi untuk CUSTOMER tanpa token.
 */
const registerCustomer = async (req, res) => {
    const { email, password, nama } = req.body;
  
    if (!email || !password || !nama) {
      return res.status(400).json({ message: "Email, password, dan nama wajib diisi." });
    }
  
    try {
      // Langkah 1: Buat user di Firebase Authentication via Admin SDK
      const userRecord = await admin.auth().createUser({
        email: email,
        password: password,
        displayName: nama,
      });
      
      const uid = userRecord.uid;
  
      // Langkah 2: Buat dokumen di Firestore
      const userDocRef = db.collection('users').doc(uid);
      await userDocRef.set({
        email: email,
        nama: nama,
        role: 'CUSTOMER',
        createdAt: new Date(),
      });
  
      res.status(201).json({ message: "Customer user registered successfully", userId: uid });
    } catch (error) {
      // Tangani error jika email sudah terdaftar, dll.
      res.status(409).json({ message: "Failed to register customer", error: error.message });
    }
  };
  
  
  /**
   * Registrasi untuk WORKER tanpa token.
   */
  const registerWorker = async (req, res) => {
    const { email, password, nama, keahlian, deskripsi } = req.body;
  
    if (!email || !password || !nama) {
      return res.status(400).json({ message: "Email, password, dan nama wajib diisi." });
    }
  
    try {
      // Langkah 1: Buat user di Firebase Authentication
      const userRecord = await admin.auth().createUser({
        email: email,
        password: password,
        displayName: nama,
      });
  
      const uid = userRecord.uid;
  
      // Langkah 2: Gunakan batch untuk membuat dokumen di users dan workers
      const batch = db.batch();
  
      const userDocRef = db.collection('users').doc(uid);
      batch.set(userDocRef, {
        email: email,
        nama: nama,
        role: 'WORKER',
        createdAt: new Date(),
      });
  
      const workerDocRef = db.collection('workers').doc(uid);
      batch.set(workerDocRef, {
        keahlian: keahlian || [],
        deskripsi: deskripsi || '',
        rating: 0,
        jumlahOrderSelesai: 0,
        dibuatPada: new Date(),
      });
  
      await batch.commit();
  
      res.status(201).json({ message: "Worker user registered successfully", userId: uid });
    } catch (error) {
      res.status(409).json({ message: "Failed to register worker", error: error.message });
    }
  };

/**
 * Login untuk semua jenis pengguna.
 * Sekarang mengembalikan Custom Token, bukan ID Token.
 */
const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const firebaseAuthUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.APP_FIREBASE_WEB_API_KEY}`;

  try {
    // Langkah 1: Verifikasi kredensial pengguna dan dapatkan UID
    const firebaseResponse = await axios.post(firebaseAuthUrl, {
      email: email,
      password: password,
      returnSecureToken: true
    });

    const { localId: uid } = firebaseResponse.data;

    // --- PERUBAHAN UTAMA ---
    // Langkah 2: Buat Custom Token menggunakan Admin SDK
    const customToken = await admin.auth().createCustomToken(uid);

    // Langkah 3: Ambil data profil dari Firestore (tidak berubah)
    const userDocRef = db.collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User data not found in our database.' });
    }
    const userData = userDoc.data();

    // Langkah 4: Kirim Custom Token dan data user ke client
    res.status(200).json({
      message: 'Login successful',
      customToken: customToken, // <-- Kirim custom token, bukan idToken
      user: {
        uid: uid,
        email: userData.email,
        nama: userData.nama,
        role: userData.role
      }
    });

  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || 'Invalid credentials';
    res.status(401).json({ message: errorMessage });
  }
};
  
  const getMyProfile = async (req, res) => {
    const { uid } = req.user; // UID didapat dari authMiddleware

    try {
        const userDocRef = db.collection('users').doc(uid);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: "User data not found." });
        }

        const userData = userDoc.data();

        res.status(200).json({
            uid: uid,
            email: userData.email,
            nama: userData.nama,
            role: userData.role
        });

    } catch (error) {
        res.status(500).json({ message: "Failed to fetch user profile.", error: error.message });
    }
};

module.exports = {
  registerCustomer,
  registerWorker,
  loginUser,
  getMyProfile,
};