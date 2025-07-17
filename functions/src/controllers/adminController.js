// src/controllers/adminController.js

const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

/**
 * GET /api/admin/services/pending
 * Admin mengambil daftar semua layanan yang menunggu persetujuan.
 */
const getPendingServices = async (req, res) => {
  try {
    const pendingServicesQuery = db.collection('service').where('statusPersetujuan', '==', 'pending');
    const snapshot = await pendingServicesQuery.get();

    if (snapshot.empty) {
      return sendSuccess(res, 200, 'No pending services found', []);
    }

    const pendingServices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return sendSuccess(res, 200, 'Pending services retrieved successfully', pendingServices);
  } catch (error) {
    return sendError(res, 500, 'Failed to get pending services', error.message);
  }
};

/**
 * PUT /api/admin/services/:serviceId/approve
 * Admin menyetujui sebuah layanan.
 */
const approveService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const serviceRef = db.collection('services').doc(serviceId);

    const serviceDoc = await serviceRef.get();
    if (!serviceDoc.exists) {
      return sendError(res, 404, 'Service not found');
    }

    const serviceData = serviceDoc.data();
    const workerId = serviceData.workerId;

    await serviceRef.update({ statusPersetujuan: 'approved' });

    const workerUserDoc = await db.collection('users').doc(workerId).get();
    if (workerUserDoc.exists) {
        const fcmToken = workerUserDoc.data().fcmToken;
        const notificationPayload = {
            notification: {
                title: 'Layanan Disetujui! ✅',
                body: `Layanan Anda "${serviceData.namaLayanan}" telah disetujui.`,
            },
            token: fcmToken,
            data: { serviceId: serviceId, screen: 'my_jobs' }
        };

        // --- LOGIKA BARU DIMULAI DI SINI ---

        // Simpan notifikasi ke sub-koleksi 'notifications' milik worker
        const notificationRef = db.collection('users').doc(workerId).collection('notifications').doc();
        await notificationRef.set({
            title: notificationPayload.notification.title,
            body: notificationPayload.notification.body,
            timestamp: new Date(),
            isRead: false,
            type: 'service_approved',
            relatedId: serviceId,
        });

        // Kirim notifikasi push jika token ada
        if (fcmToken) {
            await admin.messaging().send(notificationPayload);
        }
    }
    
    res.status(200).json({ message: 'Service approved successfully.' });
} catch (error) {
    res.status(500).json({ message: 'Failed to approve service', error: error.message });
}
};

/**
 * PUT /api/admin/services/:serviceId/reject
 * Admin menolak sebuah layanan DAN mengirim notifikasi ke worker.
 */
const rejectService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const serviceRef = db.collection('services').doc(serviceId);

    const serviceDoc = await serviceRef.get();
    if (!serviceDoc.exists) {
      return sendError(res, 404, 'Service not found');
    }

    const serviceData = serviceDoc.data();
    const workerId = serviceData.workerId;

    await serviceRef.update({ statusPersetujuan: 'rejected' });

    const workerUserDoc = await db.collection('users').doc(workerId).get();
    if (workerUserDoc.exists) {
      const fcmToken = workerUserDoc.data().fcmToken;
      if (fcmToken) {
        const payload = {
          notification: {
            title: 'Layanan Ditolak ❌',
            body: `Layanan Anda "${serviceData.namaLayanan}" ditolak. Silakan periksa dan perbarui layanan Anda.`,
          },
          token: fcmToken,
          data: {
            serviceId: serviceId,
            screen: 'my_jobs',
          },
        };
        await admin.messaging().send(payload);
        console.log(`Notifikasi penolakan dikirim ke worker: ${workerId}`);
      }
    }

    return sendSuccess(res, 200, 'Service rejected successfully');
  } catch (error) {
    return sendError(res, 500, 'Failed to reject service', error.message);
  }
};

/**
 * POST /api/admin/broadcast
 * Admin mengirim notifikasi broadcast ke target pengguna.
 */
const sendBroadcast = async (req, res) => {
  const { title, body, imageUrl, target, userIds } = req.body;

  if (!title || !body || !target) {
    return sendError(res, 400, 'Title, body, and target are required.');
  }

  try {
    let usersQuery = db.collection('users');

    if (target === 'customers') {
      usersQuery = usersQuery.where('role', '==', 'CUSTOMER');
    } else if (target === 'workers') {
      usersQuery = usersQuery.where('role', '==', 'WORKER');
    } else if (target !== 'all') {
      return sendError(res, 400, "Invalid target. Use 'all', 'customers', or 'workers'.");
    }

    const usersSnapshot = await usersQuery.get();
    const fcmTokens = [];

    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.fcmToken) {
        fcmTokens.push(userData.fcmToken);
      }
    });

    if (fcmTokens.length === 0) {
      return sendSuccess(res, 200, 'Broadcast processed, but no users with FCM tokens found for the target.');
    }

    const payload = {
      notification: {
        title: title,
        body: body,
      },
    };

    if (imageUrl) {
      payload.notification.image = imageUrl;
    }

    const response = await admin.messaging().sendToDevice(fcmTokens, payload);

    console.log(`Broadcast sent. Success count: ${response.successCount}, Failure count: ${response.failureCount}`);

    return sendSuccess(res, 200, 'Broadcast sent successfully.', {
      successCount: response.successCount,
      failureCount: response.failureCount,
    });
  } catch (error) {
    console.error('Error sending broadcast:', error);
    return sendError(res, 500, 'Failed to send broadcast', error.message);
  }
};

