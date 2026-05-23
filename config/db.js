const mysql = require('mysql2/promise');
require('dotenv').config();

function readEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

const isProduction = process.env.NODE_ENV === 'production';
const missingRequiredEnv = ['DB_HOST', 'DB_USER', 'DB_NAME'].filter((name) => !readEnv(name));

if (isProduction && missingRequiredEnv.length) {
  console.error(`❌ Missing database environment variables: ${missingRequiredEnv.join(', ')}`);
}

const dbConfig = {
  host: readEnv('DB_HOST', isProduction ? '' : 'localhost'),
  port: Number(readEnv('DB_PORT', '3306')),
  user: readEnv('DB_USER', isProduction ? '' : 'root'),
  password: readEnv('DB_PASSWORD'),
  database: readEnv('DB_NAME', isProduction ? '' : 'cashier_db'),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
};

if (readEnv('DB_SSL').toLowerCase() === 'true') {
  dbConfig.ssl = { rejectUnauthorized: false };
}

const pool = mysql.createPool({
  ...dbConfig,
});

console.log(`ℹ️ Database target: ${dbConfig.host || '<missing-host>'}:${dbConfig.port} / ${dbConfig.database || '<missing-db>'}`);

pool.getConnection()
  .then(conn => { console.log('✅ Database connected'); conn.release(); })
  .catch(err => console.error('❌ DB Error:', {
    code: err?.code,
    errno: err?.errno,
    message: err?.message
  }));


module.exports = pool;
