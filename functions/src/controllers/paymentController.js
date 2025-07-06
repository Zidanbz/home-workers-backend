const midtransClient = require('midtrans-client');
const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

// Inisialisasi Snap API dari Midtrans
const snap = new midtransClient.Snap({
    isProduction: false, // Set ke true saat sudah live
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY // Ambil dari dasbor Midtrans
});

/**
 * POST /api/payments/initiate
 * Membuat transaksi di Midtrans dan mendapatkan token untuk frontend.
 */
const initiatePayment = async (req, res) => {
    const { uid: customerId, nama: customerName, email: customerEmail } = req.user;
    const { orderId } = req.body;

    if (!orderId) {
        return sendError(res, 400, 'Order ID is required.');
    }

    try {
        // Ambil detail order dari Firestore untuk mendapatkan harga
        const orderDoc = await db.collection('orders').doc(orderId).get();
        if (!orderDoc.exists) {
            return sendError(res, 404, 'Order not found.');
        }

        const orderData = orderDoc.data();
        const amount = orderData.finalPrice || orderData.harga || 0;

        if (amount <= 0) {
            return sendError(res, 400, 'Order has no valid price.');
        }

        // Siapkan parameter untuk Midtrans
        const parameter = {
            "transaction_details": {
                "order_id": orderId,
                "gross_amount": amount
            },
            "customer_details": {
                "first_name": customerName,
                "email": customerEmail,
            }
        };

        // Buat transaksi di Midtrans untuk mendapatkan token
        const transaction = await snap.createTransaction(parameter);
        const transactionToken = transaction.token;

        sendSuccess(res, 200, 'Transaction token created successfully.', {
            token: transactionToken
        });

    } catch (error) {
        console.error("Midtrans API error:", error);
        sendError(res, 500, error.message || 'Failed to initiate payment.');
    }
};

module.exports = {
    initiatePayment,
};