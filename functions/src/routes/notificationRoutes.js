const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const db = admin.firestore();
const snap = require('../config/midtrans');

// Webhook handler
router.post('/notification', async (req, res) => {
  try {
    console.log('📥 Incoming Webhook:', req.body);

    const notificationJson = req.body;

    if (!notificationJson.order_id) {
      console.error('❌ order_id missing in webhook');
      return res.status(200).json({ message: 'Missing order_id, notification received' });
    }

    const midtransOrderId = notificationJson.order_id;
    const firestoreOrderId = notificationJson.order_id; // 🟢 Tanpa split


    console.log('🔍 Received order_id from webhook:', midtransOrderId);
    console.log('📂 Mapped to Firestore order ID:', firestoreOrderId);

    // Ambil status transaksi dari Midtrans
    const statusResponse = await snap.transaction.status(midtransOrderId);
    console.log('✅ Midtrans Status Response:', statusResponse);

    const { transaction_status } = statusResponse;

    if (transaction_status === 'settlement') {
      await db.collection('orders').doc(firestoreOrderId).update({
        status: 'paid',
      });
      console.log(`✅ Order ${firestoreOrderId} marked as paid`);
    } else if (transaction_status === 'expire' || transaction_status === 'cancel') {
      await db.collection('orders').doc(firestoreOrderId).update({
        status: 'failed', // atau 'cancelled' sesuai kebutuhanmu
      });
      console.log(`❌ Order ${firestoreOrderId} marked as failed/cancelled`);
    } else {
      console.log(`ℹ️ Order ${firestoreOrderId} status: ${transaction_status}`);
    }

    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(200).json({ message: 'Webhook received but handler failed internally', error: error.message });
  }
});

module.exports = router;