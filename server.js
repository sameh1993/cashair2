require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { ensureSchema } = require('./config/schema');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_NAME = process.env.DB_NAME || 3000;

// ==================== Middleware ====================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'cashier_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000   // 8 ساعات
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ==================== Routes ====================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/warehouses', require('./routes/warehouses'));

// ==================== Page Routes ====================
const protectedPages = ['/pos', '/products', '/low-stock', '/invoices', '/warehouses', '/settings'];

// Middleware لحماية صفحات HTML
function requireSession(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/');
}

app.get('/', (req, res) => {
  if (req.session?.user) return res.redirect('/pos');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/pos', requireSession, (req, res) => res.sendFile(path.join(__dirname, 'public', 'pos.html')));
app.get('/products', requireSession, (req, res) => res.sendFile(path.join(__dirname, 'public', 'products.html')));
app.get('/low-stock', requireSession, (req, res) => res.sendFile(path.join(__dirname, 'public', 'low-stock.html')));
app.get('/invoices', requireSession, (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoices.html')));
app.get('/warehouses', requireSession, (req, res) => res.sendFile(path.join(__dirname, 'public', 'warehouses.html')));
app.get('/settings', requireSession, (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));

// ==================== 404 ====================
app.use((req, res) => res.status(404).send('الصفحة غير موجودة'));

// ==================== Start ====================
async function startServer() {
  try {
    await ensureSchema();
  } catch (error) {
    console.error('⚠️ تعذر تنفيذ ترقية قاعدة البيانات تلقائيًا:', error.message);
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Cashier POS running on http://localhost:${PORT}
                      database: ${DB_NAME}`);
    console.log(`   المستخدم الافتراضي: admin / 1234\n`);
  });
}

startServer();
