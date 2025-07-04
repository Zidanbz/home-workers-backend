const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * POST /api/services
 * Worker membuat daftar layanan baru dengan detail lengkap.
 */
const createService = async (req, res) => {
    const { uid: workerId, role } = req.user;
    const { 
        namaLayanan, deskripsiLayanan, category, 
        tipeLayanan, // 'fixed' atau 'survey'
        harga, // Harga untuk tipe 'fixed'
        biayaSurvei, // Biaya untuk tipe 'survey'
        metodePembayaran, fotoUtamaUrl 
    } = req.body;

    if (role !== 'WORKER') {
        return res.status(403).json({ message: 'Forbidden: Only workers can create services.' });
    }

    if (!namaLayanan || !category || !tipeLayanan) {
        return res.status(400).json({ message: 'Nama layanan, kategori, dan tipe layanan wajib diisi.' });
    }

    // Siapkan data untuk disimpan
    const serviceData = {
        workerId: workerId,
        namaLayanan: namaLayanan,
        deskripsiLayanan: deskripsiLayanan || '',
        category: category,
        tipeLayanan: tipeLayanan,
        metodePembayaran: Array.isArray(metodePembayaran) && metodePembayaran.length > 0 
            ? metodePembayaran 
            : ["Cash", "Cashless"],
        fotoUtamaUrl: fotoUtamaUrl || '',
        photoUrls: [],
        statusPersetujuan: 'pending',
        dibuatPada: new Date(),
    };

    // Tambahkan harga atau biaya survei berdasarkan tipenya
    if (tipeLayanan === 'fixed') {
        if (!harga) return res.status(400).json({ message: 'Harga wajib diisi untuk layanan harga tetap.' });
        serviceData.harga = Number(harga);
    } else if (tipeLayanan === 'survey') {
        serviceData.biayaSurvei = Number(biayaSurvei) || 0; // Biaya survei bisa 0 (gratis)
    } else {
        return res.status(400).json({ message: "Tipe layanan tidak valid. Gunakan 'fixed' atau 'survey'." });
    }

    try {
        const newService = await db.collection('services').add(serviceData);
        res.status(201).json({ message: 'Service created successfully and is awaiting approval.', serviceId: newService.id });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create service.', error: error.message });
    }
};

/**
 * GET /api/services
 * Mengambil daftar semua layanan yang telah disetujui (approved) untuk marketplace.
 */
const getAllApprovedServices = async (req, res) => {
    try {
        // Langkah 1: Buat query untuk mengambil layanan yang statusnya 'approved'
        const servicesQuery = db.collection('service').where('statusPersetujuan', '==', 'approved');
        const servicesSnapshot = await servicesQuery.get();
        console.log(`Query menemukan ${servicesSnapshot.size} layanan yang 'approved'.`);
        if (servicesSnapshot.empty) {
            return res.status(200).json([]); // Kembalikan array kosong jika tidak ada layanan
        }

        // Langkah 2: Gabungkan dengan data worker untuk setiap layanan
        const promises = servicesSnapshot.docs.map(async (serviceDoc) => {
            const serviceData = serviceDoc.data();
            const workerId = serviceData.workerId;

            // Ambil data dari koleksi 'users' (untuk nama) dan 'workers' (untuk rating)
            const userDoc = await db.collection('users').doc(workerId).get();
            const workerDoc = await db.collection('workers').doc(workerId).get();

            // Gabungkan hanya jika data user dan worker ada
            if (userDoc.exists && workerDoc.exists) {
                const userData = userDoc.data();
                const workerData = workerDoc.data();

                return {
                    serviceId: serviceDoc.id,
                    ...serviceData,
                    workerInfo: {
                        nama: userData.nama,
                        rating: workerData.rating,
                    }
                };
            }
            return null;
        });
        
        // Langkah 3: Jalankan semua promise dan filter data yang tidak lengkap
        const combinedServices = (await Promise.all(promises)).filter(s => s !== null);

        res.status(200).json(combinedServices);
    } catch (error) {
        res.status(500).json({ message: 'Failed to get approved services', error: error.message });
    }
};
const getMyServices = async (req, res) => {
    const { uid: workerId, role } = req.user; // Ambil UID dan role dari token

    // Security Check: Pastikan hanya worker yang bisa mengakses
    if (role !== 'WORKER') {
        return res.status(403).json({ message: 'Forbidden: Only workers can view their services.' });
    }

    try {
        const servicesQuery = db.collection('service').where('workerId', '==', workerId);
        const servicesSnapshot = await servicesQuery.get();

        if (servicesSnapshot.empty) {
            return res.status(200).json([]); // Kembalikan array kosong jika worker belum punya layanan
        }

        const myServices = servicesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.status(200).json(myServices);
    } catch (error) {
        res.status(500).json({ message: 'Failed to get my services', error: error.message });
    }
};

/**
 * GET /api/services/:serviceId
 * Mengambil detail lengkap dari satu layanan spesifik. (Publik)
 */
