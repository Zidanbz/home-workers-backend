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
  const { uid: workerId, role } = req.user || {};

  if (!workerId) {
    return sendError(res, 401, 'Unauthorized: missing user.');
  }
  if (role && role !== 'WORKER') {
    return sendError(res, 403, 'Forbidden: only workers can access this endpoint.');
  }

  try {
    const ordersRef = db.collection('orders');
    const workersRef = db.collection('workers').doc(workerId);
    const usersRef = db.collection('users').doc(workerId);
    const reviewsRef = db.collection('reviews');

    // --- Parallel Firestore reads ---
    const [
      pendingQ,
      acceptedQ,
      completedQ,
      workerDocSnap,
      userDocSnap,
      recentReviewsSnap,
    ] = await Promise.all([
      ordersRef.where('workerId', '==', workerId).where('status', '==', 'pending').get(),
      ordersRef.where('workerId', '==', workerId).where('status', '==', 'accepted').get(),
      ordersRef.where('workerId', '==', workerId).where('status', '==', 'completed').get(),
      workersRef.get(),
      usersRef.get(),
      reviewsRef
        .where('workerId', '==', workerId)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get(),
    ]);

    const summary = {
      pendingOrdersCount: pendingQ.size,
      acceptedOrdersCount: acceptedQ.size,
      completedOrdersCount: completedQ.size,
    };

    // --- Worker profile merge ---
    let workerData = {};
    if (workerDocSnap.exists) workerData = { ...workerDocSnap.data() };
    if (userDocSnap.exists) {
      // utamakan field user untuk nama/email/kontak
      const userData = userDocSnap.data();
      workerData = {
        ...workerData,
        uid: workerId,
        nama: userData.nama ?? workerData.nama,
        email: userData.email ?? workerData.email,
        contact: userData.contact ?? workerData.contact,
        role: userData.role ?? workerData.role,
      };
    } else {
      workerData = { ...workerData, uid: workerId }; // minimal
    }

    // Pastikan array
    if (!Array.isArray(workerData.keahlian) && workerData.keahlian != null) {
      // Firestore bisa simpan map numerik; ubah ke array nilai
      workerData.keahlian = Object.values(workerData.keahlian);
    }

    // --- Reviews + rating aggregate ---
    let ratingSum = 0;
    const reviews = recentReviewsSnap.docs.map((doc) => {
      const d = doc.data();
      const rating = typeof d.rating === 'number' ? d.rating : 0;
      ratingSum += rating;
      return {
        reviewId: doc.id,
        customerId: d.customerId ?? null,
        customerName: d.customerName ?? 'Customer',
        customerAvatarUrl: d.customerAvatarUrl ?? null,
        rating,
        comment: d.comment ?? '',
        createdAt: d.createdAt?.toDate
          ? d.createdAt.toDate().toISOString()
          : d.createdAt ?? null,
        verified: !!d.verified,
      };
    });

    const ratingCount = recentReviewsSnap.size;
    const ratingAverage = ratingCount > 0 ? ratingSum / ratingCount : 0;

    // Jika workerData.rating kosong dan kamu ingin auto‑isi:
    if (workerData.rating == null || workerData.rating === 0) {
      workerData.rating = ratingAverage;
    }

    const payload = {
      ...summary,
      worker: workerData,
      reviews,
      ratingAverage,
      ratingCount,
    };

    return sendSuccess(res, 200, 'Dashboard summary fetched successfully.', payload);
  } catch (error) {
    console.error('[getDashboardSummary] error:', error);
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
