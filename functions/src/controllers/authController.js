// src/controllers/authController.js

const admin = require('firebase-admin');
const db = admin.firestore();
const axios = require('axios'); 
const { sendSuccess, sendError } = require('../utils/responseHelper');
const multer = require('multer');
const upload = multer({ dest: 'uploads/ktp/' }); // Atau gunakan Firebase Storage nanti


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
    return sendError(res, 409, "Failed to register customer", error.message);
  }
};

/**
 * Registrasi untuk WORKER tanpa token.
 */
const registerWorker = async (req, res) => {
  const { email, password, nama, keahlian, deskripsi, linkPortofolio, noKtp } = req.body;
  const ktpFile = req.file;

  if (!email || !password || !nama) {
    return sendError(res, 400, "Email, password, dan nama wajib diisi.");
  }

  if (!ktpFile) {
    return sendError(res, 400, "KTP wajib diunggah.");
  }

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: nama,
    });

    const uid = userRecord.uid;
    const batch = db.batch();

    const userDocRef = db.collection('users').doc(uid);
    batch.set(userDocRef, {
      email,
      nama,
      role: 'WORKER',
      createdAt: new Date(),
    });

    const workerDocRef = db.collection('workers').doc(uid);
    batch.set(workerDocRef, {
      keahlian: keahlian || [],
      deskripsi: deskripsi || '',
      noKtp: noKtp || '',
      linkPortofolio: linkPortofolio || '',
      ktpFilePath: ktpFile.path, // Simpan path jika belum pakai Firebase Storage
      rating: 0,
      jumlahOrderSelesai: 0,
      dibuatPada: new Date(),
    });

    await batch.commit();

    return sendSuccess(res, 201, "Worker user registered successfully", { userId: uid });
  } catch (error) {
    return sendError(res, 409, "Failed to register worker", error.message);
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

    const { localId: uid } = firebaseResponse.data;
    const customToken = await admin.auth().createCustomToken(uid);

    const userDocRef = db.collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return sendError(res, 404, 'User data not found in our database.');
    }

    const userData = userDoc.data();

    return sendSuccess(res, 200, 'Login successful', {
      customToken,
      user: {
        uid,
        email: userData.email,
        nama: userData.nama,
        role: userData.role,
      }
    });
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || 'Invalid credentials';
    return sendError(res, 401, errorMessage);
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
    return sendError(res, 500, "Failed to fetch user profile.", error.message);
  }
};

module.exports = {
  registerCustomer,
  registerWorker,
  loginUser,
  getMyProfile,
};
