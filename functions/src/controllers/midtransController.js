const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

const handleMidtransCallback = async (req, res) => {
  const notificationJson = req.body;
  const orderId = notificationJson.order_id;
  const transactionStatus = notificationJson.transaction_status;

  try {
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return sendError(res, 404, 'Order not found.');
    }

    const orderData = orderDoc.data();

    // Jika pembayaran berhasil
    if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
      const totalAmount = orderData.harga;
      const workerAmount = Math.floor(totalAmount * 0.8);
      const workerId = orderData.workerId;

      const walletRef = db.collection('wallets').doc(workerId);

      await db.runTransaction(async (transaction) => {
        const walletDoc = await transaction.get(walletRef);
        const currentBalance = walletDoc.exists ? walletDoc.data().currentBalance || 0 : 0;
        const newBalance = currentBalance + workerAmount;

        transaction.set(walletRef, { currentBalance: newBalance }, { merge: true });

        const newTransactionRef = walletRef.collection('transactions').doc();
        transaction.set(newTransactionRef, {
          type: 'cash-in',
          amount: workerAmount,
          description: `Pembayaran order #${orderId}`,
          status: 'completed',
          timestamp: new Date(),
        });

        transaction.update(orderRef, { status: 'paid' });
      });

      return sendSuccess(res, 200, 'Pembayaran berhasil dan saldo worker diperbarui.');
    } else {
      return sendSuccess(res, 200, `Status transaksi "${transactionStatus}" diterima tanpa aksi.`);
    }
  } catch (error) {
    return sendError(res, 500, 'Gagal memproses callback Midtrans.', error);
  }
};

module.exports = {
  handleMidtransCallback,
};
