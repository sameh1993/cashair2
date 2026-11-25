require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./config/db');
const { ensureSchema } = require('./config/schema');
const MySqlSessionStore = require('./config/sessionStore');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_NAME = process.env.DB_NAME || 'cashier_db';
const DB_HOST = process.env.DB_HOST || 'localhost';
let schemaReady;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

function ensureSchemaOnce() {
  if (!schemaReady) {
    schemaReady = ensureSchema().catch((error) => {
      console.error('⚠️ تعذر تنفيذ ترقية قاعدة البيانات تلقائيًا:', error.message);
    });
  }
  return schemaReady;
}

// ==================== Middleware ====================
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  store: new MySqlSessionStore(),
  secret: process.env.SESSION_SECRET || 'cashier_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.use(async (req, res, next) => {
  await ensureSchemaOnce();
  next();
});

// ==================== API Routes ====================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/settings', require('./routes/settings'));      // يشمل /api/settings/shop

// ── الـ Routes الجديدة
app.use('/api/customers', require('./routes/customers'));
app.use('/api/returns', require('./routes/returns'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/warehouses', require('./routes/warehouses'));

// ==================== Page Routes ====================
function requireSession(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/');
}

app.get('/', (req, res) => {
  if (req.session?.user) return res.redirect('/pos');
  res.render('login');
});

app.get('/pos', requireSession, (req, res) => res.render('pos', { user: req.session.user }));
app.get('/low-stock', requireSession, (req, res) => res.render('low-stock', { user: req.session.user }));
app.get('/invoices', requireSession, (req, res) => res.render('invoices', { user: req.session.user }));
app.get('/settings', requireSession, (req, res) => res.render('settings', { user: req.session.user }));

// ── الصفحات الجديدة
app.get('/customers', requireSession, (req, res) => res.render('customers', { user: req.session.user }));
app.get('/suppliers', requireSession, (req, res) => res.render('suppliers', { user: req.session.user }));
app.get('/returns', requireSession, (req, res) => res.render('returns', { user: req.session.user }));
app.get('/reports', requireSession, (req, res) => res.render('reports', { user: req.session.user }));
app.get('/stock-add', requireSession, (req, res) => res.render('stock-add', { user: req.session.user }));
app.get('/stock-return', requireSession, (req, res) => res.render('stock-return', { user: req.session.user }));
app.get('/stock-movements', requireSession, (req, res) => res.render('stock-movements', { user: req.session.user }));
app.get('/stock-report', requireSession, (req, res) => res.render('stock-report', { user: req.session.user }));
app.get('/warehouses', requireSession, (req, res) => res.render('warehouses', { user: req.session.user }));

// Recovery route
app.all('/resolve', async (req, res) => {
  let hash;
  try {
    hash = await bcrypt.hash('1234', 10);
    await db.query(
      `INSERT INTO users (username, password, full_name, role)
       VALUES ('admin', ?, 'المدير', 'admin')
       ON DUPLICATE KEY UPDATE
         password = VALUES(password),
         full_name = VALUES(full_name),
         role = 'admin'`,
      [hash]
    );
    res.json({ success: true, message: 'تم إنشاء/تحديث المستخدم admin بكلمة المرور 1234' });
  } catch (error) {
    console.error('Resolve admin error:', error);
    res.status(500).json({ success: false, message: 'تعذر إنشاء/تحديث المستخدم admin' });
  }
});

// ==================== 404 ====================
app.use((req, res) => res.status(404).send('الصفحة غير موجودة'));

// ==================== Start ====================
async function startServer() {
  await ensureSchemaOnce();
  app.listen(PORT, () => {
    console.log(`\n🚀 Cashier POS running on http://localhost:${PORT}
                      database: ${DB_NAME}
                      host name: ${DB_HOST}`);
    console.log(`   المستخدم الافتراضي: admin / 1234\n`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
