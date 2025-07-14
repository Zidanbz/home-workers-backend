const { error } = require("firebase-functions/logger");

/**
 * Mengirim respons sukses yang terstruktur.
 * @param {object} res - Objek respons Express.
 * @param {number} statusCode - Kode status HTTP (e.g., 200, 201).
 * @param {string} message - Pesan untuk frontend.
 * @param {object|array|null} data - Payload data.
 */
const sendSuccess = (res, statusCode, message, data = null) => {
    res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  };
  
  /**
   * Mengirim respons error yang terstruktur.
   * @param {object} res - Objek respons Express.
   * @param {number} statusCode - Kode status HTTP (e.g., 400, 404, 500).
   * @param {string} message - Pesan error untuk frontend.
   */
/**
 * Mengirim respons error yang terstruktur dan mendetail.
 * @param {object} res - Objek respons Express.
 * @param {number} statusCode - Kode status HTTP.
 * @param {string} message - Pesan error umum untuk frontend.
 * @param {Error|object|null} error - Objek error (optional).
 */
const sendError = (res, statusCode, message, error = null) => {
  const isDev = process.env.NODE_ENV !== 'production';

  let detailedError = null;

  if (error) {
    detailedError = {
      name: error.name || 'Error',
      message: error.message || error.toString(),
      code: error.code || null,
      stack: isDev ? error.stack : undefined,
    };

    // Log ke console saat development
    if (isDev) {
      console.error('SEND ERROR:', detailedError);
    } else {
      console.error('SEND ERROR:', error.message);
    }
  }

  return res.status(statusCode).json({
    success: false,
    message,
    error: detailedError,
  });
};


  const tryCatch = (controllerFn) => {
    return (req, res, next) => {
      Promise.resolve(controllerFn(req, res, next)).catch(next);
    };
  };
  
  module.exports = {
    sendSuccess,
    sendError,
    tryCatch,
  };