const getServiceById = async (req, res) => {
    try {
        const { serviceId } = req.params;
        const serviceRef = db.collection('services').doc(serviceId);
        const serviceDoc = await serviceRef.get();

        if (!serviceDoc.exists) {
            return res.status(404).json({ message: 'Service not found.' });
        }

        const serviceData = serviceDoc.data();
        const workerId = serviceData.workerId;

        // Ambil data worker untuk digabungkan
        const userDoc = await db.collection('users').doc(workerId).get();
        const workerDoc = await db.collection('workers').doc(workerId).get();

        if (!userDoc.exists || !workerDoc.exists) {
            // Jika data worker tidak lengkap, tetap tampilkan data layanan
            return res.status(200).json({ id: serviceDoc.id, ...serviceData });
        }

        const userData = userDoc.data();
        const workerData = workerDoc.data();

        // Gabungkan semua data menjadi satu respons yang lengkap
        const combinedData = {
            id: serviceDoc.id,
            ...serviceData,
            workerInfo: {
                id: workerId,
                nama: userData.nama,
                // Anda bisa tambahkan foto profil worker di sini jika ada
                rating: workerData.rating,
                jumlahOrderSelesai: workerData.jumlahOrderSelesai,
            }
        };

        res.status(200).json(combinedData);
    } catch (error) {
        res.status(500).json({ message: 'Failed to get service details', error: error.message });
    }
};

/**
 * POST /api/services/:serviceId/photos
 * Worker menambahkan URL foto baru ke galeri layanannya.
 */
const addPhotoToService = async (req, res) => {
    const { uid: workerId } = req.user;
    const { serviceId } = req.params;
    const { photoUrl } = req.body;

    if (!photoUrl) {
        return res.status(400).json({ message: 'Photo URL is required.' });
    }

    try {
        const serviceRef = db.collection('services').doc(serviceId);
        const serviceDoc = await serviceRef.get();

        if (!serviceDoc.exists) {
            return res.status(404).json({ message: 'Service not found.' });
        }

        // Security Check: Pastikan yang mengedit adalah pemilik layanan
        if (serviceDoc.data().workerId !== workerId) {
            return res.status(403).json({ message: 'Forbidden: You are not the owner of this service.' });
        }

        // Tambahkan URL baru ke array 'photoUrls'.
        // FieldValue.arrayUnion memastikan tidak ada URL duplikat.
        await serviceRef.update({
            photoUrls: admin.firestore.FieldValue.arrayUnion(photoUrl)
        });

        res.status(200).json({ message: 'Photo added successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to add photo', error: error.message });
    }
};

/**
 * PUT /api/services/:serviceId
 * Worker memperbarui detail layanannya yang sudah ada.
 */
const updateService = async (req, res) => {
    const { uid: workerId } = req.user;
    const { serviceId } = req.params;
    const { namaLayanan, deskripsiLayanan, harga, category, metodePembayaran, fotoUtamaUrl, tipeLayanan, biayaSurvei } = req.body;

    try {
        const serviceRef = db.collection('services').doc(serviceId);
        const serviceDoc = await serviceRef.get();

        if (!serviceDoc.exists) {
            return res.status(404).json({ message: 'Service not found.' });
        }

        if (serviceDoc.data().workerId !== workerId) {
            return res.status(403).json({ message: 'Forbidden: You are not the owner of this service.' });
        }

        const dataToUpdate = {};
        if (namaLayanan) dataToUpdate.namaLayanan = namaLayanan;
        if (deskripsiLayanan) dataToUpdate.deskripsiLayanan = deskripsiLayanan;
        if (category) dataToUpdate.category = category;
        if (metodePembayaran && Array.isArray(metodePembayaran)) dataToUpdate.metodePembayaran = metodePembayaran;
        if (fotoUtamaUrl) dataToUpdate.fotoUtamaUrl = fotoUtamaUrl;
        
        // Logika update untuk harga berdasarkan tipe
        if (tipeLayanan) {
            dataToUpdate.tipeLayanan = tipeLayanan;
            if (tipeLayanan === 'fixed' && harga !== undefined) {
                dataToUpdate.harga = Number(harga);
                dataToUpdate.biayaSurvei = admin.firestore.FieldValue.delete(); // Hapus biaya survei jika ada
            } else if (tipeLayanan === 'survey' && biayaSurvei !== undefined) {
                dataToUpdate.biayaSurvei = Number(biayaSurvei);
                dataToUpdate.harga = admin.firestore.FieldValue.delete(); // Hapus harga jika ada
            }
        }

        if (Object.keys(dataToUpdate).length === 0) {
            return res.status(400).json({ message: "No data provided for update." });
        }

        await serviceRef.update(dataToUpdate);
        res.status(200).json({ message: 'Service updated successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update service', error: error.message });
    }
};

/**
 * DELETE /api/services/:serviceId
 * Worker menghapus layanannya sendiri.
 */
const deleteService = async (req, res) => {
    const { uid: workerId, role } = req.user;
    const { serviceId } = req.params;

    if (role !== 'WORKER') {
        return res.status(403).json({ message: 'Forbidden: Only workers can delete services.' });
    }

    try {
        const serviceRef = db.collection('services').doc(serviceId);
        const serviceDoc = await serviceRef.get();

        if (!serviceDoc.exists) {
            return res.status(404).json({ message: 'Service not found.' });
        }

        // Security Check: Pastikan yang menghapus adalah pemilik layanan
        if (serviceDoc.data().workerId !== workerId) {
            return res.status(403).json({ message: 'Forbidden: You are not the owner of this service.' });
        }

        // Hapus dokumen layanan dari Firestore
        await serviceRef.delete();

        // TODO (Untuk Masa Depan): Tambahkan logika untuk menghapus foto-foto terkait
        // dari Firebase Cloud Storage untuk menghemat ruang penyimpanan.

        res.status(200).json({ message: 'Service deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete service', error: error.message });
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
};