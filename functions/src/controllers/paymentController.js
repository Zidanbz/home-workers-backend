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
    return sendError(res, 400, 'Service ID dan jadwal perbaikan wajib diisi.');
  }

  try {
    const serviceRef = db.collection('service').doc(serviceId);
    const serviceDoc = await serviceRef.get();
    if (!serviceDoc.exists) return sendError(res, 404, 'Service tidak ditemukan.');

    const serviceData = serviceDoc.data();
    const { workerId, harga, tipeLayanan, statusPersetujuan } = serviceData;

    if (statusPersetujuan !== 'approved') {
      return sendError(res, 403, 'Layanan belum disetujui admin.');
    }

    let totalHarga = 0;
    if (tipeLayanan === 'fixed') {
      if (!harga || harga <= 0) return sendError(res, 400, 'Harga layanan tidak valid.');
      totalHarga = harga;
    } else if (tipeLayanan === 'survey') {
      totalHarga = DEFAULT_BIAYA_SURVEI;
    } else {
      return sendError(res, 400, 'Tipe layanan tidak dikenali.');
    }

    // ✅ Cek bentrok jadwal
    const existingOrderSnap = await db.collection('orders')
      .where('workerId', '==', workerId)
      .where('jadwalPerbaikan', '==', new Date(jadwalPerbaikan))
      .where('status', 'in', ['pending', 'accepted', 'work_in_progress'])
      .get();

    if (!existingOrderSnap.empty) {
      return sendError(res, 409, 'Jadwal ini sudah dipesan oleh pelanggan lain.');
    }

    // ✅ Simpan order
    const orderRef = await db.collection('orders').add({
      customerId: uid,
      workerId,
      serviceId,
      harga: totalHarga,
      tipeLayanan,
      paymentStatus: 'unpaid',
      workerAccess: false,
      status: 'awaiting_payment',
      jadwalPerbaikan: new Date(jadwalPerbaikan),
      catatan: catatan || '',
      dibuatPada: new Date(),
      hasBeenReviewed: false,
    });

    const orderId = orderRef.id;

    // ✅ Generate token Midtrans
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

    return sendSuccess(res, 201, 'Order dibuat & pembayaran dimulai', {
      orderId,
      snapToken: transaction.token,
    });
  } catch (error) {
    console.error("❌ Error createOrderWithPayment:", error);
    return sendError(res, 500, 'Gagal membuat order: ' + error.message);
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

/**
 * POST /api/payments/start/:orderId
 * Inisiasi pembayaran untuk order dengan status quote_accepted
 */
const startPaymentForQuote = async (req, res) => {
  const { uid, email, nama } = req.user;
  const { orderId } = req.params;

  try {
    // Ambil order dari Firestore
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return sendError(res, 404, 'Order tidak ditemukan.');
    }

    const orderData = orderDoc.data();

    // Validasi customer
    if (orderData.customerId !== uid) {
      return sendError(res, 403, 'Anda tidak berhak melakukan pembayaran untuk order ini.');
    }

    // Validasi status
    if (orderData.status !== 'quote_accepted') {
      return sendError(res, 409, `Order harus berstatus quote_accepted, sekarang: ${orderData.status}.`);
    }

    // Validasi finalPrice
    if (!orderData.finalPrice || orderData.finalPrice <= 0) {
      return sendError(res, 400, 'Harga final belum ditentukan.');
    }

    // Jika sudah dibayar, jangan buat transaksi baru
    if (orderData.paymentStatus === 'paid') {
      return sendSuccess(res, 200, 'Order ini sudah dibayar.');
    }

    // Buat transaksi Midtrans
    const parameter = {
      transaction_details: {
        order_id: `quote_${orderId}`, // Tambahkan prefix agar unik
        gross_amount: orderData.finalPrice,
      },
      customer_details: {
        first_name: nama || 'Customer',
        email: email || 'no-email@example.com',
      },
    };

    const transaction = await snap.createTransaction(parameter);
    const transactionToken = transaction.token;

    return sendSuccess(res, 200, 'Token pembayaran berhasil dibuat.', {
      orderId,
      snapToken: transactionToken,
      amount: orderData.finalPrice,
    });
  } catch (error) {
    console.error('❌ Error startPaymentForQuote:', error);
    return sendError(res, 500, 'Gagal memulai pembayaran: ' + error.message);
  }
};


module.exports = {
  createOrderWithPayment,
  getMidtransStatus,
  startPaymentForQuote,
};
