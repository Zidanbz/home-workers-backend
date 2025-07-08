const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

const bucket = admin.storage().bucket('home-workers-fa5cd.appspot.com'); // Nama bucket harus .appspot.com

const uploadToFirebase = async (fileBuffer, originalName, folder = 'ktp') => {
  const fileName = `${folder}/${Date.now()}_${originalName}`;
  const file = bucket.file(fileName);

  const downloadToken = uuidv4(); // Buat token untuk akses file secara publik

  await file.save(fileBuffer, {
    metadata: {
      contentType: 'image/jpeg', // Sesuaikan dengan req.file.mimetype jika perlu
      metadata: {
        firebaseStorageDownloadTokens: downloadToken, // Ini penting
      },
    },
    public: true,
  });

  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/home-workers-fa5cd.appspot.com/o/${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;

  return publicUrl;
};

module.exports = uploadToFirebase;
