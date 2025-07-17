const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

// POST /api/orders
// Customer membuat pesanan baru
const createOrder = async (req, res) => {
    const { uid: customerId } = req.user;
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
        if (serviceData.statusPersetujuan !== 'approved') {
            return sendError(res, 403, 'This service is not available for booking.');
        }

        const { workerId, harga } = serviceData;

        const newOrder = await db.collection('orders').add({
            customerId,
            workerId,
            serviceId,
            harga,
            status: 'pending',
            jadwalPerbaikan: new Date(jadwalPerbaikan),
            catatan: catatan || '',
            dibuatPada: new Date(),
            hasBeenReviewed: false,
        });

        return sendSuccess(res, 201, 'Order created successfully', { orderId: newOrder.id });
    } catch (error) {
        return sendError(res, 500, 'Failed to create order: ' + error.message);
    }
};

const getMyOrders = async (req, res) => {
  const { uid } = req.user;

  try {
    const customerOrdersQuery = db.collection('orders').where('customerId', '==', uid);
    const customerOrdersSnapshot = await customerOrdersQuery.get();
    const customerOrdersPromises = customerOrdersSnapshot.docs.map(enrichOrderData);
    const customerOrders = await Promise.all(customerOrdersPromises);

    const workerOrdersQuery = db.collection('orders').where('workerId', '==', uid);
    const workerOrdersSnapshot = await workerOrdersQuery.get();
    const workerOrdersPromises = workerOrdersSnapshot.docs.map(enrichOrderData);
    const workerOrders = await Promise.all(workerOrdersPromises);

    return sendSuccess(res, 200, 'Orders fetched successfully', {
      asCustomer: customerOrders,
      asWorker: workerOrders
    });
  } catch (error) {
    return sendError(res, 500, 'Failed to get orders: ' + error.message);
  }
};


const acceptOrder = async (req, res) => {
  const { uid: workerId } = req.user;
  const { orderId } = req.params;

  try {
    const orderDocRef = db.collection('orders').doc(orderId);
    const doc = await orderDocRef.get();

    if (!doc.exists) return sendError(res, 404, 'Order not found.');

    const orderData = doc.data();
    if (orderData.workerId !== workerId) return sendError(res, 403, 'Forbidden: You are not assigned to this order.');
    if (orderData.status !== 'pending') return sendError(res, 409, `Cannot accept order with status: ${orderData.status}`);
    if (!orderData.workerAccess || orderData.paymentStatus !== 'paid') {
      return sendError(res, 402, 'Customer belum menyelesaikan pembayaran. Tidak dapat menerima order.');
    }

    await orderDocRef.update({ status: 'accepted' });
    return sendSuccess(res, 200, 'Order accepted successfully');
  } catch (error) {
    return sendError(res, 500, 'Failed to accept order: ' + error.message);
  }
};

const completeOrder = async (req, res) => {
  const { orderId } = req.params;
  const { uid: workerId } = req.user;

  const orderRef = db.collection('orders').doc(orderId);
  const orderDoc = await orderRef.get();

  if (!orderDoc.exists) return sendError(res, 404, 'Order not found');

  const order = orderDoc.data();
  if (order.workerId !== workerId) return sendError(res, 403, 'Not your order');
  if (order.status !== 'work_in_progress') {
    return sendError(res, 400, 'Order must be in progress');
  }

  if (!order.paymentStatus || order.paymentStatus !== 'paid') {
    return sendError(res, 402, 'Order belum dibayar, tidak bisa diselesaikan.');
  }

  const finalPrice = order.finalPrice || order.harga;
  const workerAmount = finalPrice * 0.8;

  const walletRef = db.collection('wallets').doc(workerId);
  const walletDoc = await walletRef.get();
  const currentBalance = walletDoc.exists ? walletDoc.data().currentBalance || 0 : 0;

  const newTransactionRef = walletRef.collection('transactions').doc();

  await Promise.all([
    orderRef.update({
      status: 'completed',
      completedAt: new Date(),
    }),
    walletRef.set({
      currentBalance: currentBalance + workerAmount,
    }, { merge: true }),
    newTransactionRef.set({
      type: 'cash-in',
      amount: workerAmount,
      description: `Pembayaran dari Order #${orderId} (80%)`,
      orderId,
      status: 'success',
      timestamp: new Date(),
    }),
  ]);

  return sendSuccess(res, 200, 'Order completed and payment released.');
};

