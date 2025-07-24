const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true', // true jika pakai 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendVerificationMail = async (to, link) => {
  const mailOptions = {
    from: `"Home-Workers Support" <${process.env.SMTP_FROM}>`,
    to,
    subject: 'Verifikasi Email Anda',
    html: `
      <h2>Halo!</h2>
      <p>Terima kasih telah mendaftar. Klik tautan berikut untuk verifikasi email Anda:</p>
      <p><a href="${link}" target="_blank">${link}</a></p>
      <p>Jika Anda tidak merasa mendaftar, abaikan email ini.</p>
    `,
  };
  await transporter.sendMail(mailOptions);
};

module.exports = { sendVerificationMail };
