const admin = require('firebase-admin');
const db = admin.firestore();
const { sendSuccess, sendError } = require('../utils/responseHelper');

const createService = async (req, res) => {
  const { uid: workerId, role } = req.user;
  const {
    namaLayanan,
    deskripsiLayanan,
    category,
    tipeLayanan,
    harga,
    biayaSurvei,
    metodePembayaran,
    fotoUtamaUrl,
    photoUrls,
    availability
  } = req.body;

  if (role !== 'WORKER') {
    return sendError(res, 403, 'Forbidden: Only workers can create services.');
  }

  if (!namaLayanan || !category || !tipeLayanan) {
    return sendError(res, 400, 'Nama layanan, kategori, dan tipe layanan wajib diisi.');
  }

  if (typeof availability !== 'object' || Array.isArray(availability)) {
    return sendError(res, 400, 'Availability harus berupa objek hari ke array slot waktu.');
  }

  const serviceData = {
    workerId,
    namaLayanan,
    deskripsiLayanan: deskripsiLayanan || '',
    category,
    tipeLayanan,
    metodePembayaran: Array.isArray(metodePembayaran) && metodePembayaran.length > 0
      ? metodePembayaran
      : ["Cek Dulu", "Cashless"],
    fotoUtamaUrl: fotoUtamaUrl || (photoUrls?.[0] || ''),
    photoUrls: photoUrls || [],
    statusPersetujuan: 'pending',
    dibuatPada: new Date(),
    availability, // simpan langsung object availability dari frontend
  };

  if (tipeLayanan === 'fixed') {
    if (!harga) return sendError(res, 400, 'Harga wajib diisi untuk layanan harga tetap.');
    serviceData.harga = Number(harga);
  } else if (tipeLayanan === 'survey') {
    serviceData.biayaSurvei = Number(biayaSurvei) || 0;
  } else {
    return sendError(res, 400, "Tipe layanan tidak valid. Gunakan 'fixed' atau 'survey'.");
  }

  try {
    const newService = await db.collection('service').add(serviceData);
    return sendSuccess(res, 201, 'Service created successfully and is awaiting approval.', {
      serviceId: newService.id
    });
  } catch (error) {
    return sendError(res, 500, 'Failed to create service.', error.message);
  }
};


const getAllApprovedServices = async (req, res) => {
  try {
    const servicesSnapshot = await db.collection('service')
      .where('statusPersetujuan', '==', 'approved')
      .get();

    if (servicesSnapshot.empty) {
      return sendSuccess(res, 200, 'No approved services found.', []);
    }

    const services = await Promise.all(servicesSnapshot.docs.map(async (doc) => {
      const data = doc.data();
      const userDoc = await db.collection('users').doc(data.workerId).get();
      const workerDoc = await db.collection('workers').doc(data.workerId).get();

      if (userDoc.exists && workerDoc.exists) {
        return {
          serviceId: doc.id,
          ...data,
          workerInfo: {
            nama: userDoc.data().nama,
            rating: workerDoc.data().rating,
          }
        };
      }
      return null;
    }));

    const filtered = services.filter(Boolean);
    return sendSuccess(res, 200, 'Approved services fetched successfully.', filtered);
  } catch (error) {
    return sendError(res, 500, 'Failed to get approved services', error.message);
  }
};

const getMyServices = async (req, res) => {
  const { uid: workerId, role } = req.user;
  if (role !== 'WORKER') {
    return sendError(res, 403, 'Forbidden: Only workers can view their services.');
  }

  try {
    const snapshot = await db.collection('service').where('workerId', '==', workerId).get();
    const services = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return sendSuccess(res, 200, 'My services fetched successfully.', services);
  } catch (error) {
    return sendError(res, 500, 'Failed to get my services', error.message);
  }
};