const cancelOrder = async (req, res) => {
  const { uid: customerId } = req.user;
  const { orderId } = req.params;

  try {
    const orderDocRef = db.collection('orders').doc(orderId);
    const doc = await orderDocRef.get();

    if (!doc.exists) return sendError(res, 404, 'Order not found.');
    if (doc.data().customerId !== customerId) return sendError(res, 403, 'Forbidden: You did not create this order.');
    if (!['pending', 'accepted'].includes(doc.data().status)) return sendError(res, 409, 'Order cannot be cancelled at its current state.');

    await orderDocRef.update({ status: 'cancelled' });
    return sendSuccess(res, 200, 'Order has been cancelled');
  } catch (error) {
    return sendError(res, 500, 'Failed to cancel order: ' + error.message);
  }
};

const getOrderById = async (req, res) => {
  const { uid } = req.user;
  const { orderId } = req.params;

  try {
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      return sendError(res, 404, 'Order not found.');
    }

    const orderData = orderSnap.data();

    // Akses hanya customer / worker terkait
    if (orderData.customerId !== uid && orderData.workerId !== uid) {
      return sendError(res, 403, 'Forbidden: You are not part of this order.');
    }

    // ... (logika untuk worker & pembayaran tidak berubah)
    const isWorkerRequesting = orderData.workerId === uid;
    if (
      isWorkerRequesting &&
      (!orderData.workerAccess || orderData.paymentStatus !== 'paid')
    ) {
      return sendSuccess(res, 200, 'Order locked (awaiting payment).', {
        id: orderSnap.id,
        status: orderData.status,
        // ...
      });
    }

    // ----- ENRICH -----
    const { customerId, workerId, serviceId } = orderData;

    const customerRef = db.collection('users').doc(customerId);
    const workerUserRef = workerId ? db.collection('users').doc(workerId) : null;
    const workerProfileRef = workerId ? db.collection('workers').doc(workerId) : null;
    const serviceRef = serviceId ? db.collection('service').doc(serviceId) : null;
    const customerAddressRef = db.collection('users').doc(customerId).collection('addresses').limit(1);

    const [
      customerSnap,
      workerUserSnap,
      workerProfileSnap,
      serviceSnap,
      customerAddressSnap,
    ] = await Promise.all([
      customerRef.get(),
      workerUserRef ? workerUserRef.get() : Promise.resolve(null),
      workerProfileRef ? workerProfileRef.get() : Promise.resolve(null),
      serviceRef ? serviceRef.get() : Promise.resolve(null),
      customerAddressRef.get(),
    ]);

    // Customer info
    const customerName = customerSnap.exists ? customerSnap.data().nama || 'Customer' : 'Customer';
    const customerAddress = customerAddressSnap.empty
      ? 'Alamat belum diatur'
      : (customerAddressSnap.docs[0].data().fullAddress || 'Alamat belum diatur');

    // --- PERBAIKAN 1: Ambil data 'location' dari alamat customer ---
    const location = customerAddressSnap.empty
      ? null
      : (customerAddressSnap.docs[0].data().location || null);

    // Service info
    let serviceName = 'Layanan Langsung';
    let serviceType = 'lainnya';
    let serviceCategory = 'lainnya';
    let serviceHarga = orderData.harga;

    if (serviceSnap && serviceSnap.exists) {
      const s = serviceSnap.data();
      serviceName = s.namaLayanan ?? serviceName;
      serviceType = s.tipeLayanan ?? serviceType;
      serviceCategory = s.category ?? serviceCategory;
      serviceHarga = s.harga ?? serviceHarga;
    }

    // Worker info (opsional)
    const workerName =
      workerUserSnap && workerUserSnap.exists ? workerUserSnap.data().nama || null : null;
    const workerDescription =
      workerProfileSnap && workerProfileSnap.exists ? workerProfileSnap.data().deskripsi || null : null;

    // Bentuk payload sinkron dengan Order model FE
    const payload = {
      id: orderSnap.id,
      ...orderData,

      // Flatten untuk FE
      customerName,
      customerAddress,
      serviceName,
      serviceType,
      serviceCategory,
      serviceHarga,
      workerName,
      workerDescription,

      // --- PERBAIKAN 2: Tambahkan 'location' ke dalam payload ---
      location,
    };

    return sendSuccess(res, 200, 'Order fetched successfully', payload);
  } catch (error) {
    console.error('getOrderById error:', error);
    return sendError(res, 500, 'Failed to get order details: ' + error.message);
  }
};


