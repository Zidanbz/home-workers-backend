const admin = require('firebase-admin');
const db = admin.firestore();
const snap = require('../config/midtrans');
const { sendSuccess, sendError } = require('../utils/responseHelper');

const DEFAULT_BIAYA_SURVEI = 15000;

/**
 * POST /api/orders/with-payment
 * Buat order & langsung inisiasi transaksi Midtrans
 */
const createOrderWithPayment = async (req, res) => {
  const { uid, email, nama } = req.user;
  const { serviceId, jadwalPerbaikan, catatan } = req.body;

  if (!serviceId || !jadwalPerbaikan) {
    return sendError(res, 400, 'Service ID and schedule date are required.');
  }

  try {
    const serviceRef = db.collection('service').doc(serviceId);
    const serviceDoc = await serviceRef.get();

    if (!serviceDoc.exists) {
      return sendError(res, 404, 'Service not found.');
    }

    const serviceData = serviceDoc.data();
    const { workerId, harga, tipeLayanan, statusPersetujuan } = serviceData;

    if (statusPersetujuan !== 'approved') {
      return sendError(res, 403, 'This service is not available for booking.');
    }

    let totalHarga = 0;

    if (tipeLayanan === 'fixed') {
      if (!harga || harga <= 0) {
        return sendError(res, 400, 'Harga tidak valid untuk layanan fixed.');
      }
      totalHarga = harga;
    } else if (tipeLayanan === 'survey') {
      totalHarga = DEFAULT_BIAYA_SURVEI;
    } else {
      return sendError(res, 400, 'Tipe layanan tidak dikenali.');
    }

        const existingOrderSnap = await db.collection('orders')
      .where('workerId', '==', workerId)
      .where('jadwalPerbaikan', '==', new Date(jadwalPerbaikan))
      .where('status', 'in', ['pending', 'accepted', 'work_in_progress'])
      .get();

    if (!existingOrderSnap.empty) {
      return sendError(res, 409, 'Jadwal ini sudah dipesan oleh pelanggan lain. Silakan pilih waktu lain.');
    }

    // Tambahkan order ke Firestore
    const orderRef = await db.collection('orders').add({
      customerId: uid,
      workerId,
      serviceId,
      harga: totalHarga,
      tipeLayanan, // ✅ tambahkan tipe layanan
      status: 'pending',
      jadwalPerbaikan: new Date(jadwalPerbaikan),
      catatan: catatan || '',
      dibuatPada: new Date(),
      hasBeenReviewed: false,
    });

    const orderId = orderRef.id;

    // Buat transaksi Midtrans
    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: totalHarga,
      },
      customer_details: {
        first_name: nama || 'Customer',
        email: email || 'no-email@example.com',
      },
    };

    const transaction = await snap.createTransaction(parameter);
    const transactionToken = transaction.token;

    return sendSuccess(res, 201, 'Order and payment initiated successfully', {
      orderId,
      snapToken: transactionToken,
    });
  } catch (error) {
    console.error("❌ Error createOrderWithPayment:", error);
    return sendError(res, 500, 'Failed to create order and payment: ' + error.message);
  }
};

const getMidtransStatus = async (req, res) => {
  const { orderId } = req.params;

  try {
    const status = await snap.transaction.status(orderId);
    return sendSuccess(res, 200, 'Status transaksi berhasil diambil', status);
  } catch (error) {
    console.error('❌ Gagal ambil status transaksi:', error);
    return sendError(res, 500, 'Gagal ambil status transaksi');
  }
};

module.exports = {
  createOrderWithPayment,
  getMidtransStatus,
};
