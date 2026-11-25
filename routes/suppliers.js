const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const params = [];
    let sql = 'SELECT id, name, phone, address, notes, created_at FROM suppliers WHERE active = 1';
    if (q) {
      sql += ' AND (name LIKE ? OR phone LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY name ASC';
    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب الموردين' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'اسم المورد مطلوب' });
  try {
    const [result] = await db.query(
      'INSERT INTO suppliers (name, phone, address, notes) VALUES (?, ?, ?, ?)',
      [name, String(req.body.phone || '').trim() || null, String(req.body.address || '').trim() || null, String(req.body.notes || '').trim() || null]
    );
    res.status(201).json({ success: true, id: result.insertId, message: 'تمت إضافة المورد' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'اسم المورد مسجل بالفعل' });
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في إضافة المورد' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'معرف المورد غير صالح' });
  if (!name) return res.status(400).json({ success: false, message: 'اسم المورد مطلوب' });
  try {
    const [result] = await db.query(
      'UPDATE suppliers SET name = ?, phone = ?, address = ?, notes = ? WHERE id = ? AND active = 1',
      [name, String(req.body.phone || '').trim() || null, String(req.body.address || '').trim() || null, String(req.body.notes || '').trim() || null, id]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'المورد غير موجود' });
    res.json({ success: true, message: 'تم تحديث بيانات المورد' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'اسم المورد مسجل بالفعل' });
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تحديث المورد' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'معرف المورد غير صالح' });
  try {
    const [result] = await db.query('UPDATE suppliers SET active = 0 WHERE id = ? AND active = 1', [id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'المورد غير موجود' });
    res.json({ success: true, message: 'تم حذف المورد' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في حذف المورد' });
  }
});

module.exports = router;
