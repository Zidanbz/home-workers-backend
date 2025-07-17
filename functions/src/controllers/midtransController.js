const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

/**
 * Midtrans Notification Handler
 * Menangani 2 tipe pembayaran:
 * 1. Pembayaran awal (order_id = <orderId>) → fixed price ATAU survey fee.
 * 2. Pembayaran final quote (order_id = quote_<orderId>).
 *
 * PENTING:
 * - Tidak ada pencairan saldo ke worker di sini.
 * - Saldo cair di completeOrder() setelah pekerjaan selesai.
 */
const handleMidtransCallback = async (req, res) => {
  console.log('📥 Midtrans callback received:', JSON.stringify(req.body));

  const { order_id: fullOrderId, transaction_status: transactionStatus, fraud_status: fraudStatus } = req.body;

  if (!fullOrderId) {
    return sendError(res, 400, 'Order ID tidak ditemukan di callback.');
  }

  // Deteksi Quote Payment
  let orderId = fullOrderId;
  let isQuotePayment = false;
  if (fullOrderId.startsWith('quote_')) {
    orderId = fullOrderId.replace('quote_', '');
    isQuotePayment = true;
  }

  console.log('🔍 Parsed orderId:', orderId, '| Quote Payment:', isQuotePayment);

  try {
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      console.log(`❌ Order not found for ID: ${orderId}`);
      return sendError(res, 404, `Order not found for ID: ${orderId}`);
    }
    const orderData = orderDoc.data();

    // Idempotensi: jika callback awal datang lagi
    if (!isQuotePayment && orderData.paymentStatus === 'paid') {
      return sendSuccess(res, 200, 'Pembayaran awal sudah diproses sebelumnya.');
    }
    // Idempotensi final quote (kalau sudah dibayar)
    if (isQuotePayment && orderData.finalPaymentStatus === 'paid') {
      return sendSuccess(res, 200, 'Pembayaran final sudah diproses sebelumnya.');
    }

    // Fraud check simple
    if (fraudStatus === 'challenge') {
      console.warn('⚠️ Fraud challenge pada Midtrans untuk order:', orderId);
      // bisa log khusus, jangan ubah status dulu
      return sendSuccess(res, 200, 'Fraud challenge diterima, menunggu verifikasi manual.');
    }

    // SUCCESS (settlement / capture)
    if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
      if (isQuotePayment) {
        // Pembayaran FINAL setelah quote
        await orderRef.update({
          finalPaymentStatus: 'paid',
          finalPaidAt: new Date(),
        });
        console.log('✅ Final payment settled (quote) for order:', orderId);
        return sendSuccess(res, 200, 'Pembayaran final berhasil (quote).');
      } else {
        // Pembayaran awal
        const nextStatus = orderData.status === 'awaiting_payment' ? 'pending' : orderData.status;
        await orderRef.update({
          paymentStatus: 'paid',
          workerAccess: true,
          status: nextStatus,
          paidAt: new Date(),
        });
        console.log('✅ Initial payment settled for order:', orderId);
        return sendSuccess(res, 200, 'Pembayaran awal berhasil.');
      }
    }

    // FAILURE/EXPIRED/CANCELLED
    if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
      if (isQuotePayment) {
        await orderRef.update({ finalPaymentStatus: 'failed' });
      } else {
        await orderRef.update({
          paymentStatus: 'failed',
          status: 'cancelled',
          workerAccess: false,
        });
      }
      console.log(`❌ Payment ${transactionStatus} for order: ${orderId}`);
      return sendSuccess(res, 200, `Status ${transactionStatus} diterapkan.`);
    }

    // PENDING / others
    if (transactionStatus === 'pending') {
      console.log(`⏳ Payment pending for order: ${orderId}`);
      return sendSuccess(res, 200, 'Pembayaran pending.');
    }

    // Default fallback
    console.log(`ℹ️ Callback received (${transactionStatus}) for order: ${orderId}`);
    return sendSuccess(res, 200, `Callback (${transactionStatus}) diterima.`);
  } catch (error) {
    console.error('🔥 Error Midtrans Callback:', error);
    return sendError(res, 500, 'Gagal memproses callback Midtrans.', error.message);
  }
};

module.exports = {
  handleMidtransCallback,
};
