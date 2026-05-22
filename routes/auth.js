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

function getServerErrorMessage(error) {
  const code = error?.code;

  if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(code)) {
    return 'تعذر الاتصال بقاعدة البيانات. تأكد من إعدادات DB_HOST و DB_PORT على Vercel.';
  }

  if (code === 'ER_ACCESS_DENIED_ERROR') {
    return 'بيانات مستخدم قاعدة البيانات غير صحيحة على Vercel.';
  }

  if (code === 'ER_BAD_DB_ERROR') {
    return 'اسم قاعدة البيانات غير صحيح أو غير موجود على Vercel.';
  }

  if (code === 'ER_NO_SUCH_TABLE') {
    return 'جداول قاعدة البيانات غير موجودة. استورد ملف قاعدة البيانات أو اسمح للتطبيق بإنشائها.';
  }

  if (['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'].includes(code)) {
    return 'مستخدم قاعدة البيانات لا يملك صلاحيات كافية للقراءة أو كتابة الجلسات.';
  }

  return 'خطأ في الخادم';
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
    console.error('Login error:', {
      code: e?.code,
      errno: e?.errno,
      sqlState: e?.sqlState,
      message: e?.message
    });
    res.status(500).json({ success: false, message: getServerErrorMessage(e) });
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
    console.error('Change password error:', {
      code: e?.code,
      errno: e?.errno,
      sqlState: e?.sqlState,
      message: e?.message
    });
    res.status(500).json({ success: false, message: getServerErrorMessage(e) });
  }
});

module.exports = router;
