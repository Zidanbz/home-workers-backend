const admin = require('firebase-admin');
const db = admin.firestore();


/**
 * POST /api/users/me/avatar
 * Memperbarui URL foto profil untuk pengguna yang sedang login.
 */
const updateAvatar = async (req, res) => {
    const { uid } = req.user;
    const { avatarUrl } = req.body;

    if (!avatarUrl) {
        return res.status(400).json({ message: 'Avatar URL is required.' });
    }

    try {
        const userDocRef = db.collection('users').doc(uid);
        await userDocRef.update({
            avatarUrl: avatarUrl
        });
        res.status(200).json({ message: 'Avatar updated successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update avatar', error: error.message });
    }
};

/**
 * POST /api/users/me/addresses
 * Menambahkan alamat baru untuk pengguna yang sedang login.
 */
const addAddress = async (req, res) => {
    const { uid } = req.user;
    const { label, fullAddress, latitude, longitude } = req.body;

    if (!label || !fullAddress) {
        return res.status(400).json({ message: 'Label and full address are required.' });
    }

    try {
        // Alamat disimpan di subcollection di bawah dokumen user
        const newAddress = await db.collection('users').doc(uid).collection('addresses').add({
            label: label,
            fullAddress: fullAddress,
            location: new admin.firestore.GeoPoint(latitude || 0, longitude || 0),
            createdAt: new Date(),
        });

        res.status(201).json({ message: 'Address added successfully', addressId: newAddress.id });
    } catch (error) {
        res.status(500).json({ message: 'Failed to add address', error: error.message });
    }
};

/**
 * GET /api/users/me/addresses
 * Mengambil semua alamat yang disimpan oleh pengguna yang sedang login.
 */
const getAddresses = async (req, res) => {
    const { uid } = req.user;

    try {
        const addressesSnapshot = await db.collection('users').doc(uid).collection('addresses').get();
        
        const addresses = addressesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.status(200).json(addresses);
    } catch (error) {
        res.status(500).json({ message: 'Failed to get addresses', error: error.message });
    }
};

/**
 * POST /api/users/me/documents
 * Menyimpan URL dokumen KTP dan Portofolio untuk worker.
 */
const uploadDocuments = async (req, res) => {
    const { uid, role } = req.user;
    const { ktpUrl, portfolioUrl } = req.body;

    // Security Check: Fitur ini hanya untuk worker
    if (role !== 'WORKER') {
        return res.status(403).json({ message: 'Forbidden: This feature is for workers only.' });
    }

    if (!ktpUrl && !portfolioUrl) {
        return res.status(400).json({ message: 'At least one document URL is required.' });
    }

    try {
        const workerDocRef = db.collection('workers').doc(uid);

        // Siapkan data yang akan di-update
        const documentsData = {};
        if (ktpUrl) documentsData.ktpUrl = ktpUrl;
        if (portfolioUrl) documentsData.portfolioUrl = portfolioUrl;
        
        // Update dokumen worker dengan data baru
        await workerDocRef.update(documentsData);

        res.status(200).json({ message: 'Documents uploaded successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to upload documents', error: error.message });
    }
};

/**
 * PUT /api/users/me
 * Memperbarui data umum pengguna (seperti nama) di koleksi 'users'.
 */
const updateMyProfile = async (req, res) => {
    const { uid } = req.user;
    // Ambil data yang boleh diubah dari body
    const { nama, contact, gender } = req.body;

    try {
        const userDocRef = db.collection('users').doc(uid);

        // Siapkan objek data yang akan diupdate agar tidak menimpa field lain
        const dataToUpdate = {};
        if (nama) dataToUpdate.nama = nama;
        if (contact) dataToUpdate.contact = contact;
        if (gender) dataToUpdate.gender = gender;

        // Jika tidak ada data yang dikirim, tidak perlu update
        if (Object.keys(dataToUpdate).length === 0) {
            return res.status(400).json({ message: "No data provided for update." });
        }

        await userDocRef.update(dataToUpdate);

        res.status(200).json({ message: 'Profile updated successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update profile', error: error.message });
    }
};

module.exports = {
    updateAvatar,
    addAddress,
    getAddresses,
    uploadDocuments,
    updateMyProfile,
};
