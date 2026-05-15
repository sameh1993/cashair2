const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  createStockDocument,
  getPrimaryWarehouse,
  roundQty
} = require('../services/inventory');

const router = express.Router();

function normalizeProductPayload(body = {}) {
  const name = String(body.name || '').trim();
  const barcode = String(body.barcode || '').trim();
  const category = String(body.category || '').trim() || 'عام';
  const unit = String(body.unit || '').trim() || 'قطعة';
  const price = Number(body.price);
  const stock = roundQty(body.stock ?? 0);
  const active = body.active === undefined ? 1 : Number(body.active) ? 1 : 0;

  if (!name) {
    return { error: 'اسم المنتج مطلوب' };
  }

  if (!Number.isFinite(price) || price < 0) {
    return { error: 'السعر غير صالح' };
  }

  if (!Number.isFinite(stock) || stock < 0) {
    return { error: 'المخزون غير صالح' };
  }

  return {
    data: {
      name,
      barcode: barcode || null,
      category,
      price,
      stock,
      unit,
      active
    }
  };
}

function productsSelectSql() {
  return `
    SELECT
      p.id,
      p.name,
      p.barcode,
      p.category,
      p.price,
      p.stock,
      p.unit,
      p.active,
      COALESCE(s.total_sold, 0) AS total_sold
    FROM products p
    LEFT JOIN (
      SELECT product_id, SUM(quantity) AS total_sold
      FROM invoice_items
      WHERE product_id IS NOT NULL
      GROUP BY product_id
    ) s ON s.product_id = p.id
  `;
}

// GET /api/products/categories
router.get('/categories', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category <> '' ORDER BY category ASC"
    );
    res.json({ success: true, data: rows.map((row) => row.category) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب التصنيفات' });
  }
});

// GET /api/products/low-stock
router.get('/low-stock', requireAuth, async (req, res) => {
  try {
    const [[settingsRow]] = await db.query(
      "SELECT `value` FROM settings WHERE `key` = 'low_stock_alert' LIMIT 1"
    );
    const alertLimit = Math.max(0, parseInt(settingsRow?.value, 10) || 5);

    const [rows] = await db.query(
      `${productsSelectSql()}
       WHERE p.active = 1 AND p.stock <= ?
       ORDER BY p.stock ASC, total_sold DESC, p.name ASC`,
      [alertLimit]
    );

    const data = rows.map((row) => ({
      ...row,
      stock_status: Number(row.stock) <= 0 ? 'out' : Number(row.stock) <= alertLimit ? 'low' : 'ok'
    }));

    res.json({
      success: true,
      data,
      meta: { low_stock_alert: alertLimit }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب المنتجات منخفضة المخزون' });
  }
});

// GET /api/products
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `${productsSelectSql()}
       WHERE p.active = 1
       ORDER BY total_sold DESC, p.name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب المنتجات' });
  }
});

// GET /api/products/all
router.get('/all', requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `${productsSelectSql()}
       ORDER BY p.category ASC, total_sold DESC, p.name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب المنتجات' });
  }
});

// GET /api/products/barcode/:code
router.get('/barcode/:code', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `${productsSelectSql()}
       WHERE p.barcode = ? AND p.active = 1
       LIMIT 1`,
      [req.params.code]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في البحث عن المنتج' });
  }
});

// POST /api/products
router.post('/', requireAdmin, async (req, res) => {
  const payload = normalizeProductPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ success: false, message: payload.error });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const openingStock = payload.data.stock;
    const [result] = await conn.query(
      'INSERT INTO products (name, barcode, category, price, stock, unit, active) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [
        payload.data.name,
        payload.data.barcode,
        payload.data.category,
        payload.data.price,
        payload.data.unit,
        payload.data.active
      ]
    );

    if (openingStock > 0) {
      const primaryWarehouse = await getPrimaryWarehouse(conn, { lock: true });
      if (!primaryWarehouse) {
        throw new Error('WAREHOUSE_NOT_FOUND');
      }

      await createStockDocument(conn, {
        documentType: 'adjustment_in',
        warehouseId: primaryWarehouse.id,
        paidAmount: 0,
        notes: `رصيد افتتاحي للصنف ${payload.data.name}`,
        items: [{
          product_id: result.insertId,
          product_name: payload.data.name,
          quantity: openingStock,
          unit_price: payload.data.price
        }],
        createdBy: req.session.user.id
      });
    }

    await conn.commit();

    const [[product]] = await db.query(
      'SELECT * FROM products WHERE id = ? LIMIT 1',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      data: product,
      message: 'تمت إضافة المنتج بنجاح'
    });
  } catch (error) {
    await conn.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'الباركود مسجل مسبقًا' });
    }

    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في إضافة المنتج' });
  } finally {
    conn.release();
  }
});

// PUT /api/products/:id
router.put('/:id', requireAdmin, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف المنتج غير صالح' });
  }

  const payload = normalizeProductPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ success: false, message: payload.error });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [[existingProduct]] = await conn.query(
      'SELECT id, name, stock FROM products WHERE id = ? FOR UPDATE',
      [productId]
    );

    if (!existingProduct) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    await conn.query(
      `UPDATE products
       SET name = ?, barcode = ?, category = ?, price = ?, unit = ?, active = ?
       WHERE id = ?`,
      [
        payload.data.name,
        payload.data.barcode,
        payload.data.category,
        payload.data.price,
        payload.data.unit,
        payload.data.active,
        productId
      ]
    );

    const currentStock = roundQty(existingProduct.stock);
    const requestedStock = roundQty(payload.data.stock);
    const stockDelta = roundQty(requestedStock - currentStock);

    if (stockDelta !== 0) {
      const primaryWarehouse = await getPrimaryWarehouse(conn, { lock: true });
      if (!primaryWarehouse) {
        throw new Error('WAREHOUSE_NOT_FOUND');
      }

      await createStockDocument(conn, {
        documentType: stockDelta > 0 ? 'adjustment_in' : 'adjustment_out',
        warehouseId: primaryWarehouse.id,
        paidAmount: 0,
        notes: `تسوية رصيد من شاشة المنتجات للصنف ${payload.data.name}`,
        items: [{
          product_id: productId,
          product_name: payload.data.name,
          quantity: Math.abs(stockDelta),
          unit_price: payload.data.price
        }],
        createdBy: req.session.user.id
      });
    }

    await conn.commit();
    res.json({ success: true, message: 'تم تحديث المنتج' });
  } catch (error) {
    await conn.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'الباركود مسجل مسبقًا' });
    }

    if (error.message === 'WAREHOUSE_NOT_FOUND') {
      return res.status(500).json({ success: false, message: 'لا يوجد مخزن رئيسي مضبوط للنظام' });
    }

    if (error.message?.startsWith('INSUFFICIENT_STOCK:')) {
      return res.status(400).json({
        success: false,
        message: 'لا يمكن خفض الرصيد من شاشة المنتجات لأن الكمية غير متوفرة في المخزن الرئيسي. استخدم شاشة المخازن للتوزيع أو الصرف أولًا.'
      });
    }

    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تحديث المنتج' });
  } finally {
    conn.release();
  }
});

// DELETE /api/products/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف المنتج غير صالح' });
  }

  try {
    const [result] = await db.query('UPDATE products SET active = 0 WHERE id = ?', [productId]);
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    res.json({ success: true, message: 'تم حذف المنتج' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في حذف المنتج' });
  }
});

module.exports = router;
