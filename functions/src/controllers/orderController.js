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

        await orderDocRef.update({ status: 'accepted' });
        return sendSuccess(res, 200, 'Order accepted successfully');
    } catch (error) {
        return sendError(res, 500, 'Failed to accept order: ' + error.message);
    }
};

const completeOrder = async (req, res) => {
    const { uid: workerId } = req.user;
    const { orderId } = req.params;

    const orderRef = db.collection('orders').doc(orderId);
    const walletRef = db.collection('wallets').doc(workerId);

    try {
        await db.runTransaction(async (transaction) => {
            const orderDoc = await transaction.get(orderRef);
            if (!orderDoc.exists) throw new Error('Order not found.');

            const orderData = orderDoc.data();
            if (orderData.workerId !== workerId) throw new Error('Forbidden: You are not assigned to this order.');
            if (orderData.status !== 'work_in_progress') throw new Error(`Cannot complete order with status: ${orderData.status}`);

            const finalPrice = orderData.finalPrice || orderData.harga || 0;
            if (finalPrice <= 0) throw new Error('Order has no price and cannot be completed.');

            transaction.set(walletRef, { currentBalance: admin.firestore.FieldValue.increment(finalPrice) }, { merge: true });

            const newTransactionRef = walletRef.collection('transactions').doc();
            transaction.set(newTransactionRef, {
                type: 'cash-in',
                amount: finalPrice,
                description: `From order #${orderId.substring(0, 6)}`,
                status: 'confirmed',
                timestamp: new Date(),
            });

            transaction.update(orderRef, { status: 'completed' });
        });

        return sendSuccess(res, 200, 'Order marked as completed and payment processed.');
    } catch (error) {
        return sendError(res, 500, error.message);
    }
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
        const orderDoc = await db.collection('orders').doc(orderId).get();

        if (!orderDoc.exists) return sendError(res, 404, 'Order not found.');

        const orderData = orderDoc.data();
        if (orderData.customerId !== uid && orderData.workerId !== uid) return sendError(res, 403, 'Forbidden: You are not part of this order.');

        return sendSuccess(res, 200, 'Order fetched successfully', { id: orderDoc.id, ...orderData });
    } catch (error) {
        return sendError(res, 500, 'Failed to get order details: ' + error.message);
    }
};

async function enrichOrderData(orderDoc) {
    const orderData = orderDoc.data();
    const { customerId, workerId, serviceId } = orderData;

    const [customerDoc, serviceDoc] = await Promise.all([
        db.collection('users').doc(customerId).get(),
        serviceId ? db.collection('service').doc(serviceId).get() : Promise.resolve(null)
    ]);

    const addressSnapshot = await db.collection('users').doc(customerId).collection('addresses').limit(1).get();
    const customerAddress = addressSnapshot.empty ? 'Alamat belum diatur' : addressSnapshot.docs[0].data().fullAddress;

    return {
        id: orderDoc.id,
        ...orderData,
        customerInfo: customerDoc.exists ? {
            nama: customerDoc.data().nama,
            alamat: customerAddress,
        } : {},
        serviceInfo: serviceDoc && serviceDoc.exists ? {
            namaLayanan: serviceDoc.data().namaLayanan
        } : {
            namaLayanan: 'Layanan Langsung'
        }
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

        const newStatus = decision === 'accept' ? 'work_in_progress' : 'quote_rejected';
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
