const admin = require('firebase-admin');
const db = admin.firestore();

const getMyProfile = async (req, res) => {
    const { uid } = req.user;
    try {
        const workerDocRef = db.collection('workers').doc(uid);
        const doc = await workerDocRef.get();
        if (!doc.exists) {
            return res.status(404).json({ message: "Worker profile not found for this user." });
        }
        res.status(200).json({ id: doc.id, ...doc.data() });
    } catch (error) {
        res.status(500).json({ message: 'Failed to get worker profile', error: error.message });
    }
};

const updateMyProfile = async (req, res) => {
    const { uid } = req.user;
    const { keahlian, deskripsi } = req.body;
    try {
        const workerDocRef = db.collection('workers').doc(uid);
        const doc = await workerDocRef.get();
        if (!doc.exists) {
            return res.status(404).json({ message: "Worker profile not found. Cannot update." });
        }
        await workerDocRef.update({
            keahlian: keahlian,
            deskripsi: deskripsi,
        });
        res.status(200).json({ message: 'Worker profile updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update worker profile', error: error.message });
    }
};

const getAllWorkers = async (req, res) => {
    try {
        const workersSnapshot = await db.collection('workers').get();
        const promises = workersSnapshot.docs.map(async (workerDoc) => {
            const workerData = workerDoc.data();
            const userId = workerDoc.id;
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                return { id: userId, nama: userData.nama, email: userData.email, ...workerData };
            }
            return null;
        });
        const combinedWorkers = (await Promise.all(promises)).filter(w => w !== null);
        res.status(200).json(combinedWorkers);
    } catch (error) {
        res.status(500).json({ message: 'Failed to get all workers', error: error.message });
    }
};

const getWorkerById = async (req, res) => {
    try {
        const { workerId } = req.params;
        const workerDoc = await db.collection('workers').doc(workerId).get();
        const userDoc = await db.collection('users').doc(workerId).get();
        if (!workerDoc.exists || !userDoc.exists) {
            return res.status(404).json({ message: 'Worker not found.' });
        }
        const combinedData = { id: workerId, nama: userDoc.data().nama, email: userDoc.data().email, ...workerDoc.data() };
        res.status(200).json(combinedData);
    } catch (error) {
        res.status(500).json({ message: 'Failed to get worker details', error: error.message });
    }

    
};

const getDashboardSummary = async (req, res) => {
    const { uid: workerId } = req.user;

    try {
        // Kita akan menjalankan beberapa query secara bersamaan untuk efisiensi
        const pendingOrdersQuery = db.collection('orders').where('workerId', '==', workerId).where('status', '==', 'pending').get();
        const acceptedOrdersQuery = db.collection('orders').where('workerId', '==', workerId).where('status', '==', 'accepted').get();
        const completedOrdersQuery = db.collection('orders').where('workerId', '==', workerId).where('status', '==', 'completed').get();

        // Jalankan semua query
        const [
            pendingSnapshot,
            acceptedSnapshot,
            completedSnapshot
        ] = await Promise.all([pendingOrdersQuery, acceptedOrdersQuery, completedOrdersQuery]);

        // Hitung jumlah dari setiap query
        const summary = {
            pendingOrdersCount: pendingSnapshot.size,
            acceptedOrdersCount: acceptedSnapshot.size,
            completedOrdersCount: completedSnapshot.size,
            // TODO: Tambahkan logika untuk mengambil review terbaru jika diperlukan
        };

        res.status(200).json(summary);

    } catch (error) {
        res.status(500).json({ message: 'Failed to get dashboard summary', error: error.message });
    }
};

// BAGIAN PALING PENTING ADA DI SINI
module.exports = {
    getMyProfile,
    updateMyProfile,
    getAllWorkers,
    getWorkerById,
    getDashboardSummary,
};