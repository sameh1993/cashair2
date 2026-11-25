const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/warehouses
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, code, location, is_primary, active, created_at FROM warehouses WHERE active = 1 ORDER BY is_primary DESC, id ASC'
    );
    res.json({ success: true, data: rows, warehouses: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب المخازن' });
  }
});

// GET /api/warehouses/:id
router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'معرف المخزن غير صالح' });
  }

  try {
    const [[warehouse]] = await db.query('SELECT * FROM warehouses WHERE id = ? AND active = 1', [id]);
    if (!warehouse) {
      return res.status(404).json({ success: false, message: 'المخزن غير موجود' });
    }
    res.json({ success: true, data: warehouse, warehouse });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب المخزن' });
  }
});

module.exports = router;
