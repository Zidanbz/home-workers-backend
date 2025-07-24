const emailService = require('./emailService'); // ini penting

console.log(emailService); // cek isi module

const { sendVerificationMail } = emailService;

(async () => {
  const testEmail = 'zidanbz03@gmail.com';
  console.log(`📧 Mengirim email tes ke: ${testEmail}`);
  try {
    await sendVerificationMail(testEmail, 'https://example.com/verify');
    console.log('✅ Email berhasil dikirim!');
  } catch (error) {
    console.error('❌ Gagal mengirim email:', error);
  }
})();
