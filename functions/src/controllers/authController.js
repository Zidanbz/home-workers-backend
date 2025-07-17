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

    const walletDocRef = db.collection('wallets').doc(uid);
batch.set(walletDocRef, {
  currentBalance: 0,
  updatedAt: new Date()
}, { merge: true }); // pakai merge biar tidak overwrite jika sudah ada

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
    // LANGKAH 1: Verifikasi email & password. Minta KEDUA token.
    const firebaseResponse = await axios.post(firebaseAuthUrl, {
      email,
      password,
      returnSecureToken: true // Ubah kembali menjadi true untuk mendapatkan idToken
    });

    // Ambil UID dan idToken dari respons verifikasi
    const { localId: uid, idToken } = firebaseResponse.data;

    // LANGKAH 2: Gunakan UID untuk membuat CUSTOM TOKEN dengan Admin SDK
    const customToken = await admin.auth().createCustomToken(uid);

    // Ambil data user dari Firestore
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return sendError(res, 404, 'User data not found in database.');
    }
    const userData = userDoc.data();

    // LANGKAH 3: Kirim KEDUA token ke frontend
    return sendSuccess(res, 200, 'Login successful, tokens generated.', {
      // Token untuk login ke Firebase SDK di client
      customToken: customToken, 
      
      // Token untuk header Authorization di API calls Anda yang lain
      idToken: idToken,       
      
      user: {
        uid,
        email: userData.email,
        nama: userData.nama,
        role: userData.role,
      }
    });

  } catch (error) {
    // --- PENANGANAN ERROR YANG LEBIH DETAIL ---

    // 1. Log error asli di server untuk debugging
    console.error('LOGIN_ERROR_DETAIL:', error.response?.data?.error || error.message);

    // 2. Siapkan variabel untuk respons error
    let statusCode = 401; // Unauthorized secara default
    let userMessage = 'Email atau password yang Anda masukkan salah.'; // Pesan default yang aman

    const firebaseError = error.response?.data?.error;

    if (firebaseError) {
      switch (firebaseError.message) {
        case 'INVALID_PASSWORD':
        case 'EMAIL_NOT_FOUND':
          // Untuk keamanan, kita tidak membedakan antara email tidak ada atau password salah.
          // Cukup berikan pesan umum yang sama.
          userMessage = 'Email atau password yang Anda masukkan salah.';
          break;
        
        case 'USER_DISABLED':
          userMessage = 'Akun Anda telah dinonaktifkan. Silakan hubungi customer service.';
          break;

        case 'INVALID_EMAIL':
          statusCode = 400; // Bad Request, karena input dari user salah format
          userMessage = 'Format email yang Anda masukkan tidak valid.';
          break;

        default:
          // Untuk error Firebase lain yang tidak terduga, berikan pesan umum.
          statusCode = 500; // Internal Server Error
          userMessage = 'Terjadi kesalahan pada server saat mencoba login. Silakan coba lagi nanti.';
          break;
      }
    } else {
      // Untuk error non-Firebase (misalnya, masalah jaringan saat memanggil axios)
      statusCode = 503; // Service Unavailable
      userMessage = 'Tidak dapat terhubung ke server autentikasi. Periksa koneksi internet Anda.';
    }
    
    // 3. Kirim respons error yang sudah diproses
    return sendError(res, statusCode, userMessage);
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
