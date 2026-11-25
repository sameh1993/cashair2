// routes/customers.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ success: false, message: 'غير مصرح' });
}

// ── GET /api/customers  (بحث + قائمة)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { q, type } = req.query;
    let sql = 'SELECT * FROM customers WHERE 1=1';
    const params = [];

    if (q) {
      sql += ' AND (name LIKE ? OR phone LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    if (type) {
      sql += ' AND customer_type = ?';
      params.push(type);
    }
    sql += ' ORDER BY id = 1 DESC, name ASC';  // العميل النقدي أول

    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/customers/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const [[customer]] = await db.query(
      'SELECT * FROM customers WHERE id = ?',
      [req.params.id]
    );
    if (!customer) return res.status(404).json({ success: false, message: 'العميل غير موجود' });

    // آخر 20 فاتورة
    const [invoices] = await db.query(
      `SELECT id, total, payment_method, created_at
       FROM invoices WHERE customer_id = ?
       ORDER BY created_at DESC LIMIT 20`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...customer, invoices } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/customers
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, phone, address, customer_type, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'الاسم مطلوب' });

    const [result] = await db.query(
      `INSERT INTO customers (name, phone, address, customer_type, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [name.trim(), phone || '', address || '', customer_type || 'cash', notes || '']
    );
    res.json({ success: true, id: result.insertId, message: 'تم إضافة العميل' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/customers/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (req.params.id == 1)
      return res.status(403).json({ success: false, message: 'لا يمكن تعديل العميل النقدي' });

    const { name, phone, address, customer_type, notes } = req.body;
    await db.query(
      `UPDATE customers SET name=?, phone=?, address=?, customer_type=?, notes=?
       WHERE id=?`,
      [name, phone || '', address || '', customer_type || 'cash', notes || '', req.params.id]
    );
    res.json({ success: true, message: 'تم التحديث' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/customers/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (req.params.id == 1)
      return res.status(403).json({ success: false, message: 'لا يمكن حذف العميل النقدي' });

    await db.query('DELETE FROM customers WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'تم الحذف' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