async function enrichOrderData(orderDoc) {
  const orderData = orderDoc.data();
  const { customerId, workerId, serviceId } = orderData;

  const [
    customerDoc,
    serviceDoc,
    addressSnapshot,
    workerUserDoc,
    workerProfileDoc
  ] = await Promise.all([
    db.collection('users').doc(customerId).get(),
    serviceId ? db.collection('service').doc(serviceId).get() : Promise.resolve(null),
    db.collection('users').doc(customerId).collection('addresses').limit(1).get(),
    workerId ? db.collection('users').doc(workerId).get() : Promise.resolve(null),
    workerId ? db.collection('workers').doc(workerId).get() : Promise.resolve(null),
  ]);

  const customerAddress = addressSnapshot.empty
    ? 'Alamat belum diatur'
    : addressSnapshot.docs[0].data().fullAddress;

  return {
    id: orderDoc.id,
    ...orderData,
    customerInfo: customerDoc.exists ? {
      nama: customerDoc.data().nama,
      alamat: customerAddress,
    } : {},
    serviceInfo: serviceDoc && serviceDoc.exists ? {
      namaLayanan: serviceDoc.data().namaLayanan,
      category: serviceDoc.data().category
    } : {
      namaLayanan: 'Layanan Langsung',
      category: 'lainnya'
    },
    workerName: workerUserDoc && workerUserDoc.exists ? workerUserDoc.data().nama : null,
    workerDescription: workerProfileDoc && workerProfileDoc.exists ? workerProfileDoc.data().deskripsi : null,
  };
}


const proposeQuote = async (req, res) => {
    const { uid: workerId, role } = req.user;
    const { orderId } = req.params;
    const { price } = req.body;

    if (role !== 'WORKER') return sendError(res, 403, 'Only workers can propose a quote.');
    if (typeof price !== 'number' || price <= 0) return sendError(res, 400, 'A valid price is required.');

    try {
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) return sendError(res, 404, 'Order not found.');
        if (orderDoc.data().workerId !== workerId) return sendError(res, 403, 'Forbidden: You are not assigned to this order.');
        if (orderDoc.data().status !== 'accepted') return sendError(res, 409, `Cannot propose a quote for an order with status '${orderDoc.data().status}'.`);
        if (!orderDoc.data().workerAccess || orderDoc.data().paymentStatus !== 'paid') {
            return sendError(res, 402, 'Order belum dibayar. Tidak bisa kirim penawaran.');
            } 

        await orderRef.update({
            quotedPrice: price,
            status: 'quote_proposed',
            quoteProposedAt: new Date(),
        });

        return sendSuccess(res, 200, 'Quote proposed successfully.');
    } catch (error) {
        return sendError(res, 500, 'Failed to propose quote: ' + error.message);
    }
};

const respondToQuote = async (req, res) => {
    const { uid: customerId, role } = req.user;
    const { orderId } = req.params;
    const { decision } = req.body;

    if (role !== 'CUSTOMER') return sendError(res, 403, 'Only customers can respond to a quote.');
    if (!decision || !['accept', 'reject'].includes(decision)) return sendError(res, 400, "A valid decision ('accept' or 'reject') is required.");

    try {
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) return sendError(res, 404, 'Order not found.');
        const orderData = orderDoc.data();

        if (orderData.customerId !== customerId) return sendError(res, 403, 'You are not the customer for this order.');
        if (orderData.status !== 'quote_proposed') return sendError(res, 409, `Cannot respond to quote with status '${orderData.status}'.`);

        const newStatus = decision === 'accept' ? 'quote_accepted' : 'quote_rejected';
        const dataToUpdate = {
            status: newStatus,
            quoteRespondedAt: new Date()
        };
        if (decision === 'accept') dataToUpdate.finalPrice = orderData.quotedPrice;

        await orderRef.update(dataToUpdate);

        return sendSuccess(res, 200, `Quote has been ${decision}ed successfully.`);
    } catch (error) {
        return sendError(res, 500, 'Failed to respond to quote: ' + error.message);
    }
};

const rejectOrder = async (req, res) => {
    const { uid: workerId } = req.user;
    const { orderId } = req.params;

    try {
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return sendError(res, 404, 'Order not found.');
        }

        const orderData = orderDoc.data();
        if (orderData.workerId !== workerId) {
            return sendError(res, 403, 'Forbidden: You are not assigned to this order.');
        }

        if (orderData.status !== 'pending') {
            return sendError(res, 409, `Cannot reject order with status: ${orderData.status}`);
        }

        await orderRef.update({ status: 'rejected' });

        return sendSuccess(res, 200, 'Order rejected successfully.');
    } catch (error) {
        return sendError(res, 500, 'Failed to reject order: ' + error.message);
    }
};

