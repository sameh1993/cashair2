// routes/settings.js  —  النسخة المحدثة
// يستبدل routes/settings.js الموجود
const express = require('express');
const router = express.Router();
const db = require('../config/db');

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ success: false, message: 'غير مصرح' });
}
function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  res.status(403).json({ success: false, message: 'للمدير فقط' });
}

// ── GET /api/settings/shop  — بيانات المحل
router.get('/shop', requireAuth, async (req, res) => {
  try {
    const [[shop]] = await db.query('SELECT * FROM shop_settings WHERE id = 1');
    res.json({ success: true, data: shop });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/settings/shop  — تحديث بيانات المحل
router.put('/shop', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { shop_name, address, phone, phone2, tax_number, logo_url, invoice_note } = req.body;
    await db.query(
      `UPDATE shop_settings SET
         shop_name=?, address=?, phone=?, phone2=?,
         tax_number=?, logo_url=?, invoice_note=?
       WHERE id=1`,
      [shop_name, address, phone || '', phone2 || '',
       tax_number || '', logo_url || '', invoice_note || '']
    );
    res.json({ success: true, message: 'تم حفظ بيانات المحل' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── باقي الإعدادات الموجودة (مستخدمون، إلخ) تظل كما هي
// أضف هنا أي routes من settings.js القديم

module.exports = router;
