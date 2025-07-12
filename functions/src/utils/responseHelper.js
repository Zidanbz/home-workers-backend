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
  const sendError = (res, statusCode, message, error = null) => {
    if (error) console.error("SEND ERROR:", error);
    return res.status(statusCode).json({
      message,
      error: error?.message || error?.toString?.() || null,
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