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
// Helper untuk memastikan fcmToken tidak duplikat
const ensureUniqueFcmToken = async (fcmToken, uid) => {
  if (!fcmToken) return;
  
  const usersSnapshot = await db.collection('users')
    .where('fcmToken', '==', fcmToken)
    .get();

  usersSnapshot.forEach(async doc => {
    if (doc.id !== uid) {
      await doc.ref.update({ fcmToken: admin.firestore.FieldValue.delete() });
    }
  });
};

// === CUSTOMER REGISTRATION ===
const registerCustomer = async (req, res) => {
  const { email, password, nama, fcmToken } = req.body;

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

    await ensureUniqueFcmToken(fcmToken, uid); // Pastikan fcmToken unik

    const userDocRef = db.collection('users').doc(uid);
    await userDocRef.set({
      email,
      nama,
      role: 'CUSTOMER',
      fcmToken: fcmToken || null,
      createdAt: new Date(),
    });

    return sendSuccess(res, 201, "Customer user registered successfully", { userId: uid });
  } catch (error) {
    console.error("Error during customer registration:", error);
    return sendError(res, 409, "Failed to register customer", error.message);
  }
};

// === WORKER REGISTRATION ===
const registerWorker = async (req, res) => {
  const { email, password, nama, keahlian, deskripsi, linkPortofolio, noKtp, fcmToken } = req.body;
  const { ktp: ktpFile, fotoDiri: fotoDiriFile } = req.files || {};

  if (!email || !password || !nama) {
    return sendError(res, 400, "Email, password, dan nama wajib diisi.");
  }
  if (!ktpFile) return sendError(res, 400, "File KTP wajib diunggah.");
  if (!fotoDiriFile) return sendError(res, 400, "Foto Diri wajib diunggah.");

  let keahlianArray;
  try {
    keahlianArray = keahlian ? JSON.parse(keahlian) : [];
    if (!Array.isArray(keahlianArray)) {
      keahlianArray = [keahlianArray];
    }
  } catch {
    keahlianArray = typeof keahlian === 'string'
      ? keahlian.split(',').map(s => s.trim())
      : [];
  }

  let uid;
  try {
    const userRecord = await admin.auth().createUser({ email, password, displayName: nama });
    uid = userRecord.uid;

    await ensureUniqueFcmToken(fcmToken, uid); // Pastikan fcmToken unik

    const uploadFile = async (file, folder) => {
      const filePath = `${folder}/${uid}/${Date.now()}_${file.originalname}`;
      const fileUpload = bucket.file(filePath);
      const stream = fileUpload.createWriteStream({ metadata: { contentType: file.mimetype } });

      await new Promise((resolve, reject) => {
        stream.on('error', reject);
        stream.on('finish', resolve);
        stream.end(file.buffer);
      });

      await fileUpload.makePublic();
      return fileUpload.publicUrl();
    };

    const [ktpUrl, fotoDiriUrl] = await Promise.all([
      uploadFile(ktpFile, 'ktp_uploads'),
      uploadFile(fotoDiriFile, 'foto_diri_uploads'),
    ]);

    const batch = db.batch();
    const userDocRef = db.collection('users').doc(uid);
    batch.set(userDocRef, {
      email,
      nama,
      role: 'WORKER',
      fotoUrl: fotoDiriUrl,
      fcmToken: fcmToken || null,
      createdAt: new Date()
    });

    const workerDocRef = db.collection('workers').doc(uid);
    batch.set(workerDocRef, {
      keahlian: keahlianArray,
      deskripsi: deskripsi || '',
      noKtp: noKtp || '',
      linkPortofolio: linkPortofolio || '',
      ktpUrl,
      fotoDiriUrl,
      rating: 0,
      jumlahOrderSelesai: 0,
      status: 'pending',
      dibuatPada: new Date()
    });

    const walletDocRef = db.collection('wallets').doc(uid);
    batch.set(walletDocRef, {
      currentBalance: 0,
      updatedAt: new Date()
    }, { merge: true });

    await batch.commit();

    return sendSuccess(res, 201, "Worker user registered successfully", { userId: uid });

  } catch (error) {
    console.error("Error selama registrasi worker:", error);
    if (uid) {
      await admin.auth().deleteUser(uid).catch(delErr => console.error("Gagal cleanup user:", delErr));
    }
    return sendError(res, 500, "Gagal mendaftarkan worker", error.message);
  }
};




/**
 * Login untuk semua jenis pengguna.
 * Sekarang mengembalikan Custom Token, bukan ID Token.
 */
const loginUser = async (req, res) => {
  const { email, password, fcmToken } = req.body;

  if (!email || !password) {
    return sendError(res, 400, 'Email and password are required.');
  }

  const firebaseAuthUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.APP_FIREBASE_WEB_API_KEY}`;

  try {
    const firebaseResponse = await axios.post(firebaseAuthUrl, {
      email,
      password,
      returnSecureToken: true,
    });

    const { localId: uid, idToken } = firebaseResponse.data;

    const customToken = await admin.auth().createCustomToken(uid);

    const userDocRef = db.collection('users').doc(uid);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
      return sendError(res, 404, 'User data not found in database.');
    }

    // 🔥 Simpan FCM token jika dikirim
    if (fcmToken) {
      await userDocRef.update({
        fcmToken,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    const userData = userDoc.data();

    return sendSuccess(res, 200, 'Login successful, tokens generated.', {
      customToken,
      idToken,
      user: {
        uid,
        email: userData.email,
        nama: userData.nama,
        role: userData.role,
      },
    });

  } catch (error) {
    console.error('LOGIN_ERROR_DETAIL:', error.response?.data?.error || error.message);

    let statusCode = 401;
    let userMessage = 'Email atau password yang Anda masukkan salah.';
    const firebaseError = error.response?.data?.error;

    if (firebaseError) {
      switch (firebaseError.message) {
        case 'INVALID_PASSWORD':
        case 'EMAIL_NOT_FOUND':
          userMessage = 'Email atau password yang Anda masukkan salah.';
          break;
        case 'USER_DISABLED':
          userMessage = 'Akun Anda telah dinonaktifkan. Silakan hubungi customer service.';
          break;
        case 'INVALID_EMAIL':
          statusCode = 400;
          userMessage = 'Format email yang Anda masukkan tidak valid.';
          break;
        default:
          statusCode = 500;
          userMessage = 'Terjadi kesalahan pada server saat mencoba login. Silakan coba lagi nanti.';
          break;
      }
    } else {
      statusCode = 503;
      userMessage = 'Tidak dapat terhubung ke server autentikasi. Periksa koneksi internet Anda.';
    }

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

// src/controllers/userController.js
const updateFcmToken = async (req, res) => {
  const { uid } = req.user;
  const { fcmToken } = req.body;

  if (!fcmToken) return sendError(res, 400, 'fcmToken is required.');

  try {
    await ensureUniqueFcmToken(fcmToken, uid);
    await db.collection('users').doc(uid).update({
      fcmToken,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return sendSuccess(res, 200, 'fcmToken updated successfully.');
  } catch (err) {
    console.error('Error updating fcmToken:', err);
    return sendError(res, 500, 'Failed to update fcmToken.');
  }
};


module.exports = {
  registerCustomer,
  registerWorker,
  loginUser,
  getMyProfile,
  updateFcmToken,
};
