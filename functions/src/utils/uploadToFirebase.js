// utils/uploadToFirebase.js
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

const bucket = admin.storage().bucket('home-workers-fa5cd.appspot.com'); // Sesuai nama asli bucket


const uploadToFirebase = async (fileBuffer, originalName, folder = 'ktp') => {
    const fileName = `ktp_uploads/${Date.now()}_${originalName}`;
  const file = bucket.file(fileName);

  await file.save(fileBuffer, {
    metadata: {
      contentType: 'image/jpeg', // atau ambil dari req.file.mimetype
      metadata: {
        firebaseStorageDownloadTokens: uuidv4(),
      },
    },
    public: true,
  });

  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/home-workers-fa5cd.appspot.com/o/${encodeURIComponent(fileName)}?alt=media`;

  return publicUrl;
};

module.exports = uploadToFirebase;
