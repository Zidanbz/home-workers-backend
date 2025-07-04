const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * GET /api/wallet/me
 * Mengambil informasi wallet (saldo & transaksi) untuk worker yang login.
 */
const getMyWallet = async (req, res) => {
    const { uid: workerId, role } = req.user;

    if (role !== 'WORKER') {
        return res.status(403).json({ message: 'Forbidden: Wallets are for workers only.' });
    }

    try {
        const walletRef = db.collection('wallets').doc(workerId);
        const transactionsRef = walletRef.collection('transactions').orderBy('timestamp', 'desc');

        const [walletDoc, transactionsSnapshot] = await Promise.all([
            walletRef.get(),
            transactionsRef.get()
        ]);

        let currentBalance = 0;
        if (walletDoc.exists) {
            currentBalance = walletDoc.data().currentBalance || 0;
        }

        const transactions = transactionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        res.status(200).json({
            currentBalance: currentBalance,
            transactions: transactions,
        });

    } catch (error) {
        res.status(500).json({ message: 'Failed to get wallet information.', error: error.message });
    }
};

/**
 * POST /api/wallet/me/withdraw
 * Worker mengajukan permintaan penarikan dana (withdraw).
 */
const requestWithdrawal = async (req, res) => {
    const { uid: workerId, role } = req.user;
    const { amount, destination } = req.body; // Cth: destination = { type: 'DANA', account: '08123...' }

    if (role !== 'WORKER') {
        return res.status(403).json({ message: 'Forbidden: Only workers can withdraw.' });
    }
    if (!amount || amount <= 0 || !destination) {
        return res.status(400).json({ message: 'Amount and destination are required.' });
    }

    const walletRef = db.collection('wallets').doc(workerId);

    try {
        // Gunakan transaksi untuk memastikan konsistensi data
        await db.runTransaction(async (transaction) => {
            const walletDoc = await transaction.get(walletRef);
            
            const currentBalance = walletDoc.exists ? walletDoc.data().currentBalance : 0;

            if (currentBalance < amount) {
                throw new Error('Insufficient balance.'); // Error ini akan ditangkap oleh block catch
            }

            // Kurangi saldo saat ini
            const newBalance = currentBalance - amount;
            transaction.set(walletRef, { currentBalance: newBalance }, { merge: true });

            // Buat catatan transaksi pengeluaran dengan status 'pending'
            const newTransactionRef = walletRef.collection('transactions').doc();
            transaction.set(newTransactionRef, {
                type: 'cash-out',
                amount: amount,
                description: `Withdrawal to ${destination.type}`,
                destination: destination,
                status: 'pending', // Menunggu approval admin
                timestamp: new Date(),
            });
        });

        res.status(200).json({ message: 'Withdrawal request submitted successfully.' });

    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to submit withdrawal request.' });
    }
};

module.exports = {
    getMyWallet,
    requestWithdrawal,
};