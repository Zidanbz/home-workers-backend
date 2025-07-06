// middlewares/uploadMiddleware.js
const multer = require('multer');

// Gunakan memory storage agar bisa langsung dikirim ke Firebase Storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // maksimal 5MB
  },
});

module.exports = upload;
