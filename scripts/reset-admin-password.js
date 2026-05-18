require('dotenv').config();

const bcrypt = require('bcryptjs');
const db = require('../config/db');

async function resetAdminPassword() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || '1234';

  if (password.length < 4) {
    throw new Error('Password must be at least 4 characters long.');
  }

  const hash = await bcrypt.hash(password, 10);

  await db.query(
    `INSERT INTO users (username, password, full_name, role)
     VALUES (?, ?, ?, 'admin')
     ON DUPLICATE KEY UPDATE password = VALUES(password), role = 'admin'`,
    [username, hash, username === 'admin' ? 'المدير' : username]
  );

  console.log(`Password reset for user "${username}".`);
}

if (require.main === module) {
  resetAdminPassword()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.end();
    });
}

module.exports = { resetAdminPassword };
