const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

/**
 * POST /api/users/me/avatar
 */
const updateAvatar = async (req, res) => {
  const { uid } = req.user;
  const { avatarUrl } = req.body;

  if (!avatarUrl) {
    return sendError(res, 400, 'Avatar URL is required.');
  }

  try {
    await db.collection('users').doc(uid).update({ avatarUrl });
    return sendSuccess(res, 200, 'Avatar updated successfully.');
  } catch (error) {
    return sendError(res, 500, 'Failed to update avatar', error.message);
  }
};

/**
 * POST /api/users/me/addresses
 */
const addAddress = async (req, res) => {
  const { uid } = req.user;
  const { label, fullAddress, latitude, longitude } = req.body;

  if (!label || !fullAddress) {
    return sendError(res, 400, 'Label and full address are required.');
  }

  try {
    const newAddress = await db.collection('users').doc(uid).collection('addresses').add({
      label,
      fullAddress,
      location: new admin.firestore.GeoPoint(latitude || 0, longitude || 0),
      createdAt: new Date(),
    });

    return sendSuccess(res, 201, 'Address added successfully', { addressId: newAddress.id });
  } catch (error) {
    return sendError(res, 500, 'Failed to add address', error.message);
  }
};

/**
 * GET /api/users/me/addresses
 */
const getAddresses = async (req, res) => {
  const { uid } = req.user;

  try {
    const snapshot = await db.collection('users').doc(uid).collection('addresses').get();

    const addresses = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return sendSuccess(res, 200, 'Addresses fetched successfully.', addresses);
  } catch (error) {
    return sendError(res, 500, 'Failed to get addresses', error.message);
  }
};

/**
 * POST /api/users/me/documents
 */
const uploadDocuments = async (req, res) => {
  const { uid, role } = req.user;
  const { ktpUrl, portfolioUrl } = req.body;

  if (role !== 'WORKER') {
    return sendError(res, 403, 'Forbidden: This feature is for workers only.');
  }

  if (!ktpUrl && !portfolioUrl) {
    return sendError(res, 400, 'At least one document URL is required.');
  }

  try {
    const documentsData = {};
    if (ktpUrl) documentsData.ktpUrl = ktpUrl;
    if (portfolioUrl) documentsData.portfolioUrl = portfolioUrl;

    await db.collection('workers').doc(uid).update(documentsData);
    return sendSuccess(res, 200, 'Documents uploaded successfully.');
  } catch (error) {
    return sendError(res, 500, 'Failed to upload documents', error.message);
  }
};

/**
 * PUT /api/users/me
 */
const updateMyProfile = async (req, res) => {
  const { uid } = req.user;
  const { nama, contact, gender } = req.body;

  const dataToUpdate = {};
  if (nama) dataToUpdate.nama = nama;
  if (contact) dataToUpdate.contact = contact;
  if (gender) dataToUpdate.gender = gender;

  if (Object.keys(dataToUpdate).length === 0) {
    return sendError(res, 400, 'No data provided for update.');
  }

  try {
    await db.collection('users').doc(uid).update(dataToUpdate);
    return sendSuccess(res, 200, 'Profile updated successfully.');
  } catch (error) {
    return sendError(res, 500, 'Failed to update profile', error.message);
  }
};

/**
 * GET /api/users/me/notifications
 * Mengambil daftar semua notifikasi untuk pengguna yang sedang login.
 */
const getMyNotifications = async (req, res) => {
  const { uid } = req.user;

  try {
      const notificationsRef = db.collection('users').doc(uid).collection('notifications');
      const snapshot = await notificationsRef.orderBy('timestamp', 'desc').limit(30).get();

      if (snapshot.empty) {
          return res.status(200).json([]);
      }

      const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.status(200).json(notifications);

  } catch (error) {
      res.status(500).json({ message: 'Failed to get notifications', error: error.message });
  }
};


module.exports = {
  updateAvatar,
  addAddress,
  getAddresses,
  uploadDocuments,
  updateMyProfile,
  getMyNotifications,
};
