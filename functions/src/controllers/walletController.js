const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

/**
 * GET /api/wallet/me
 */
const getMyWallet = async (req, res) => {
  const { uid: workerId, role } = req.user;

  if (role !== 'WORKER') {
    return sendError(res, 403, 'Forbidden: Wallets are for workers only.');
  }

  try {
    const walletRef = db.collection('wallets').doc(workerId);
    const transactionsRef = walletRef.collection('transactions').orderBy('timestamp', 'desc');

    const [walletDoc, transactionsSnapshot] = await Promise.all([
      walletRef.get(),
      transactionsRef.get()
    ]);

    const currentBalance = walletDoc.exists ? walletDoc.data().currentBalance || 0 : 0;

    const transactions = transactionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return sendSuccess(res, 200, 'Wallet fetched successfully.', {
      currentBalance,
      transactions
    });
  } catch (error) {
    return sendError(res, 500, 'Failed to get wallet information.', error.message);
  }
};

/**
 * POST /api/wallet/me/withdraw
 */
const requestWithdrawal = async (req, res) => {
  const { uid: workerId, role } = req.user;
  const { amount, destination } = req.body;

  if (role !== 'WORKER') {
    return sendError(res, 403, 'Forbidden: Only workers can withdraw.');
  }

  if (!amount || amount <= 0 || !destination) {
    return sendError(res, 400, 'Amount and destination are required.');
  }

  const walletRef = db.collection('wallets').doc(workerId);

  try {
    await db.runTransaction(async (transaction) => {
      const walletDoc = await transaction.get(walletRef);
      const currentBalance = walletDoc.exists ? walletDoc.data().currentBalance || 0 : 0;

      if (currentBalance < amount) {
        throw new Error('Insufficient balance.');
      }

      const newBalance = currentBalance - amount;

      transaction.set(walletRef, { currentBalance: newBalance }, { merge: true });

      const newTransactionRef = walletRef.collection('transactions').doc();
      transaction.set(newTransactionRef, {
        type: 'cash-out',
        amount,
        description: `Withdrawal to ${destination.type}`,
        destination,
        status: 'pending',
        timestamp: new Date(),
      });
    });

    return sendSuccess(res, 200, 'Withdrawal request submitted successfully.');
  } catch (error) {
    return sendError(res, 500, error.message || 'Failed to submit withdrawal request.');
  }
};

module.exports = {
  getMyWallet,
  requestWithdrawal,
};