const getServiceById = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const doc = await db.collection('service').doc(serviceId).get();

    if (!doc.exists) {
      return sendError(res, 404, 'Service not found.');
    }

    const data = doc.data();
    const userDoc = await db.collection('users').doc(data.workerId).get();
    const workerDoc = await db.collection('workers').doc(data.workerId).get();

    const responseData = {
      id: doc.id,
      ...data
    };

    if (userDoc.exists && workerDoc.exists) {
      responseData.workerInfo = {
        id: data.workerId,
        nama: userDoc.data().nama,
        rating: workerDoc.data().rating,
        jumlahOrderSelesai: workerDoc.data().jumlahOrderSelesai,
      };
    }

    return sendSuccess(res, 200, 'Service detail fetched successfully.', responseData);
  } catch (error) {
    return sendError(res, 500, 'Failed to get service details', error.message);
  }
};

const addPhotoToService = async (req, res) => {
  const { uid: workerId } = req.user;
  const { serviceId } = req.params;
  const { photoUrl } = req.body;

  if (!photoUrl) return sendError(res, 400, 'Photo URL is required.');

  try {
    const doc = await db.collection('service').doc(serviceId).get();
    if (!doc.exists) return sendError(res, 404, 'Service not found.');

    if (doc.data().workerId !== workerId) {
      return sendError(res, 403, 'Forbidden: You are not the owner of this service.');
    }

    await doc.ref.update({
      photoUrls: admin.firestore.FieldValue.arrayUnion(photoUrl)
    });

    return sendSuccess(res, 200, 'Photo added successfully.');
  } catch (error) {
    return sendError(res, 500, 'Failed to add photo', error.message);
  }
};

const updateService = async (req, res) => {
  const { uid: workerId } = req.user;
  const { serviceId } = req.params;
  const {
    namaLayanan, deskripsiLayanan, harga, category, metodePembayaran,
    fotoUtamaUrl, tipeLayanan, biayaSurvei, availability
  } = req.body;

  try {
    const doc = await db.collection('service').doc(serviceId).get();
    if (!doc.exists) return sendError(res, 404, 'Service not found.');

    if (doc.data().workerId !== workerId) {
      return sendError(res, 403, 'Forbidden: You are not the owner of this service.');
    }

    const dataToUpdate = {};
    if (namaLayanan) dataToUpdate.namaLayanan = namaLayanan;
    if (deskripsiLayanan) dataToUpdate.deskripsiLayanan = deskripsiLayanan;
    if (category) dataToUpdate.category = category;
    if (metodePembayaran?.length) dataToUpdate.metodePembayaran = metodePembayaran;
    if (fotoUtamaUrl) dataToUpdate.fotoUtamaUrl = fotoUtamaUrl;
    if (availability) dataToUpdate.availability = availability;

    if (tipeLayanan) {
      dataToUpdate.tipeLayanan = tipeLayanan;
      if (tipeLayanan === 'fixed' && harga !== undefined) {
        dataToUpdate.harga = Number(harga);
        dataToUpdate.biayaSurvei = admin.firestore.FieldValue.delete();
      } else if (tipeLayanan === 'survey' && biayaSurvei !== undefined) {
        dataToUpdate.biayaSurvei = Number(biayaSurvei);
        dataToUpdate.harga = admin.firestore.FieldValue.delete();
      }
    } else if (harga !== undefined) {
      dataToUpdate.harga = Number(harga);
    } else if (biayaSurvei !== undefined) {
      dataToUpdate.biayaSurvei = Number(biayaSurvei);
    }

    if (!Object.keys(dataToUpdate).length) {
      return sendError(res, 400, 'No data provided for update.');
    }

    await doc.ref.update(dataToUpdate);
    return sendSuccess(res, 200, 'Service updated successfully.');
  } catch (error) {
    return sendError(res, 500, 'Failed to update service', error.message);
  }
};

