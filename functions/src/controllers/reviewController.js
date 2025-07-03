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

module.exports = {
    createReview,
};