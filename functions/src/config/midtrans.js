// config/midtrans.js
const midtransClient = require('midtrans-client');

const snap = new midtransClient.Snap({
  isProduction: false, // true untuk produksi
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

module.exports = snap;
