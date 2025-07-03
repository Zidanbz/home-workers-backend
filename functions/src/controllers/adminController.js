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
        const serviceRef = db.collection('service').doc(serviceId);

        await serviceRef.update({ statusPersetujuan: 'approved' });

        res.status(200).json({ message: 'Service approved successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to approve service', error: error.message });
    }
};

/**
 * PUT /api/admin/services/:serviceId/reject
 * Admin menolak sebuah layanan.
 */
const rejectService = async (req, res) => {
    try {
        const { serviceId } = req.params;
        const serviceRef = db.collection('service').doc(serviceId);

        await serviceRef.update({ statusPersetujuan: 'rejected' });

        res.status(200).json({ message: 'Service rejected successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to reject service', error: error.message });
    }
};


module.exports = {
    getPendingServices,
    approveService,
    rejectService,
};