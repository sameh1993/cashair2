const express = require('express');
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/settings
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT `key`, `value` FROM settings');
    const settings = {};
    rows.forEach((row) => {
      settings[row.key] = row.value;
    });
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب الإعدادات' });
  }
});

// PUT /api/settings
router.put('/', requireAdmin, async (req, res) => {
  const entries = Object.entries(req.body || {});
  if (!entries.length) {
    return res.status(400).json({ success: false, message: 'لا توجد إعدادات للحفظ' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const [key, value] of entries) {
      await conn.query(
        'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        [key, String(value ?? '')]
      );
    }
    await conn.commit();
    res.json({ success: true, message: 'تم حفظ الإعدادات' });
  } catch (error) {
    await conn.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في حفظ الإعدادات' });
  } finally {
    conn.release();
  }
});

// GET /api/settings/users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, username, full_name, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب المستخدمين' });
  }
});

// GET /api/settings/users/:id
router.get('/users/:id', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف المستخدم غير صالح' });
  }

  try {
    const [[user]] = await db.query(
      'SELECT id, username, full_name, role FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب المستخدم' });
  }
});

// POST /api/settings/users
router.post('/users', requireAdmin, async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const fullName = String(req.body?.full_name || '').trim();
  const requestedRole = String(req.body?.role || 'cashier').trim().toLowerCase();
  const role = requestedRole === 'admin' ? 'admin' : 'cashier';

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  if (password.length < 4) {
    return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
      [username, hash, fullName, role]
    );
    res.json({ success: true, message: 'تمت إضافة المستخدم' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'اسم المستخدم موجود بالفعل' });
    }

    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في إضافة المستخدم' });
  }
});

// PUT /api/settings/users/:id
router.put('/users/:id', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف المستخدم غير صالح' });
  }

  const fullName = String(req.body?.full_name || '').trim();
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const requestedRole = String(req.body?.role || 'cashier').trim().toLowerCase();
  const role = requestedRole === 'admin' ? 'admin' : 'cashier';

  if (!fullName || !username) {
    return res.status(400).json({ success: false, message: 'الاسم واسم المستخدم مطلوبان' });
  }

  try {
    let result;
    if (password) {
      if (password.length < 4) {
        return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' });
      }
      const hash = await bcrypt.hash(password, 10);
      [result] = await db.query(
        'UPDATE users SET full_name = ?, username = ?, password = ?, role = ? WHERE id = ?',
        [fullName, username, hash, role, userId]
      );
    } else {
      [result] = await db.query(
        'UPDATE users SET full_name = ?, username = ?, role = ? WHERE id = ?',
        [fullName, username, role, userId]
      );
    }

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    res.json({ success: true, message: 'تم تحديث المستخدم' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'اسم المستخدم موجود بالفعل' });
    }
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تحديث المستخدم' });
  }
});

// DELETE /api/settings/users/:id
router.delete('/users/:id', requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف المستخدم غير صالح' });
  }

  if (userId === req.session.user.id) {
    return res.status(400).json({ success: false, message: 'لا يمكنك حذف حسابك الحالي' });
  }

  try {
    const [result] = await db.query('DELETE FROM users WHERE id = ?', [userId]);
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    res.json({ success: true, message: 'تم حذف المستخدم' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في حذف المستخدم' });
  }
});

// ── Shop Settings Routes ──

// GET /api/settings/shop
router.get('/shop', requireAuth, async (req, res) => {
  try {
    const [[shop]] = await db.query('SELECT * FROM shop_settings WHERE id = 1');
    res.json({ success: true, data: shop || {} });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/settings/shop
router.put('/shop', requireAdmin, async (req, res) => {
  try {
    const { shop_name, address, phone, phone2, tax_number, logo_url, invoice_note } = req.body;
    await db.query(
      `UPDATE shop_settings SET
         shop_name=?, address=?, phone=?, phone2=?,
         tax_number=?, logo_url=?, invoice_note=?
       WHERE id=1`,
      [shop_name, address || '', phone || '', phone2 || '',
       tax_number || '', logo_url || '', invoice_note || '']
    );
    res.json({ success: true, message: 'تم حفظ بيانات المحل' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
