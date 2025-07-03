const admin = require('firebase-admin');
const db = admin.firestore();

// POST /api/orders
// Customer membuat pesanan baru
/**
 * POST /api/orders
 * Customer membuat pesanan baru berdasarkan sebuah Service ID.
 * MODIFIED VERSION
 */
const createOrder = async (req, res) => {
    const { uid: customerId } = req.user;
    const { serviceId, jadwalPerbaikan, catatan } = req.body;

    // --- INI BAGIAN YANG DIPERBAIKI ---
    // Sekarang memeriksa serviceId, bukan workerId lagi.
    if (!serviceId || !jadwalPerbaikan) {
        return res.status(400).json({ message: 'Service ID and schedule date are required.' });
    }
    // ------------------------------------

    try {
        const serviceRef = db.collection('service').doc(serviceId);
        const serviceDoc = await serviceRef.get();

        if (!serviceDoc.exists) {
            return res.status(404).json({ message: 'Service not found.' });
        }

        const serviceData = serviceDoc.data();
        if (serviceData.statusPersetujuan !== 'approved') {
            return res.status(403).json({ message: 'This service is not available for booking.' });
        }

        const { workerId, harga } = serviceData;

        const newOrder = await db.collection('orders').add({
            customerId: customerId,
            workerId: workerId,
            serviceId: serviceId,
            harga: harga,
            status: 'pending',
            jadwalPerbaikan: new Date(jadwalPerbaikan),
            catatan: catatan || '',
            dibuatPada: new Date(),
            hasBeenReviewed: false,
        });

        res.status(201).json({ message: 'Order created successfully', orderId: newOrder.id });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create order', error: error.message });
    }
};

/**
 * GET /api/orders/my-orders
 * Mengambil daftar order milik pengguna (sebagai customer atau worker).
 */
const getMyOrders = async (req, res) => {
    const { uid } = req.user;

    try {
        // Ambil pesanan di mana saya adalah customer
        const customerOrdersQuery = db.collection('orders').where('customerId', '==', uid);
        const customerOrdersSnapshot = await customerOrdersQuery.get();
        const customerOrdersPromises = customerOrdersSnapshot.docs.map(enrichOrderData);
        const customerOrders = await Promise.all(customerOrdersPromises);

        // Ambil pesanan di mana saya adalah worker
        const workerOrdersQuery = db.collection('orders').where('workerId', '==', uid);
        const workerOrdersSnapshot = await workerOrdersQuery.get();
        const workerOrdersPromises = workerOrdersSnapshot.docs.map(enrichOrderData);
        const workerOrders = await Promise.all(workerOrdersPromises);

        res.status(200).json({ asCustomer: customerOrders, asWorker: workerOrders });
    } catch (error) {
        console.error("Error fetching my orders:", error);
        res.status(500).json({ message: 'Failed to get orders', error: error.message });
    }
};

// PUT /api/orders/:orderId/accept
// Worker menerima sebuah order
const acceptOrder = async (req, res) => {
    const { uid: workerId } = req.user;
    const { orderId } = req.params; // Mengambil ID order dari URL

    try {
        const orderDocRef = db.collection('orders').doc(orderId);
        const doc = await orderDocRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        const orderData = doc.data();
        
        // Security Check: Pastikan yang mau accept adalah worker yang ditugaskan
        if (orderData.workerId !== workerId) {
            return res.status(403).json({ message: 'Forbidden: You are not assigned to this order.' });
        }
        
        // Cek apakah statusnya masih 'pending'
        if (orderData.status !== 'pending') {
            return res.status(409).json({ message: `Cannot accept order with status: ${orderData.status}` });
        }

        await orderDocRef.update({ status: 'accepted' });

        res.status(200).json({ message: 'Order accepted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to accept order', error: error.message });
    }
};