const deleteService = async (req, res) => {
  const { uid: workerId, role } = req.user;
  const { serviceId } = req.params;

  if (role !== 'WORKER') {
    return sendError(res, 403, 'Forbidden: Only workers can delete services.');
  }

  try {
    const doc = await db.collection('service').doc(serviceId).get();
    if (!doc.exists) return sendError(res, 404, 'Service not found.');

    if (doc.data().workerId !== workerId) {
      return sendError(res, 403, 'Forbidden: You are not the owner of this service.');
    }

    await doc.ref.delete();
    return sendSuccess(res, 200, 'Service deleted successfully.');
  } catch (error) {
    return sendError(res, 500, 'Failed to delete service', error.message);
  }
};

const getServicesByCategory = async (req, res) => {
  const { categoryName } = req.params;

  if (!categoryName) {
    return sendError(res, 400, 'Category name is required.');
  }

  try {
    const servicesSnapshot = await db.collection('service')
      .where('statusPersetujuan', '==', 'approved')
      .where('category', '==', categoryName)
      .get();

    if (servicesSnapshot.empty) {
      return sendSuccess(res, 200, `No approved services found for category ${categoryName}.`, []);
    }

    const services = await Promise.all(servicesSnapshot.docs.map(async (doc) => {
      const data = doc.data();
      const userDoc = await db.collection('users').doc(data.workerId).get();
      const workerDoc = await db.collection('workers').doc(data.workerId).get();

      if (userDoc.exists && workerDoc.exists) {
        return {
          serviceId: doc.id,
          ...data,
          workerInfo: {
            nama: userDoc.data().nama,
            rating: workerDoc.data().rating,
          }
        };
      }
      return null;
    }));

    const filtered = services.filter(Boolean);
    return sendSuccess(res, 200, `Approved services for category ${categoryName} fetched successfully.`, filtered);
  } catch (error) {
    return sendError(res, 500, 'Failed to get services by category', error.message);
  }
};

/**
 * GET /api/services/search?keyword=...&category=...&tipeLayanan=...&minHarga=...&maxHarga=...
 */
const searchAndFilterServices = async (req, res) => {
  const {
    keyword = '',
    category,
    tipeLayanan,
    minHarga,
    maxHarga
  } = req.query;

  try {
    let query = db.collection('service')
      .where('statusPersetujuan', '==', 'approved');

    // Filter by category
    if (category) {
      query = query.where('category', '==', category);
    }

    // Filter by tipe layanan
    if (tipeLayanan) {
      query = query.where('tipeLayanan', '==', tipeLayanan);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
      return sendSuccess(res, 200, 'No matching services found.', []);
    }

    const services = await Promise.all(snapshot.docs.map(async (doc) => {
      const data = doc.data();

      // Filter by keyword in namaLayanan or deskripsiLayanan
      const keywordLower = keyword.toLowerCase();
      const namaMatch = data.namaLayanan?.toLowerCase().includes(keywordLower);
      const deskripsiMatch = data.deskripsiLayanan?.toLowerCase().includes(keywordLower);
      if (keyword && !namaMatch && !deskripsiMatch) return null;

      // Filter by harga range
      if (minHarga || maxHarga) {
        const harga = data.harga || 0;
        if ((minHarga && harga < Number(minHarga)) || (maxHarga && harga > Number(maxHarga))) {
          return null;
        }
      }

      const userDoc = await db.collection('users').doc(data.workerId).get();
      const workerDoc = await db.collection('workers').doc(data.workerId).get();

      if (userDoc.exists && workerDoc.exists) {
        return {
          serviceId: doc.id,
          ...data,
          workerInfo: {
            nama: userDoc.data().nama,
            rating: workerDoc.data().rating,
          }
        };
      }

      return null;
    }));

    const filtered = services.filter(Boolean);
    return sendSuccess(res, 200, 'Filtered services fetched successfully.', filtered);
  } catch (error) {
    return sendError(res, 500, 'Failed to search and filter services.', error.message);
  }
};

module.exports = {
  createService,
  getAllApprovedServices,
  getMyServices,
  getServiceById,
  addPhotoToService,
  updateService,
  deleteService,
  getServicesByCategory,
  searchAndFilterServices,
};
