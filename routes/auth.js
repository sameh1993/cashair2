const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const router = express.Router();

function normalizePasswordHash(hash) {
  return String(hash || '').trim();
}

function isBcryptHash(hash) {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.json({ success: false, message: 'يرجى إدخال اسم المستخدم وكلمة المرور' });

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (!rows.length)
      return res.json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });

    const user = rows[0];
    const passwordHash = normalizePasswordHash(user.password);
    if (!isBcryptHash(passwordHash)) {
      console.error(`Invalid password hash for user: ${username}`);
      return res.status(500).json({
        success: false,
        message: 'كلمة مرور هذا المستخدم غير مهيأة بشكل صحيح. أعد ضبط كلمة المرور من قاعدة البيانات.'
      });
    }

    const valid = await bcrypt.compare(password, passwordHash);
    if (!valid)
      return res.json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });

    req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
    await saveSession(req);
    res.json({ success: true, user: req.session.user });
  } catch (e) {
    console.error(e);
    res.json({ success: false, message: 'خطأ في الخادم' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.session && req.session.user)
    return res.json({ success: true, user: req.session.user });
  res.json({ success: false });
});

// POST /api/auth/change-password
router.post('/change-password', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ success: false });
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password)
    return res.json({ success: false, message: 'يرجى ملء جميع الحقول' });
  if (new_password.length < 4)
    return res.json({ success: false, message: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' });

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    const passwordHash = normalizePasswordHash(rows[0]?.password);
    if (!isBcryptHash(passwordHash)) {
      return res.status(500).json({
        success: false,
        message: 'كلمة مرور هذا المستخدم غير مهيأة بشكل صحيح. أعد ضبط كلمة المرور من قاعدة البيانات.'
      });
    }

    const valid = await bcrypt.compare(old_password, passwordHash);
    if (!valid) return res.json({ success: false, message: 'كلمة المرور الحالية غير صحيحة' });

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hash, req.session.user.id]);
    res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (e) {
    res.json({ success: false, message: 'خطأ في الخادم' });
  }
});

router.get('/resolve', async (req, res) => {
  try {
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const [[dbInfo]] = await db.query(`
      SELECT DATABASE() AS db_name,
             (SELECT COUNT(*) FROM users) AS users_count
    `);
    const [[adminInfo]] = await db.query(
      `SELECT COUNT(*) AS admin_count,
              MAX(CASE WHEN password REGEXP '^\\\\$2[aby]\\\\$[0-9]{2}\\\\$[./A-Za-z0-9]{53}$' THEN 1 ELSE 0 END) AS admin_password_ready
       FROM users
       WHERE username = ?`,
      [adminUsername]
    );

    res.json({
      success: true,
      node_env: process.env.NODE_ENV || 'unset',
      db_host_set: Boolean(process.env.DB_HOST),
      db_name: dbInfo.db_name,
      users_count: dbInfo.users_count,
      admin_username: adminUsername,
      admin_count: adminInfo.admin_count,
      admin_password_ready: Boolean(adminInfo.admin_password_ready),
      reset_admin_password: process.env.RESET_ADMIN_PASSWORD === 'true',
      has_session_secret: Boolean(process.env.SESSION_SECRET)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
      node_env: process.env.NODE_ENV || 'unset',
      db_host_set: Boolean(process.env.DB_HOST),
      has_session_secret: Boolean(process.env.SESSION_SECRET)
    });
  }
});

module.exports = router;
