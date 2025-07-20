const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

/**
 * GET /api/vouchers
 * Ambil semua voucher aktif (global & user-claimed milik user)
 */
const getAvailableVouchers = async (req, res) => {
  const { uid } = req.user;

  try {
    const globalSnap = await db.collection('vouchers')
      .where('type', '==', 'global')
      .where('status', '==', 'active')
      .get();

    const globalVouchers = globalSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    const userSnap = await db.collection('user_vouchers')
      .where('userId', '==', uid)
      .where('used', '==', false)
      .get();

    const userVouchers = userSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    return sendSuccess(res, 200, 'Vouchers fetched successfully', {
      global: globalVouchers,
      user: userVouchers,
    });
  } catch (error) {
    return sendError(res, 500, 'Failed to fetch vouchers', error.message);
  }
};

/**
 * POST /api/vouchers/create
 * Buat voucher baru (ADMIN ONLY)
 */
const createVoucher = async (req, res) => {
  const { role } = req.user;
  const {
    code, type, discountType, value,
    maxDiscount, minOrder, startDate, endDate, status = 'active'
  } = req.body;

  if (role !== 'ADMIN') {
    return sendError(res, 403, 'Forbidden: Only admins can create vouchers.');
  }

  if (!code || !type || !discountType || !value) {
    return sendError(res, 400, 'Code, type, discountType, and value are required.');
  }

  try {
    const voucherRef = db.collection('vouchers').doc(code);
    const voucherDoc = await voucherRef.get();

    if (voucherDoc.exists) {
      return sendError(res, 409, 'Voucher code already exists.');
    }

    await voucherRef.set({
      type,              // 'global' or 'user_claimed'
      discountType,      // 'percent' or 'nominal'
      value,             // angka diskon
      maxDiscount: maxDiscount || null,
      minOrder: minOrder || 0,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      status,            // 'active' atau 'inactive'
      createdAt: new Date(),
    });

    return sendSuccess(res, 201, 'Voucher created successfully');
  } catch (error) {
    return sendError(res, 500, 'Failed to create voucher', error.message);
  }
};

/**
 * POST /api/vouchers/claim
 * Klaim voucher oleh user
 */
const claimVoucher = async (req, res) => {
  const { uid } = req.user;
  const { voucherCode } = req.body;

  if (!voucherCode) return sendError(res, 400, 'Voucher code is required');

  try {
    const voucherRef = db.collection('vouchers').doc(voucherCode);
    const voucherDoc = await voucherRef.get();

    if (!voucherDoc.exists) return sendError(res, 404, 'Voucher not found');

    const voucher = voucherDoc.data();
    if (voucher.status !== 'active') return sendError(res, 400, 'Voucher is not active');
    if (voucher.type !== 'user_claimed') return sendError(res, 400, 'This voucher cannot be claimed manually');

    const claimedSnap = await db.collection('user_vouchers')
      .where('userId', '==', uid)
      .where('voucherCode', '==', voucherCode)
      .get();

    if (!claimedSnap.empty) return sendError(res, 409, 'Voucher already claimed');

    await db.collection('user_vouchers').add({
      userId: uid,
      voucherCode,
      claimedAt: new Date(),
      used: false,
    });

    return sendSuccess(res, 200, 'Voucher claimed successfully');
  } catch (error) {
    return sendError(res, 500, 'Failed to claim voucher', error.message);
  }
};

/**
 * Helper: Validasi voucher untuk paymentController
 */
const validateVoucherCode = async (userId, voucherCode, orderAmount) => {
  if (!voucherCode) return { isValid: false, message: 'Voucher code required' };

  try {
    const voucherRef = db.collection('vouchers').doc(voucherCode);
    const voucherDoc = await voucherRef.get();

    if (!voucherDoc.exists) return { isValid: false, message: 'Voucher not found' };

    const voucher = voucherDoc.data();
    const now = new Date();

    if (voucher.status !== 'active') return { isValid: false, message: 'Voucher not active' };
    if (voucher.startDate && now < new Date(voucher.startDate)) return { isValid: false, message: 'Voucher not yet valid' };
    if (voucher.endDate && now > new Date(voucher.endDate)) return { isValid: false, message: 'Voucher expired' };
    if (voucher.minOrder && orderAmount < voucher.minOrder) return { isValid: false, message: `Minimal order Rp ${voucher.minOrder}` };

    if (voucher.type === 'user_claimed') {
      const userVoucherSnap = await db.collection('user_vouchers')
        .where('userId', '==', userId)
        .where('voucherCode', '==', voucherCode)
        .where('used', '==', false)
        .get();

      if (userVoucherSnap.empty) return { isValid: false, message: 'You have not claimed this voucher or already used' };
    }

    let discount = 0;
    if (voucher.discountType === 'percent') {
      discount = (orderAmount * voucher.value) / 100;
      if (voucher.maxDiscount) discount = Math.min(discount, voucher.maxDiscount);
    } else if (voucher.discountType === 'nominal') {
      discount = voucher.value;
    }

    return {
      isValid: true,
      discount,
      voucherCode,
      message: 'Voucher valid',
    };
  } catch (error) {
    return { isValid: false, message: error.message };
  }
};

const validateVoucherPublic = async (req, res) => {
  const { uid } = req.user;           // dari authMiddleware
  const { voucherCode, orderAmount } = req.body;

  if (!voucherCode || typeof orderAmount !== 'number') {
    return sendError(res, 400, 'voucherCode dan orderAmount wajib diisi.');
  }

  try {
    const result = await validateVoucherCode(uid, voucherCode, orderAmount);
    if (!result.isValid) {
      return sendError(res, 400, result.message);
    }
    return sendSuccess(res, 200, 'Voucher valid.', {
      voucherCode: result.voucherCode,
      discount: Math.round(result.discount),
      finalTotal: Math.max(0, orderAmount - Math.round(result.discount)),
      message: result.message,
    });
  } catch (e) {
    return sendError(res, 500, 'Gagal validasi voucher', e.message);
  }
};

module.exports = {
  getAvailableVouchers,
  createVoucher,      // khusus admin
  claimVoucher,
  validateVoucherCode, // helper untuk payment
  validateVoucherPublic,
};
