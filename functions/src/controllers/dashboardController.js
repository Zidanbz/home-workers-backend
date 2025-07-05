const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

/**
 * GET /api/dashboard/customer-summary
 * Mengambil data ringkasan untuk dasbor customer (Kategori & Best Performers).
 */
const getCustomerDashboardSummary = async (req, res) => {
  try {
    // --- Bagian 1: Mengambil Best Performers ---
    const workersQuery = db.collection('workers').orderBy('rating', 'desc').limit(5);
    const workersSnapshot = await workersQuery.get();

    const performersPromises = workersSnapshot.docs.map(async (workerDoc) => {
      const workerData = workerDoc.data();
      const userId = workerDoc.id;

      const userDoc = await db.collection('users').doc(userId).get();

      if (userDoc.exists) {
        const userData = userDoc.data();
        return {
          id: userId,
          nama: userData.nama,
          avatarUrl: userData.avatarUrl || '',
          rating: workerData.rating || 0,
        };
      }
      return null;
    });

    const bestPerformers = (await Promise.all(performersPromises)).filter(p => p !== null);

    // --- Bagian 2: Mengambil Kategori Teratas ---
    const topCategories = [
      { name: 'Kebersihan', icon: 'cleaning_services', workerCount: '+490 Pekerja' },
      { name: 'Perbaikan & Konstruksi', icon: 'build', workerCount: '+4190 Pekerja' },
      { name: 'Perawatan & Pemeliharaan', icon: 'health_and_safety', workerCount: '+230 Pekerja' },
    ];

    return sendSuccess(res, 200, 'Dashboard summary retrieved successfully', {
      topCategories,
      bestPerformers,
    });

  } catch (error) {
    console.error("Error fetching customer dashboard summary:", error);
    return sendError(res, 500, 'Failed to get dashboard summary', error.message);
  }
};

module.exports = {
  getCustomerDashboardSummary,
};
