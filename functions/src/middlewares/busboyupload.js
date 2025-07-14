// src/middlewares/busboyupload.js (Diperbarui untuk Multi-file)

const Busboy = require('busboy');

function parseFormData(req, res, next) {
  if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
    return next();
  }
  if (!Buffer.isBuffer(req.body)) {
    return next();
  }

  const busboy = Busboy({ headers: req.headers });
  const fields = {};
  const files = {}; // ✅ Tampung semua file dalam objek ini
  const filePromises = []; // Tampung semua proses file agar bisa ditunggu

  busboy.on('field', (fieldname, val) => {
    fields[fieldname] = val;
  });

  busboy.on('file', (fieldname, file, info) => {
    const { filename, encoding, mimetype } = info;
    
    // ✅ Buat promise untuk setiap file agar bisa ditunggu
    const promise = new Promise((resolve, reject) => {
      const chunks = [];
      file.on('data', (data) => chunks.push(data));
      file.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // Simpan file ke objek files dengan key dari nama field-nya
        files[fieldname] = {
          fieldname,
          originalname: filename,
          encoding,
          mimetype,
          buffer,
          size: buffer.length
        };
        resolve();
      });
      file.on('error', reject);
    });
    filePromises.push(promise);
  });

  busboy.on('finish', async () => {
    try {
      // ✅ Tunggu semua file selesai diproses sebelum melanjutkan
      await Promise.all(filePromises); 
      req.body = fields;
      req.files = files; // ✅ Attach objek files ke request
      next();
    } catch(err) {
      next(err);
    }
  });
  
  busboy.on('error', next);
  busboy.end(req.body);
}

module.exports = parseFormData;