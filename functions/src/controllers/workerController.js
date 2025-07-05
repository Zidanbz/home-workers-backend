const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

/**
 * GET /api/workers/me
 */
const getMyProfile = async (req, res) => {
  const { uid } = req.user;
  try {
    const doc = await db.collection('workers').doc(uid).get();
    if (!doc.exists) {
      return sendError(res, 404, 'Worker profile not found for this user.');
    }
    return sendSuccess(res, 200, 'Worker profile fetched successfully.', { id: doc.id, ...doc.data() });
  } catch (error) {
    return sendError(res, 500, 'Failed to get worker profile.', error.message);
  }
};

/**
 * PUT /api/workers/me
 */
const updateMyProfile = async (req, res) => {
  const { uid } = req.user;
  const { keahlian, deskripsi } = req.body;

  try {
    const ref = db.collection('workers').doc(uid);
    const doc = await ref.get();
    if (!doc.exists) {
      return sendError(res, 404, 'Worker profile not found. Cannot update.');
    }

    await ref.update({ keahlian, deskripsi });
    return sendSuccess(res, 200, 'Worker profile updated successfully.');
  } catch (error) {
    return sendError(res, 500, 'Failed to update worker profile.', error.message);
  }
};

/**
 * GET /api/workers
 */
const getAllWorkers = async (req, res) => {
  try {
    const snapshot = await db.collection('workers').get();
    const workers = await Promise.all(snapshot.docs.map(async (doc) => {
      const workerData = doc.data();
      const userId = doc.id;
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) return null;

      const userData = userDoc.data();
      return {
        id: userId,
        nama: userData.nama,
        email: userData.email,
        ...workerData
      };
    }));

    const result = workers.filter(w => w !== null);
    return sendSuccess(res, 200, 'All workers fetched successfully.', result);
  } catch (error) {
    return sendError(res, 500, 'Failed to get all workers.', error.message);
  }
};

/**
 * GET /api/workers/:workerId
 */
const getWorkerById = async (req, res) => {
  const { workerId } = req.params;
  try {
    const [workerDoc, userDoc] = await Promise.all([
      db.collection('workers').doc(workerId).get(),
      db.collection('users').doc(workerId).get()
    ]);

    if (!workerDoc.exists || !userDoc.exists) {
      return sendError(res, 404, 'Worker not found.');
    }

    const userData = userDoc.data();
    const workerData = workerDoc.data();

    return sendSuccess(res, 200, 'Worker detail fetched successfully.', {
      id: workerId,
      nama: userData.nama,
      email: userData.email,
      ...workerData
    });
  } catch (error) {
    return sendError(res, 500, 'Failed to get worker details.', error.message);
  }
};

/**
 * GET /api/workers/me/dashboard
 */
const getDashboardSummary = async (req, res) => {
  const { uid: workerId } = req.user;

  try {
    const [pendingSnapshot, acceptedSnapshot, completedSnapshot] = await Promise.all([
      db.collection('orders').where('workerId', '==', workerId).where('status', '==', 'pending').get(),
      db.collection('orders').where('workerId', '==', workerId).where('status', '==', 'accepted').get(),
      db.collection('orders').where('workerId', '==', workerId).where('status', '==', 'completed').get(),
    ]);

    const summary = {
      pendingOrdersCount: pendingSnapshot.size,
      acceptedOrdersCount: acceptedSnapshot.size,
      completedOrdersCount: completedSnapshot.size,
    };

    return sendSuccess(res, 200, 'Dashboard summary fetched successfully.', summary);
  } catch (error) {
    return sendError(res, 500, 'Failed to get dashboard summary.', error.message);
  }
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  getAllWorkers,
  getWorkerById,
  getDashboardSummary,
};
