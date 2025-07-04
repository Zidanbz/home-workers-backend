// src/controllers/reviewController.js

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * POST /api/orders/:orderId/review
 * Customer membuat review untuk sebuah order yang sudah selesai.
 */
const createReview = async (req, res) => {
    const { uid: customerId } = req.user; // ID Customer dari token
    const { orderId } = req.params;      // ID Order dari URL
    const { rating, comment } = req.body; // Rating & comment dari body

    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Rating must be a number between 1 and 5." });
    }

    try {
        // Kita gunakan transaksi untuk memastikan semua update terjadi atau tidak sama sekali.
        await db.runTransaction(async (transaction) => {
            const orderRef = db.collection('orders').doc(orderId);
            const orderDoc = await transaction.get(orderRef);

            // --- Validasi ---
            if (!orderDoc.exists) {
                throw new Error("Order not found."); // Error ini akan ditangkap oleh block catch
            }

            const orderData = orderDoc.data();
            if (orderData.customerId !== customerId) {
                throw new Error("Forbidden: You are not the customer for this order.");
            }
            if (orderData.status !== 'completed') {
                throw new Error("Cannot review an order that is not completed.");
            }
            if (orderData.hasBeenReviewed) {
                throw new Error("This order has already been reviewed.");
            }

            const workerId = orderData.workerId;
            const workerRef = db.collection('workers').doc(workerId);
            const workerDoc = await transaction.get(workerRef);

            if (!workerDoc.exists) {
                throw new Error("Worker profile not found.");
            }
            
            // --- Kalkulasi Rating Baru ---
            const workerData = workerDoc.data();
            const oldRating = workerData.rating || 0;
            const oldOrderCount = workerData.jumlahOrderSelesai || 0;
            
            const newOrderCount = oldOrderCount + 1;
            // Rumus rata-rata bergerak: ((rata2_lama * jumlah_lama) + rating_baru) / jumlah_baru
            const newAverageRating = ((oldRating * oldOrderCount) + rating) / newOrderCount;

            // --- Operasi Tulis dalam Transaksi ---
            // 1. Buat dokumen review baru
            const reviewRef = db.collection('reviews').doc(); // Firestore akan generate ID
            transaction.set(reviewRef, {
                orderId: orderId,
                workerId: workerId,
                customerId: customerId,
                rating: rating,
                comment: comment || '',
                createdAt: new Date(),
            });

            // 2. Update profil worker dengan rating baru dan jumlah order
            transaction.update(workerRef, {
                rating: newAverageRating,
                jumlahOrderSelesai: newOrderCount,
            });

            // 3. Tandai order ini sudah direview untuk mencegah review ganda
            transaction.update(orderRef, { hasBeenReviewed: true });
        });

        res.status(201).json({ message: "Review submitted successfully." });

    } catch (error) {
        // Kirim error dari transaksi atau error lainnya
        res.status(409).json({ message: error.message || "Failed to submit review." });
    }
};

/**
 * GET /api/reviews/for-worker/me
 * Mengambil semua review untuk worker yang sedang login.
 */
const getReviewsForWorker = async (req, res) => {
    const { uid: workerId, role } = req.user;

    if (role !== 'WORKER') {
        return res.status(403).json({ message: 'Forbidden: Only workers can view their reviews.' });
    }

    try {
        // Ambil semua review yang ditujukan untuk worker ini
        const reviewsQuery = db.collection('reviews').where('workerId', '==', workerId).orderBy('createdAt', 'desc');
        const snapshot = await reviewsQuery.get();

        if (snapshot.empty) {
            return res.status(200).json([]);
        }

        // "Perkaya" data review dengan informasi customer
        const promises = snapshot.docs.map(async (doc) => {
            const reviewData = doc.data();
            const customerId = reviewData.customerId;

            const customerDoc = await db.collection('users').doc(customerId).get();
            
            return {
                id: doc.id,
                ...reviewData,
                customerInfo: customerDoc.exists ? {
                    nama: customerDoc.data().nama,
                    avatarUrl: customerDoc.data().avatarUrl || '',
                } : {
                    nama: 'Pengguna Anonim',
                    avatarUrl: '',
                }
            };
        });

        const populatedReviews = await Promise.all(promises);
        res.status(200).json(populatedReviews);

    } catch (error) {
        res.status(500).json({ message: 'Failed to get reviews', error: error.message });
    }
};

module.exports = {
    createReview,
    getReviewsForWorker,
};