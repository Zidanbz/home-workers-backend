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
  const sendError = (res, statusCode, message, errors = null) => {
    res.status(statusCode).json({
      success: false,
      message,
      errors,
      data: null,
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