const getAllOrders = async (req, res) => {
  try {
    const snapshot = await db.collection('orders').orderBy('createdAt', 'desc').get();
    const orders = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const [customerSnap, workerSnap] = await Promise.all([
        db.collection('users').doc(data.customerId).get(),
        db.collection('users').doc(data.workerId).get(),
      ]);

      orders.push({
        id: doc.id,
        ...data,
        customerName: customerSnap.exists ? customerSnap.data().nama : null,
        workerName: workerSnap.exists ? workerSnap.data().nama : null,
      });
    }

    return sendSuccess(res, 200, 'All orders fetched', orders);
  } catch (error) {
    return sendError(res, 500, 'Failed to fetch orders', error.message);
  }
};

const getAllWorkers = async (req, res) => {
  try {
    const snapshot = await db.collection('workers').get();
    const workers = [];

    for (const doc of snapshot.docs) {
      const workerData = doc.data();
      const userSnap = await db.collection('users').doc(doc.id).get();
      const userData = userSnap.exists ? userSnap.data() : {};

      workers.push({
        id: doc.id,
        nama: userData.nama,
        email: userData.email,
        status: workerData.status,
        deskripsi: workerData.deskripsi,
        ktpUrl: workerData.ktpUrl,
        fotoDiriUrl: workerData.fotoDiriUrl,
      });
    }

    return sendSuccess(res, 200, 'Workers fetched successfully', workers);
  } catch (error) {
    return sendError(res, 500, 'Failed to fetch workers', error.message);
  }
};

const getPendingWorkers = async (req, res) => {
  try {
    const snapshot = await db.collection('workers').where('status', '==', 'pending').get();

    const pendingWorkers = await Promise.all(snapshot.docs.map(async doc => {
      const data = doc.data();
      const userSnap = await db.collection('users').doc(doc.id).get();
      const userData = userSnap.exists ? userSnap.data() : {};

      return {
        id: doc.id,
        ...data,
        nama: userData.nama,
        email: userData.email,
        fotoUrl: userData.fotoUrl || '',
      };
    }));

    return sendSuccess(res, 200, 'Pending workers fetched successfully', pendingWorkers);
  } catch (error) {
    return sendError(res, 500, 'Failed to fetch pending workers', error.message);
  }
};

const approveWorker = async (req, res) => {
  try {
    const { workerId } = req.params;
    const workerRef = db.collection('workers').doc(workerId);
    const workerSnap = await workerRef.get();

    if (!workerSnap.exists) return sendError(res, 404, 'Worker not found');

    await workerRef.update({ status: 'approved' });

    // Kirim notifikasi ke worker
    const userSnap = await db.collection('users').doc(workerId).get();
    const fcmToken = userSnap.data()?.fcmToken;

    if (fcmToken) {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: 'Akun Disetujui ✅',
          body: 'Akun worker Anda telah disetujui dan siap digunakan.',
        },
        data: { screen: 'profile' },
      });
    }

    return sendSuccess(res, 200, 'Worker approved successfully');
  } catch (error) {
    return sendError(res, 500, 'Failed to approve worker', error.message);
  }
};

const rejectWorker = async (req, res) => {
  try {
    const { workerId } = req.params;
    const workerRef = db.collection('workers').doc(workerId);
    const workerSnap = await workerRef.get();

    if (!workerSnap.exists) return sendError(res, 404, 'Worker not found');

    await workerRef.update({ status: 'rejected' });

    // Kirim notifikasi ke worker
    const userSnap = await db.collection('users').doc(workerId).get();
    const fcmToken = userSnap.data()?.fcmToken;

    if (fcmToken) {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: 'Pendaftaran Ditolak ❌',
          body: 'Akun worker Anda ditolak. Silakan hubungi admin atau coba lagi.',
        },
        data: { screen: 'profile' },
      });
    }

    return sendSuccess(res, 200, 'Worker rejected successfully');
  } catch (error) {
    return sendError(res, 500, 'Failed to reject worker', error.message);
  }
};




module.exports = {
  getPendingServices,
  approveService,
  rejectService,
  sendBroadcast,
  getAllOrders,
  getAllWorkers,
  getPendingWorkers,
  approveWorker,
  rejectWorker,
};
