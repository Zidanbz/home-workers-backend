const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

/**
 * GET /api/dashboard/customer-summary
 * Mengambil data ringkasan untuk dasbor customer (Kategori & Best Performers).
 */
const getCustomerDashboardSummary = async (req, res) => {
  try {
    const db = req.app.get('db');

    // --- Best Performers: berdasarkan rating worker ---
    const workersSnapshot = await db.collection('workers')
      .orderBy('rating', 'desc')
      .limit(5)
      .get();

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

    const bestPerformers = (await Promise.all(performersPromises)).filter(Boolean);

    // --- Kategori tetap & jumlah layanan (service) di setiap kategori ---
    const categoryList = [
      { name: 'Kebersihan', icon: 'cleaning_services' },
      { name: 'Perbaikan', icon: 'handyman' },
      { name: 'Instalasi', icon: 'download' },
      { name: 'Renovasi', icon: 'home_repair_service' },
      { name: 'Elektronik', icon: 'electrical_services' },
      { name: 'Otomotif', icon: 'directions_car' },
      { name: 'Perawatan Taman', icon: 'local_florist' },
      { name: 'Pembangunan', icon: 'construction' },
      { name: 'Gadget', icon: 'phone_android' },
    ];

    const topCategories = await Promise.all(
      categoryList.map(async ({ name, icon }) => {
        const serviceSnapshot = await db.collection('service')
          .where('category', '==', name)
          .get();

        return {
          name,
          icon,
          serviceCount: `+${serviceSnapshot.size} Layanan`,
        };
      })
    );

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