const completeOrder = async (req, res) => {
    const { uid: workerId } = req.user;
    const { orderId } = req.params;

    try {
        const orderDocRef = db.collection('orders').doc(orderId);
        const doc = await orderDocRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        // Security Check: Hanya worker yang ditugaskan yang bisa menyelesaikan order
        if (doc.data().workerId !== workerId) {
            return res.status(403).json({ message: 'Forbidden: You are not assigned to this order.' });
        }

        await orderDocRef.update({ status: 'completed' });
        res.status(200).json({ message: 'Order marked as completed' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to complete order', error: error.message });
    }
};

/**
 * PUT /api/orders/:orderId/cancel
 * Customer membatalkan sebuah order.
 */
const cancelOrder = async (req, res) => {
    const { uid: customerId } = req.user;
    const { orderId } = req.params;

    try {
        const orderDocRef = db.collection('orders').doc(orderId);
        const doc = await orderDocRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        // Security Check: Hanya customer pembuat order yang bisa membatalkan
        if (doc.data().customerId !== customerId) {
            return res.status(403).json({ message: 'Forbidden: You did not create this order.' });
        }
        
        // Aturan bisnis: Order hanya bisa dibatalkan jika statusnya masih 'pending' atau 'accepted'
        if (!['pending', 'accepted'].includes(doc.data().status)) {
            return res.status(409).json({ message: 'Order cannot be cancelled at its current state.' });
        }

        await orderDocRef.update({ status: 'cancelled' });
        res.status(200).json({ message: 'Order has been cancelled' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to cancel order', error: error.message });
    }
};

const getOrderById = async (req, res) => {
    const { uid } = req.user;
    const { orderId } = req.params;

    try {
        const orderDoc = await db.collection('orders').doc(orderId).get();

        if (!orderDoc.exists) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        const orderData = orderDoc.data();

        // Security Check: Pastikan yang mengakses adalah customer atau worker dari order tsb
        if (orderData.customerId !== uid && orderData.workerId !== uid) {
            return res.status(403).json({ message: 'Forbidden: You are not part of this order.' });
        }

        res.status(200).json({ id: orderDoc.id, ...orderData });
    } catch (error) {
        res.status(500).json({ message: 'Failed to get order details', error: error.message });
    }
};

/**
 * Helper function untuk "memperkaya" data order dengan info tambahan.
 * @param {FirebaseFirestore.DocumentSnapshot} orderDoc Dokumen order.
 * @returns {Promise<object>} Objek order yang sudah lengkap.
 */
async function enrichOrderData(orderDoc) {
    const orderData = orderDoc.data();
    const { customerId, workerId, serviceId } = orderData;

    // Ambil dokumen terkait secara paralel untuk efisiensi
    const [customerDoc, serviceDoc] = await Promise.all([
        db.collection('users').doc(customerId).get(),
        // Hanya ambil service jika serviceId ada
        serviceId ? db.collection('service').doc(serviceId).get() : Promise.resolve(null)
    ]);

    // Ambil alamat dari subcollection customer
    const addressSnapshot = await db.collection('users').doc(customerId).collection('addresses').limit(1).get();
    const customerAddress = addressSnapshot.empty ? 'Alamat belum diatur' : addressSnapshot.docs[0].data().fullAddress;

    return {
        id: orderDoc.id,
        ...orderData,
        // Gabungkan info yang dibutuhkan oleh frontend
        customerInfo: customerDoc.exists ? { 
            nama: customerDoc.data().nama,
            alamat: customerAddress,
        } : {},
        serviceInfo: serviceDoc && serviceDoc.exists ? { 
            namaLayanan: serviceDoc.data().namaLayanan 
        } : {
            namaLayanan: 'Layanan Langsung' // Fallback jika tidak ada serviceId
        }
    };
}

/**
 * POST /api/orders/:orderId/quote
 * Worker mengajukan penawaran harga untuk sebuah order survei.
 */
const proposeQuote = async (req, res) => {
    const { uid: workerId, role } = req.user;
    const { orderId } = req.params;
    const { price } = req.body;

    if (role !== 'WORKER') {
        return res.status(403).json({ message: 'Forbidden: Only workers can propose a quote.' });
    }

    if (typeof price !== 'number' || price <= 0) {
        return res.status(400).json({ message: 'A valid price is required.' });
    }

    try {
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        const orderData = orderDoc.data();

        if (orderData.workerId !== workerId) {
            return res.status(403).json({ message: 'Forbidden: You are not assigned to this order.' });
        }

        if (orderData.status !== 'accepted') {
            return res.status(409).json({ message: `Cannot propose a quote for an order with status '${orderData.status}'.` });
        }

        await orderRef.update({
            quotedPrice: price,
            status: 'quote_proposed',
            quoteProposedAt: new Date(),
        });

        res.status(200).json({ message: 'Quote proposed successfully.' });

    } catch (error) {
        res.status(500).json({ message: 'Failed to propose quote', error: error.message });
    }
};


// --- FUNGSI BARU DIMULAI DI SINI ---

/**
 * PUT /api/orders/:orderId/quote/respond
 * Customer menyetujui atau menolak penawaran harga dari worker.
 */
const respondToQuote = async (req, res) => {
    const { uid: customerId, role } = req.user;
    const { orderId } = req.params;
    const { decision } = req.body; // 'accept' atau 'reject'

    if (role !== 'CUSTOMER') {
        return res.status(403).json({ message: 'Forbidden: Only customers can respond to a quote.' });
    }

    if (!decision || !['accept', 'reject'].includes(decision)) {
        return res.status(400).json({ message: "A valid decision ('accept' or 'reject') is required." });
    }

    try {
        const orderRef = db.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        const orderData = orderDoc.data();

        if (orderData.customerId !== customerId) {
            return res.status(403).json({ message: 'Forbidden: You are not the customer for this order.' });
        }

        if (orderData.status !== 'quote_proposed') {
            return res.status(409).json({ message: `Cannot respond to a quote for an order with status '${orderData.status}'.` });
        }

        let newStatus = '';
        const dataToUpdate = {};

        if (decision === 'accept') {
            newStatus = 'work_in_progress';
            // Set harga final saat penawaran disetujui
            dataToUpdate.finalPrice = orderData.quotedPrice;
        } else { // decision === 'reject'
            newStatus = 'quote_rejected';
        }
        
        dataToUpdate.status = newStatus;
        dataToUpdate.quoteRespondedAt = new Date();

        await orderRef.update(dataToUpdate);

        res.status(200).json({ message: `Quote has been ${decision}ed successfully.` });

    } catch (error) {
        res.status(500).json({ message: 'Failed to respond to quote', error: error.message });
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
};