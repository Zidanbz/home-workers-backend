// src/controllers/adminController.js

const admin = require('firebase-admin');
const db = admin.firestore();

const { sendSuccess, sendError } = require('../utils/responseHelper');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bucket = admin.storage().bucket();
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
    const serviceRef = db.collection('service').doc(serviceId);

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
    const serviceRef = db.collection('service').doc(serviceId);

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
async function uploadBroadcastImage(file, uidLabel = 'admin') {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
  const filePath = `broadcast/${uidLabel}/${Date.now()}_${uuidv4()}${safeExt}`;

  const storageFile = bucket.file(filePath);
  const stream = storageFile.createWriteStream({
    metadata: { contentType: file.mimetype || 'image/jpeg' },
  });

  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(file.buffer);
  });

  // Buat publik agar FCM bisa load image
  await storageFile.makePublic();
  return storageFile.publicUrl();
}

/**
 * Chunk array tokens (FCM max 500 per multicast call).
 */
function chunkArray(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Kirim broadcast push notification ke target user.
 * Dukung upload file image (multipart) seperti registerWorker.
 */
const sendBroadcast = async (req, res) => {
  const { title, body, target, imageUrl: imageUrlField, userIds } = req.body;

  if (!title || !body || !target) {
    return sendError(res, 400, 'Title, body, and target are required.');
  }

  // Ambil file image (busboyupload style: req.files.image atau array)
  let imageFile = null;
  if (req.files?.image) {
    // Bisa berupa single object atau array
    imageFile = Array.isArray(req.files.image) ? req.files.image[0] : req.files.image;
  }

  let finalImageUrl;
  try {
    // ------------------------------------------------------------------
    // 1. Jika ada file image → upload ke Storage (public)
    // ------------------------------------------------------------------
    if (imageFile) {
      finalImageUrl = await uploadBroadcastImage(imageFile, 'adminBroadcast');
    } else if (imageUrlField && typeof imageUrlField === 'string' && imageUrlField.trim() !== '') {
      // fallback ke imageUrl yang dikirim manual
      finalImageUrl = imageUrlField.trim();
    }

    // ------------------------------------------------------------------
    // 2. Ambil daftar user (dari userIds atau target role)
    // ------------------------------------------------------------------
    let fcmTokens = [];
    let userCount = 0;

    if (userIds) {
      // jika userIds dikirim (string JSON), override target
      let arr = [];
      try {
        arr = Array.isArray(userIds) ? userIds : JSON.parse(userIds);
      } catch (_) { arr = []; }
      const uniqueIds = [...new Set(arr.filter(Boolean))];

      if (uniqueIds.length) {
        const batchGet = await Promise.all(
          uniqueIds.map(id => db.collection('users').doc(id).get())
        );
        batchGet.forEach(docSnap => {
          if (docSnap.exists) {
            const d = docSnap.data();
            userCount++;
            if (d?.fcmToken) fcmTokens.push(d.fcmToken);
          }
        });
      }
    } else {
      // query by target: customers / workers / all
      let usersQuery = db.collection('users');
      if (target === 'customers') {
        usersQuery = usersQuery.where('role', '==', 'CUSTOMER');
      } else if (target === 'workers') {
        usersQuery = usersQuery.where('role', '==', 'WORKER');
      } else if (target !== 'all') {
        return sendError(res, 400, "Invalid target. Use 'all', 'customers', or 'workers'.");
      }

      const snapshot = await usersQuery.get();
      userCount = snapshot.size;
      snapshot.forEach(doc => {
        const d = doc.data();
        if (d?.fcmToken && typeof d.fcmToken === 'string' && d.fcmToken.trim() !== '') {
          fcmTokens.push(d.fcmToken.trim());
        }
      });
    }

    // Dedup token (beberapa user mungkin share device)
    fcmTokens = [...new Set(fcmTokens)];

    if (fcmTokens.length === 0) {
      return sendSuccess(
        res,
        200,
        'Broadcast processed, but no users with FCM tokens found for the target.',
        { target, userCount, imageUrl: finalImageUrl || null }
      );
    }

    // ------------------------------------------------------------------
    // 3. Siapkan message FCM
    // ------------------------------------------------------------------
    const baseNotif = {
      title,
      body,
      ...(finalImageUrl ? { image: finalImageUrl } : {})
    };

    // Data tambahan (opsional untuk deep link)
    // const dataPayload = { deeplink: 'home_workers://promo', type: 'broadcast' };

    // ------------------------------------------------------------------
    // 4. Kirim dalam batch (chunk 500 token)
    // ------------------------------------------------------------------
    const tokenChunks = chunkArray(fcmTokens, 500);
    let totalSuccess = 0;
    let totalFailure = 0;

    for (const tkChunk of tokenChunks) {
      const message = {
        tokens: tkChunk,
        notification: baseNotif,
        // data: dataPayload, // aktifkan jika diperlukan
      };

      const resp = await admin.messaging().sendEachForMulticast(message);
      totalSuccess += resp.successCount;
      totalFailure += resp.failureCount;

      if (resp.responses?.length) {
        resp.responses.forEach((r, idx) => {
          if (!r.success) {
            console.warn(
              `Broadcast FCM error token[${idx}]:`,
              r.error?.code,
              r.error?.message
            );
          }
        });
      }
    }

    // ------------------------------------------------------------------
    // 5. (Opsional) simpan log broadcast ke Firestore
    // ------------------------------------------------------------------
    await db.collection('notification').add({
      title,
      body,
      imageUrl: finalImageUrl || null,
      target,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      tokenSent: fcmTokens.length,
      successCount: totalSuccess,
      failureCount: totalFailure,
    });

    return sendSuccess(res, 200, 'Broadcast sent successfully.', {
      target,
      userCount,
      tokenSent: fcmTokens.length,
      successCount: totalSuccess,
      failureCount: totalFailure,
      imageUrl: finalImageUrl || null,
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
    const { status } = req.query; // optional filter

    let workersQuery = db.collection('workers');
    if (status) {
      workersQuery = workersQuery.where('status', '==', status);
    }

    const snapshot = await workersQuery.get();
    if (snapshot.empty) {
      return sendSuccess(res, 200, 'No workers found', []);
    }

    // Ambil semua user doc paralel berdasarkan ID dokumen workers
    const workerDocs = snapshot.docs;
    const userFetches = workerDocs.map((doc) =>
      db.collection('users').doc(doc.id).get()
    );

    const userSnaps = await Promise.all(userFetches);

    const workers = workerDocs.map((doc, i) => {
      const workerData = doc.data() || {};
      const userSnap = userSnaps[i];
      const userData = userSnap.exists ? userSnap.data() : {};

      return {
        id: doc.id,
        nama: userData.nama ?? workerData.nama ?? '',
        email: userData.email ?? '',
        contact: userData.contact ?? null,
        role: userData.role ?? 'WORKER',
        status: workerData.status ?? 'pending',
        deskripsi: workerData.deskripsi ?? '',
        ktpUrl: workerData.ktpUrl ?? null,
        fotoDiriUrl: workerData.fotoDiriUrl ?? null,
        linkPortofolio: workerData.linkPortofolio ?? null,
        jumlahOrderSelesai: workerData.jumlahOrderSelesai ?? 0,
        rating: workerData.rating ?? 0,
      };
    });

    return sendSuccess(res, 200, 'Workers fetched successfully.', workers);
  } catch (error) {
    console.error('[getAllWorkers] error:', error);
    return sendError(res, 500, 'Failed to fetch workers.', error.message);
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
