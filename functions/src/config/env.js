require('dotenv').config();
const functions = require('firebase-functions');

module.exports = {
  APP_FIREBASE_WEB_API_KEY: process.env.APP_FIREBASE_WEB_API_KEY || functions.config().app?.firebase_web_api_key,
  MIDTRANS_CLIENT_KEY: process.env.MIDTRANS_CLIENT_KEY || functions.config().midtrans?.client_key,
  MIDTRANS_SERVER_KEY: process.env.MIDTRANS_SERVER_KEY || functions.config().midtrans?.server_key,
  EMAIL_VERIFY_REDIRECT_URL: process.env.EMAIL_VERIFY_REDIRECT_URL || functions.config().email?.verify_redirect_url,
  SMTP_HOST: process.env.SMTP_HOST || functions.config().smtp?.host,
  SMTP_PORT: process.env.SMTP_PORT || functions.config().smtp?.port,
  SMTP_USER: process.env.SMTP_USER || functions.config().smtp?.user,
  SMTP_PASS: process.env.SMTP_PASS || functions.config().smtp?.pass,
  SMTP_FROM: process.env.SMTP_FROM || functions.config().smtp?.from,
};
