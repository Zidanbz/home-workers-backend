'use strict';

const admin = require('firebase-admin');
const axios = require('axios');
const { sendSuccess, sendError } = require('../utils/responseHelper');
const { sendVerificationMail } = require('../utils/emailService');
const { APP_FIREBASE_WEB_API_KEY } = require('../config/env');


const db = admin.firestore();
const bucket = admin.storage().bucket();
console.log('redeploy test');
// -----------------------------------------------------------------------------
// Util: Normalisasi email
// -----------------------------------------------------------------------------
const normalizeEmail = (email) => (email ? String(email).trim().toLowerCase() : email);

// -----------------------------------------------------------------------------
// Util: Pastikan FCM token unik
// -----------------------------------------------------------------------------
const ensureUniqueFcmToken = async (fcmToken, uid) => {
  if (!fcmToken) return;
  const snap = await db.collection('users').where('fcmToken', '==', fcmToken).get();
  const updates = [];
  snap.forEach((doc) => {
    if (doc.id !== uid) {
      updates.push(
        doc.ref.update({
          fcmToken: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      );
    }
  });
  if (updates.length) await Promise.allSettled(updates);
};

// -----------------------------------------------------------------------------
// Util: Upload file ke Storage
// -----------------------------------------------------------------------------
async function uploadFileToStorage({ file, folder, uid, allowPublic = false }) {
  const timestamp = Date.now();
  const safeName = file.originalname?.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
  const objectPath = `${folder}/${uid}/${timestamp}_${safeName}`;
  const gcsFile = bucket.file(objectPath);

  await gcsFile.save(file.buffer, {
    metadata: { contentType: file.mimetype },
    resumable: false,
    validation: 'crc32c',
  });

  let publicUrl = null;
  if (allowPublic && process.env.ALLOW_PUBLIC_PROFILE_MEDIA === 'true') {
    try {
      await gcsFile.makePublic();
      publicUrl = gcsFile.publicUrl();
    } catch (err) {
      console.warn('[uploadFileToStorage] makePublic gagal:', err.message);
    }
  }

  return {
    gsUri: `gs://${bucket.name}/${objectPath}`,
    publicUrl,
  };
}

// -----------------------------------------------------------------------------
// Util: Generate email verification link
// -----------------------------------------------------------------------------
async function generateVerificationLinkSafe(email) {
  try {
    // Menggunakan link standar Firebase, karena custom handler tidak diperlukan lagi
    const link = await admin.auth().generateEmailVerificationLink(email);
    return link;
  } catch (err) {
    console.warn('[generateVerificationLinkSafe] gagal:', err.message);
    return null;
  }
}

// -----------------------------------------------------------------------------
// REGISTER CUSTOMER
// -----------------------------------------------------------------------------
const registerCustomer = async (req, res) => {
  let { email, password, nama, fcmToken } = req.body;
  if (!email || !password || !nama) {
    return sendError(res, 400, 'Email, password, dan nama wajib diisi.');
  }
  email = normalizeEmail(email);

  try {
    const userRecord = await admin.auth().createUser({ email, password, displayName: nama });
    const uid = userRecord.uid;
    await ensureUniqueFcmToken(fcmToken, uid);

    await db.collection('users').doc(uid).set({
      email,
      nama,
      role: 'CUSTOMER',
      fcmToken: fcmToken || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      emailVerified: false,
    });

    const verificationLink = await admin.auth().generateEmailVerificationLink(email);
    if (verificationLink) {
      await sendVerificationMail(email, verificationLink);
    }

    return sendSuccess(res, 201, 'Customer registered. Please verify your email.', {
      userId: uid,
      emailVerificationSent: !!verificationLink,
    });
  } catch (error) {
    console.error('REGISTER_CUSTOMER_ERROR:', error);
    if (error.code === 'auth/email-already-in-use') {
      return sendError(res, 409, 'Email sudah terdaftar. Silakan login.');
    }
    return sendError(res, 500, 'Failed to register customer', error.message);
  }
};

// -----------------------------------------------------------------------------
// REGISTER WORKER
// -----------------------------------------------------------------------------
const registerWorker = async (req, res) => {
  // ... (Fungsi ini tidak diubah, Anda bisa biarkan seperti adanya)
  let { email, password, nama, keahlian, deskripsi, linkPortofolio, portfolioLink, noKtp, fcmToken } = req.body;
  const { ktp: ktpFile, fotoDiri: fotoDiriFile } = req.files || {};

  if (!email || !password || !nama) return sendError(res, 400, 'Email, password, dan nama wajib diisi.');
  if (!ktpFile) return sendError(res, 400, 'File KTP wajib diunggah.');
  if (!fotoDiriFile) return sendError(res, 400, 'Foto Diri wajib diunggah.');

  email = normalizeEmail(email);
  const finalPortfolio = linkPortofolio ?? portfolioLink ?? '';

  let keahlianArray = [];
  if (keahlian) {
    try {
      const parsed = JSON.parse(keahlian);
      keahlianArray = Array.isArray(parsed) ? parsed : [parsed];
    } catch (_) {
      if (typeof keahlian === 'string') {
        keahlianArray = keahlian.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
  }

  let uid;
  try {
    const userRecord = await admin.auth().createUser({ email, password, displayName: nama });
    uid = userRecord.uid;
    await ensureUniqueFcmToken(fcmToken, uid);

    const [{ gsUri: ktpGsUri }, fotoUpload] = await Promise.all([
      uploadFileToStorage({ file: ktpFile, folder: 'ktp_uploads', uid, allowPublic: false }),
      uploadFileToStorage({ file: fotoDiriFile, folder: 'foto_diri_uploads', uid, allowPublic: true }),
    ]);
    const fotoProfilUrl = fotoUpload.publicUrl || fotoUpload.gsUri;

    const batch = db.batch();
    const userDocRef = db.collection('users').doc(uid);
    batch.set(userDocRef, {
      email,
      nama,
      role: 'WORKER',
      fotoUrl: fotoProfilUrl,
      fcmToken: fcmToken || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      emailVerified: false,
    });

    const workerDocRef = db.collection('workers').doc(uid);
    batch.set(workerDocRef, {
      keahlian: keahlianArray,
      deskripsi: deskripsi || '',
      noKtp: noKtp || '',
      portfolioLink: finalPortfolio,
      ktpGsUri: ktpGsUri,
      fotoDiriUrl: fotoProfilUrl,
      rating: 0,
      jumlahOrderSelesai: 0,
      status: 'pending',
      dibuatPada: admin.firestore.FieldValue.serverTimestamp(),
    });

    const walletDocRef = db.collection('wallets').doc(uid);
    batch.set(walletDocRef, {
      currentBalance: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await batch.commit();

    const verificationLink = await admin.auth().generateEmailVerificationLink(email);
    if (verificationLink) {
      await sendVerificationMail(email, verificationLink);
    }

    return sendSuccess(res, 201, 'Worker registered. Please verify your email.', {
      userId: uid,
      emailVerificationSent: !!verificationLink,
    });
  } catch (error) {
    console.error('REGISTER_WORKER_ERROR:', error);
    if (uid) {
      await admin.auth().deleteUser(uid).catch((delErr) => console.error('Cleanup user gagal:', delErr.message));
    }
    if (error.code === 'auth/email-already-in-use') {
      return sendError(res, 409, 'Email sudah terdaftar. Silakan login.');
    }
    return sendError(res, 500, 'Gagal mendaftarkan worker', error.message);
  }
};

// =============================================================================
// LOGIN USER (FUNGSI YANG DIPERBAIKI)
// =============================================================================
const loginUser = async (req, res) => {
  let { email, password, fcmToken } = req.body;
  if (!email || !password) return sendError(res, 400, 'Email and password are required.');
  email = normalizeEmail(email);

  const firebaseAuthUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${APP_FIREBASE_WEB_API_KEY}`;

  try {
    const firebaseResponse = await axios.post(firebaseAuthUrl, { email, password, returnSecureToken: true });
    const { localId: uid, idToken } = firebaseResponse.data;

    const userDocRef = db.collection('users').doc(uid);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) return sendError(res, 404, 'User data not found in database.');

    // Ambil data dari kedua sumber (Auth dan Firestore)
    const userData = userDoc.data();
    const userAuthRecord = await admin.auth().getUser(uid);
    const emailVerified = userAuthRecord.emailVerified; // <-- Ini sumber kebenaran

    // --- PERBAIKAN UTAMA: BANGUN PAYLOAD UPDATE SECARA DINAMIS ---
    const updatePayload = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Tambahkan fcmToken ke payload jika ada
    if (fcmToken) {
      await ensureUniqueFcmToken(fcmToken, uid);
      updatePayload.fcmToken = fcmToken;
    }

    // Bandingkan status verifikasi dan tambahkan ke payload jika berbeda
    if (userData.emailVerified !== emailVerified) {
      updatePayload.emailVerified = emailVerified;
    }

    // Lakukan update ke Firestore HANYA jika ada yang perlu diubah
    if (Object.keys(updatePayload).length > 1) {
      await userDocRef.update(updatePayload);
    }
    // --- AKHIR DARI PERBAIKAN ---

    const customToken = await admin.auth().createCustomToken(uid);
    const requireEmailVerification = !emailVerified && userData.role !== 'ADMIN';

    return sendSuccess(res, 200, 'Login successful.', {
      customToken,
      idToken,
      user: {
        uid,
        email: userData.email,
        nama: userData.nama,
        role: userData.role,
        emailVerified, // Selalu kirim status terbaru dari Auth
      },
      requireEmailVerification,
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
          userMessage = 'Email atau password yang Anda masukkan salah.'; break;
        case 'USER_DISABLED':
          userMessage = 'Akun Anda telah dinonaktifkan.'; break;
        case 'INVALID_EMAIL':
          statusCode = 400;
          userMessage = 'Format email tidak valid.'; break;
        default:
          statusCode = 500;
          userMessage = 'Terjadi kesalahan pada server.'; break;
      }
    } else {
      statusCode = 503;
      userMessage = 'Tidak dapat terhubung ke server autentikasi.';
    }
    return sendError(res, statusCode, userMessage);
  }
};

// -----------------------------------------------------------------------------
// RESEND VERIFICATION EMAIL
// -----------------------------------------------------------------------------
const resendVerificationEmail = async (req, res) => {
  let { email } = req.body || {};
  if (!email && req.user?.uid) {
    try {
      const userRecord = await admin.auth().getUser(req.user.uid);
      email = userRecord.email;
    } catch (err) {
      return sendError(res, 400, 'Tidak dapat mengambil email pengguna.');
    }
  }
  if (!email) return sendError(res, 400, 'Email diperlukan.');

  email = normalizeEmail(email);
  try {
    const link = await admin.auth().generateEmailVerificationLink(email);
    if (!link) return sendError(res, 500, 'Gagal membuat tautan verifikasi email.');

    await sendVerificationMail(email, link);

    return sendSuccess(res, 200, 'Tautan verifikasi telah dikirim.', {
      email,
    });
  } catch (err) {
    console.error('RESEND_VERIFICATION_ERROR:', err);
    return sendError(res, 500, 'Gagal mengirim ulang verifikasi.');
  }
};

// -----------------------------------------------------------------------------
// GET MY PROFILE
// -----------------------------------------------------------------------------
const getMyProfile = async (req, res) => {
  const { uid } = req.user;
  try {
    const userDocRef = db.collection('users').doc(uid);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) return sendError(res, 404, 'User data not found.');

    const userData = userDoc.data();
    const userAuthRecord = await admin.auth().getUser(uid);
    const emailVerified = userAuthRecord.emailVerified;

    // Sinkronisasi saat get profile jika diperlukan
    if (userData.emailVerified !== emailVerified) {
      await userDocRef.update({ emailVerified });
    }

    return sendSuccess(res, 200, 'User profile retrieved successfully', {
      uid,
      email: userData.email,
      nama: userData.nama,
      role: userData.role,
      emailVerified, // Selalu kirim status terbaru dari Auth
    });
  } catch (error) {
    console.error('GET_MY_PROFILE_ERROR:', error);
    return sendError(res, 500, 'Failed to fetch user profile.', error.message);
  }
};

// -----------------------------------------------------------------------------
// UPDATE FCM TOKEN
// -----------------------------------------------------------------------------
const updateFcmToken = async (req, res) => {
    // ... (Fungsi ini tidak diubah)
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
    console.error('UPDATE_FCM_TOKEN_ERROR:', err);
    return sendError(res, 500, 'Failed to update fcmToken.');
  }
};

// -----------------------------------------------------------------------------
// FORGOT PASSWORD
// -----------------------------------------------------------------------------
const forgotPassword = async (req, res) => {
    // ... (Fungsi ini tidak diubah)
  let { email } = req.body;
  if (!email) return sendError(res, 400, 'Email wajib diisi.');

  email = normalizeEmail(email);
  try {
    const firebaseResetUrl = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${APP_FIREBASE_WEB_API_KEY}`;

    await axios.post(firebaseResetUrl, { requestType: 'PASSWORD_RESET', email });
    return sendSuccess(res, 200, 'Email reset password telah dikirim.');
  } catch (error) {
    console.error('FORGOT_PASSWORD_ERROR:', error.response?.data || error.message);
    let message = 'Gagal mengirim email reset password.';
    if (error.response?.data?.error?.message === 'EMAIL_NOT_FOUND') {
      message = 'Email tidak terdaftar.';
    }
    return sendError(res, 400, message);
  }
};

// -----------------------------------------------------------------------------
// RESET PASSWORD
// -----------------------------------------------------------------------------
const resetPassword = async (req, res) => {
    // ... (Fungsi ini tidak diubah)
  const { oobCode, newPassword } = req.body;
  if (!oobCode || !newPassword) return sendError(res, 400, 'oobCode dan newPassword wajib diisi.');

  try {
    const firebaseResetUrl = `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${APP_FIREBASE_WEB_API_KEY}`;

    const response = await axios.post(firebaseResetUrl, { oobCode, newPassword });
    return sendSuccess(res, 200, 'Password berhasil direset.', response.data);
  } catch (error) {
    console.error('RESET_PASSWORD_ERROR:', error.response?.data || error.message);
    let message = 'Gagal mereset password.';
    const firebaseError = error.response?.data?.error?.message;
    if (firebaseError) {
      switch (firebaseError) {
        case 'INVALID_OOB_CODE': message = 'Kode reset tidak valid atau sudah kadaluarsa.'; break;
        case 'WEAK_PASSWORD': message = 'Password terlalu lemah.'; break;
        default: message = 'Terjadi kesalahan saat mereset password.'; break;
      }
    }
    return sendError(res, 400, message);
  }
};

// -----------------------------------------------------------------------------
// CHECK EMAIL VERIFICATION (PUBLIC) - Sebaiknya tidak digunakan lagi
// -----------------------------------------------------------------------------
const checkEmailVerification = async (req, res) => {
    // ... (Fungsi ini tidak diubah, namun sebaiknya tidak diandalkan)
  let { email } = req.body || {};
  if (!email) {
    return sendError(res, 400, 'Email wajib diisi.');
  }

  email = normalizeEmail(email);

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    const { uid, emailVerified } = userRecord;

    return sendSuccess(res, 200, 'Status verifikasi diperiksa.', {
      uid,
      verified: emailVerified,
    });
  } catch (err) {
    console.error('CHECK_EMAIL_VERIFICATION_ERROR:', err);
    if (err.code === 'auth/user-not-found') {
      return sendError(res, 404, 'Pengguna tidak ditemukan.');
    }
    return sendError(res, 500, 'Gagal memeriksa status verifikasi.', err.message);
  }
};

// -----------------------------------------------------------------------------
// VERIFY EMAIL (Endpoint ini tidak lagi digunakan oleh alur utama)
// -----------------------------------------------------------------------------
const verifyEmail = async (req, res) => {
    // ... (Fungsi ini tidak diubah, namun tidak lagi dipanggil)
  const { oobCode } = req.query;
  
  if (!oobCode) {
    // ... (kode error)
  }

  try {
    // ... (kode verifikasi)
  } catch (error) {
    // ... (kode error)
  }
};

module.exports = {
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
};