const getWorkerAvailability = async (req, res) => {
  const { workerId } = req.params;
  const { date } = req.query;

  if (!date) return sendError(res, 400, 'Date is required in query.');

  try {
    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const snapshot = await db.collection('orders')
      .where('workerId', '==', workerId)
      .where('jadwalPerbaikan', '>=', startOfDay)
      .where('jadwalPerbaikan', '<=', endOfDay)
      .where('status', 'in', ['pending', 'accepted', 'quote_proposed', 'work_in_progress']) // status aktif
      .get();

    const bookedTimes = snapshot.docs.map(doc => {
      const data = doc.data();
      return data.jadwalPerbaikan.toDate();
    });

    return sendSuccess(res, 200, 'Booked times retrieved successfully.', bookedTimes);
  } catch (error) {
    return sendError(res, 500, 'Failed to get availability: ' + error.message);
  }
};

const getBookedSlots = async (req, res) => {
  const { workerId, date } = req.query;

  if (!workerId || !date) {
    return sendError(res, 400, 'workerId and date are required');
  }

  try {
    const dateObj = new Date(date);
    const start = new Date(dateObj.setHours(0, 0, 0, 0));
    const end = new Date(dateObj.setHours(23, 59, 59, 999));

    const snapshot = await db.collection('orders')
      .where('workerId', '==', workerId)
      .where('jadwalPerbaikan', '>=', start)
      .where('jadwalPerbaikan', '<=', end)
      .where('status', 'in', ['pending', 'accepted', 'work_in_progress'])
      .get();

    const bookedTimes = snapshot.docs.map(doc => {
      const time = doc.data().jadwalPerbaikan.toDate();
      return `${time.getHours().toString().padStart(2, '0')}.${time.getMinutes().toString().padStart(2, '0')}`;
    });

    return sendSuccess(res, 200, 'Booked time slots fetched', bookedTimes);
  } catch (err) {
    return sendError(res, 500, 'Failed to fetch booked slots: ' + err.message);
  }
};

const createPaymentAfterQuote = async (req, res) => {
  const { orderId } = req.params;
  const { uid: customerId, role } = req.user;

  if (role !== 'CUSTOMER') {
    return sendError(res, 403, 'Only customers can initiate payment.');
  }

  try {
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return sendError(res, 404, 'Order not found');
    }

    const order = orderDoc.data();

    if (order.customerId !== customerId) {
      return sendError(res, 403, 'You are not authorized to pay this order.');
    }

    if (order.status !== 'quote_accepted') {
      return sendError(res, 400, 'You can only pay orders with accepted quote.');
    }

    const snapToken = await createMidtransTransaction({
      orderId: orderId,
      grossAmount: order.finalPrice,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
    });

    await orderRef.update({ snapToken });

    return sendSuccess(res, 200, 'Snap token created successfully.', { snapToken });
  } catch (error) {
    return sendError(res, 500, 'Failed to create Snap token.', error.message);
  }
};

const allowedStatus = ['waiting', 'on_the_way', 'work_in_progress', 'done', 'cancelled', 'rejected', 'paid', 'quote_proposed', 'quote_accepted', 'quote_rejected', 'pending', 'accepted', 'completed'];

const updateOrderStatus = async (req, res) => {
  const { uid: workerId, role } = req.user;
  const orderId = req.params.id;
  const { status } = req.body;

  if (role !== 'WORKER') {
    return sendError(res, 403, 'Hanya worker yang bisa mengubah status order.');
  }

  if (!allowedStatus.includes(status)) {
    return sendError(res, 400, 'Status tidak valid.');
  }

  try {
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      return sendError(res, 404, 'Order tidak ditemukan.');
    }

    const orderData = orderSnap.data();
    if (orderData.workerId !== workerId) {
      return sendError(res, 403, 'Anda tidak memiliki izin untuk mengubah order ini.');
    }

     if (!orderData.workerAccess || orderData.paymentStatus !== 'paid') {
   return sendError(res, 402, 'Order ini belum dibayar. Tidak dapat mengubah status.');
 }

    await orderRef.update({
      status,
      updatedAt: new Date(),
    });

    return sendSuccess(res, 200, `Status order berhasil diubah menjadi ${status}.`);
  } catch (error) {
    return sendError(res, 500, 'Gagal mengubah status order.', error.message);
  }
};

module.exports = {
    createOrder,
    getMyOrders,
    acceptOrder,
    completeOrder,
    cancelOrder,
    getOrderById,
    enrichOrderData,
    proposeQuote,
    respondToQuote,
    rejectOrder,
    getWorkerAvailability,
    getBookedSlots,
    createPaymentAfterQuote,
    updateOrderStatus,
};
