const admin = require('firebase-admin');
const db = admin.firestore();

// Membuat review dari customer untuk order tertentu
const createReview = async (req, res) => {
    const { uid: customerId } = req.user;
    const { orderId } = req.params;
    const { rating, comment } = req.body;

    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Rating must be a number between 1 and 5." });
    }

    try {
        await db.runTransaction(async (transaction) => {
            const orderRef = db.collection('orders').doc(orderId);
            const orderDoc = await transaction.get(orderRef);

            if (!orderDoc.exists) throw new Error("Order not found.");
            const orderData = orderDoc.data();

            if (orderData.customerId !== customerId)
                throw new Error("Forbidden: You are not the customer for this order.");
            if (orderData.status !== 'completed')
                throw new Error("Only completed orders can be reviewed.");
            if (orderData.hasBeenReviewed)
                throw new Error("This order has already been reviewed.");

            const workerId = orderData.workerId;
            const workerRef = db.collection('workers').doc(workerId);
            const workerDoc = await transaction.get(workerRef);

            if (!workerDoc.exists) throw new Error("Worker profile not found.");

            const workerData = workerDoc.data();
            const oldRating = workerData.rating || 0;
            const oldOrderCount = workerData.jumlahOrderSelesai || 0;
            const newOrderCount = oldOrderCount + 1;
            const newAverageRating = ((oldRating * oldOrderCount) + rating) / newOrderCount;

            transaction.set(db.collection('reviews').doc(), {
                orderId,
                workerId,
                customerId,
                rating,
                comment: comment || '',
                createdAt: admin.firestore.Timestamp.now(),
            });

            transaction.update(workerRef, {
                rating: newAverageRating,
                jumlahOrderSelesai: newOrderCount,
            });

            transaction.update(orderRef, { hasBeenReviewed: true });
        });

        res.status(201).json({ message: "Review submitted successfully." });
    } catch (error) {
        res.status(409).json({ message: error.message || "Failed to submit review." });
    }
};

// Mengambil review untuk worker yang sedang login
const getReviewsForWorker = async (req, res) => {
    const { uid: workerId, role } = req.user;

    if (role !== 'WORKER') {
        return res.status(403).json({ message: 'Forbidden: Only workers can view their reviews.' });
    }

    try {
        const snapshot = await db.collection('reviews')
            .where('workerId', '==', workerId)
            .orderBy('createdAt', 'desc')
            .get();

        const reviews = await Promise.all(snapshot.docs.map(async (doc) => {
            const data = doc.data();
            const customerDoc = await db.collection('users').doc(data.customerId).get();

            return {
                id: doc.id,
                ...data,
                customerInfo: customerDoc.exists ? {
                    nama: customerDoc.data().nama,
                    avatarUrl: customerDoc.data().avatarUrl || '',
                } : {
                    nama: 'Pengguna Anonim',
                    avatarUrl: '',
                }
            };
        }));

        res.status(200).json({ reviews });
    } catch (error) {
        res.status(500).json({ message: 'Failed to get reviews', error: error.message });
    }
};

module.exports = {
    createReview,
    getReviewsForWorker,
};
