// src/controllers/adminController.js

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * GET /api/admin/services/pending
 * Admin mengambil daftar semua layanan yang menunggu persetujuan.
 */
const getPendingServices = async (req, res) => {
    try {
        const pendingServicesQuery = db.collection('service').where('statusPersetujuan', '==', 'pending');
        const snapshot = await pendingServicesQuery.get();

        if (snapshot.empty) {
            return res.status(200).json([]);
        }

        const pendingServices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(pendingServices);
    } catch (error) {
        res.status(500).json({ message: 'Failed to get pending services', error: error.message });
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

        // --- LANGKAH BARU: Ambil data layanan sebelum di-update ---
        const serviceDoc = await serviceRef.get();
        if (!serviceDoc.exists) {
            return res.status(404).json({ message: "Service not found." });
        }
        const serviceData = serviceDoc.data();
        const workerId = serviceData.workerId;
        
        // Update status layanan menjadi 'approved'
        await serviceRef.update({ statusPersetujuan: 'approved' });

        // --- LANGKAH BARU: Kirim Notifikasi ---
        const workerUserDoc = await db.collection('users').doc(workerId).get();
        if (workerUserDoc.exists) {
            const fcmToken = workerUserDoc.data().fcmToken;
            if (fcmToken) {
                const payload = {
                    notification: {
                        title: 'Layanan Disetujui! ✅',
                        body: `Layanan Anda "${serviceData.namaLayanan}" telah disetujui dan kini aktif di marketplace.`,
                    },
                    token: fcmToken,
                    data: {
                        serviceId: serviceId,
                        screen: 'my_jobs' // Contoh data untuk navigasi di aplikasi
                    }
                };
                await admin.messaging().send(payload);
                console.log(`Notifikasi persetujuan dikirim ke worker: ${workerId}`);
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

        // --- LANGKAH BARU: Ambil data layanan sebelum di-update ---
        const serviceDoc = await serviceRef.get();
        if (!serviceDoc.exists) {
            return res.status(404).json({ message: "Service not found." });
        }
        const serviceData = serviceDoc.data();
        const workerId = serviceData.workerId;

        // Update status layanan menjadi 'rejected'
        await serviceRef.update({ statusPersetujuan: 'rejected' });

        // --- LANGKAH BARU: Kirim Notifikasi ---
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
                        screen: 'my_jobs'
                    }
                };
                await admin.messaging().send(payload);
                console.log(`Notifikasi penolakan dikirim ke worker: ${workerId}`);
            }
        }

        res.status(200).json({ message: 'Service rejected successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to reject service', error: error.message });
    }
};


/**
 * POST /api/admin/broadcast
 * Admin mengirim notifikasi broadcast ke target pengguna.
 */
const sendBroadcast = async (req, res) => {
    // --- PERUBAHAN 1: Tambahkan imageUrl dari body ---
    const { title, body, imageUrl, target, userIds } = req.body; // target bisa 'all', 'customers', 'workers'

    if (!title || !body || !target) {
        return res.status(400).json({ message: 'Title, body, and target are required.' });
    }

    try {
        let usersQuery = db.collection('users');

        // Filter pengguna berdasarkan target
        if (target === 'customers') {
            usersQuery = usersQuery.where('role', '==', 'CUSTOMER');
        } else if (target === 'workers') {
            usersQuery = usersQuery.where('role', '==', 'WORKER');
        } else if (target !== 'all') {
            return res.status(400).json({ message: "Invalid target. Use 'all', 'customers', or 'workers'." });
        }
        
        const usersSnapshot = await usersQuery.get();

        // Kumpulkan semua FCM token yang valid dari pengguna yang ditargetkan
        const fcmTokens = [];
        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            if (userData.fcmToken) {
                fcmTokens.push(userData.fcmToken);
            }
        });

        if (fcmTokens.length === 0) {
            return res.status(200).json({ message: 'Broadcast processed, but no users with FCM tokens found for the target.' });
        }

        // --- PERUBAHAN 2: Buat payload notifikasi dengan gambar (jika ada) ---
        const payload = {
            notification: {
                title: title,
                body: body,
            },
        };
        
        // Tambahkan gambar ke notifikasi jika URL-nya ada
        if (imageUrl) {
            payload.notification.image = imageUrl;
        }

        // Kirim notifikasi ke banyak perangkat sekaligus menggunakan sendMulticast
        // Catatan: sendMulticast memiliki batas 500 token per panggilan.
        // Untuk skala besar, perlu logika tambahan untuk memecah token menjadi beberapa batch.
        const response = await admin.messaging().sendToDevice(fcmTokens, payload);

        console.log(`Broadcast sent. Success count: ${response.successCount}, Failure count: ${response.failureCount}`);

        res.status(200).json({
            message: 'Broadcast sent successfully.',
            successCount: response.successCount,
            failureCount: response.failureCount,
        });

    } catch (error) {
        console.error("Error sending broadcast:", error);
        res.status(500).json({ message: 'Failed to send broadcast', error: error.message });
    }
};


module.exports = {
    getPendingServices,
    approveService,
    rejectService,
    sendBroadcast,
};