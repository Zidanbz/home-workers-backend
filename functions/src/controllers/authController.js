// src/controllers/authController.js

const admin = require('firebase-admin');
const axios = require('axios');
const fs = require('fs'); 
const { sendSuccess, sendError } = require('../utils/responseHelper');


const db = admin.firestore();
const bucket = admin.storage().bucket();



/**
 * Registrasi untuk CUSTOMER tanpa token.
 */
const registerCustomer = async (req, res) => {
  const { email, password, nama } = req.body;

  if (!email || !password || !nama) {
    return sendError(res, 400, "Email, password, dan nama wajib diisi.");
  }

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: nama,
    });

    const uid = userRecord.uid;

    const userDocRef = db.collection('users').doc(uid);
    await userDocRef.set({
      email,
      nama,
      role: 'CUSTOMER',
      createdAt: new Date(),
    });

    return sendSuccess(res, 201, "Customer user registered successfully", { userId: uid });
  } catch (error) {
    console.error("Error during customer registration:", error);
    return sendError(res, 409, "Failed to register customer", error.message);
  }
};

/**
 * Registrasi untuk WORKER tanpa token.
 */
const registerWorker = async (req, res) => {
  const { email, password, nama, keahlian, deskripsi, linkPortofolio, noKtp } = req.body;
  // Ambil file dari req.files yang diisi oleh middleware baru
  const { ktp: ktpFile, fotoDiri: fotoDiriFile } = req.files || {};

  if (!email || !password || !nama) {
    return sendError(res, 400, "Email, password, dan nama wajib diisi.");
  }
  // Validasi kedua file
  if (!ktpFile) return sendError(res, 400, "File KTP wajib diunggah.");
  if (!fotoDiriFile) return sendError(res, 400, "Foto Diri wajib diunggah.");

  let keahlianArray;
  try {
    keahlianArray = keahlian ? JSON.parse(keahlian) : [];
    if (!Array.isArray(keahlianArray)) { keahlianArray = [keahlianArray]; }
  } catch (error) {
    keahlianArray = typeof keahlian === 'string' ? keahlian.split(',').map(s => s.trim()) : [];
  }

  let uid;
  try {
    const userRecord = await admin.auth().createUser({ email, password, displayName: nama });
    uid = userRecord.uid;

    // Fungsi helper untuk mengunggah satu file
    const uploadFile = async (file, folder) => {
      const filePath = `${folder}/${uid}/${Date.now()}_${file.originalname}`;
      const fileUpload = bucket.file(filePath);
      const stream = fileUpload.createWriteStream({
        metadata: { contentType: file.mimetype },
      });
      await new Promise((resolve, reject) => {
        stream.on('error', reject);
        stream.on('finish', resolve);
        stream.end(file.buffer);
      });
      await fileUpload.makePublic();
      return fileUpload.publicUrl();
    };
    
    // Unggah kedua file secara paralel untuk performa lebih baik
    const [ktpUrl, fotoDiriUrl] = await Promise.all([
      uploadFile(ktpFile, 'ktp_uploads'),
      uploadFile(fotoDiriFile, 'foto_diri_uploads')
    ]);

    // Simpan kedua URL ke Firestore
    const batch = db.batch();
    const userDocRef = db.collection('users').doc(uid);
    batch.set(userDocRef, { email, nama, role: 'WORKER', fotoUrl: fotoDiriUrl, createdAt: new Date() }); // Tambahkan fotoUrl ke user juga

    const workerDocRef = db.collection('workers').doc(uid);
    batch.set(workerDocRef, {
      keahlian: keahlianArray,
      deskripsi: deskripsi || '',
      noKtp: noKtp || '',
      linkPortofolio: linkPortofolio || '',
      ktpUrl: ktpUrl,         // URL KTP
      fotoDiriUrl: fotoDiriUrl, // <-- URL FOTO DIRI BARU
      rating: 0,
      jumlahOrderSelesai: 0,
      status: 'pending',
      dibuatPada: new Date(),
    });

    await batch.commit();

    return sendSuccess(res, 201, "Worker user registered successfully", { userId: uid });

  } catch (error) {
    console.error("Error selama registrasi worker:", error);
    if (uid) {
      await admin.auth().deleteUser(uid).catch(deleteErr => console.error("Gagal cleanup user:", deleteErr));
    }
    return sendError(res, 500, "Gagal mendaftarkan worker", error.message);
  }
};



/**
 * Login untuk semua jenis pengguna.
 * Sekarang mengembalikan Custom Token, bukan ID Token.
 */
const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
      return sendError(res, 400, 'Email and password are required.');
  }

  const firebaseAuthUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.APP_FIREBASE_WEB_API_KEY}`;

  try {
      const firebaseResponse = await axios.post(firebaseAuthUrl, {
          email,
          password,
          returnSecureToken: true
      });

      // AMBIL idToken LANGSUNG DARI RESPON FIREBASE
      const { localId: uid, idToken, refreshToken, expiresIn } = firebaseResponse.data; 
      
      // Cek data user di Firestore (ini tetap perlu untuk mendapatkan role)
      const userDocRef = db.collection('users').doc(uid);
      const userDoc = await userDocRef.get();

      if (!userDoc.exists) {
          // Ini bisa terjadi jika user terautentikasi di Firebase Auth,
          // tapi belum ada dokumennya di koleksi 'users' Firestore Anda.
          // Anda mungkin ingin membuat dokumen user di sini atau menyarankan user untuk melengkapi profil.
          return sendError(res, 404, 'User data not found in our database. Please complete your profile.');
      }

      const userData = userDoc.data();

      return sendSuccess(res, 200, 'Login successful', {
          // Kirim idToken, refreshToken, dan data user ke frontend
          idToken, // Ini yang akan digunakan frontend di header Authorization
          refreshToken, // Untuk refresh token tanpa login ulang
          expiresIn, // Durasi berlaku idToken
          user: {
              uid,
              email: userData.email,
              nama: userData.nama,
              role: userData.role,
          }
      });
  } catch (error) {
      const errorMessage = error.response?.data?.error?.message || 'Invalid credentials';
      // Firebase Auth REST API sering mengembalikan error yang kurang user-friendly,
      // seperti 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'USER_DISABLED'.
      // Anda mungkin ingin memparsingnya menjadi pesan yang lebih baik untuk user.
      if (errorMessage === 'EMAIL_NOT_FOUND' || errorMessage === 'INVALID_PASSWORD') {
          return sendError(res, 401, 'Invalid email or password.');
      } else if (errorMessage === 'USER_DISABLED') {
          return sendError(res, 401, 'Your account has been disabled.');
      }
      return sendError(res, 401, error);
  }
};

/**
 * Mendapatkan profil user yang sedang login.
 */
const getMyProfile = async (req, res) => {
  const { uid } = req.user;

  try {
    const userDocRef = db.collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return sendError(res, 404, "User data not found.");
    }

    const userData = userDoc.data();

    return sendSuccess(res, 200, 'User profile retrieved successfully', {
      uid,
      email: userData.email,
      nama: userData.nama,
      role: userData.role,
    });
  } catch (error) {
    return sendError(res, 500, "Failed to fetch user profile.", error);
  }
};

module.exports = {
  registerCustomer,
  registerWorker,
  loginUser,
  getMyProfile,
};
