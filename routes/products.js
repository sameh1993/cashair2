const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { roundQty } = require('../services/inventory');

const router = express.Router();

function normalizeProductPayload(body = {}) {
  const name = String(body.name || '').trim();
  const barcode = String(body.barcode || '').trim();
  const category = String(body.category || '').trim() || 'عام';
  const unit = String(body.unit || '').trim() || 'قطعة';
  const price = Number(body.price);
  const stock = roundQty(body.stock ?? body.quantity ?? 0);
  const cost_price = Number(body.cost_price ?? 0);
  const min_quantity = Number(body.min_quantity ?? 5);
  const description = String(body.description || '').trim() || null;
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

  if (!Number.isFinite(cost_price) || cost_price < 0) {
    return { error: 'سعر التكلفة غير صالح' };
  }

  if (!Number.isFinite(min_quantity) || min_quantity < 0) {
    return { error: 'الحد الأدنى للتنبيه غير صالح' };
  }

  return {
    data: {
      name,
      barcode: barcode || null,
      category,
      price,
      stock,
      cost_price,
      unit,
      min_quantity,
      description,
      active
    }
  };
}

async function ensureCategoryExists(name) {
  try {
    await db.query('INSERT IGNORE INTO product_categories (name) VALUES (?)', [name]);
  } catch (error) {
    console.error('تعذر تسجيل التصنيف:', error.message);
  }
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
      p.cost_price,
      p.unit,
      p.min_quantity,
      p.description,
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
    const [rows] = await db.query(`
      SELECT category AS name FROM products WHERE category IS NOT NULL AND TRIM(category) <> ''
      UNION SELECT name FROM product_categories
      ORDER BY name ASC
    `);
    res.json({ success: true, data: rows.map((row) => row.name) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب التصنيفات' });
  }
});

router.post('/categories', requireAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'اسم التصنيف مطلوب' });
  if (name.length > 100) return res.status(400).json({ success: false, message: 'اسم التصنيف يجب ألا يتجاوز 100 حرف' });
  if (name === 'الكل') return res.status(400).json({ success: false, message: 'هذا الاسم محجوز لعرض كل المنتجات' });
  try {
    await db.query('INSERT INTO product_categories (name) VALUES (?)', [name]);
    res.status(201).json({ success: true, data: name, message: 'تمت إضافة التصنيف' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'التصنيف موجود بالفعل' });
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في إضافة التصنيف' });
  }
});

// GET /api/products/categories/details
router.get('/categories/details', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        c.id,
        c.name,
        c.created_at,
        COUNT(p.id) AS products_count,
        COALESCE(SUM(p.stock), 0) AS total_stock,
        COALESCE(SUM(p.stock * p.price), 0) AS total_value
      FROM product_categories c
      LEFT JOIN products p ON p.active = 1 AND p.category = c.name
      GROUP BY c.id, c.name, c.created_at
      ORDER BY c.name ASC
    `);

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب التصنيفات' });
  }
});

// PUT /api/products/categories/:id
router.put('/categories/:id', requireAdmin, async (req, res) => {
  const categoryId = Number(req.params.id);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف التصنيف غير صالح' });
  }

  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'اسم التصنيف مطلوب' });
  if (name.length > 100) return res.status(400).json({ success: false, message: 'اسم التصنيف يجب ألا يتجاوز 100 حرف' });

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [[category]] = await conn.query(
      'SELECT id, name FROM product_categories WHERE id = ? FOR UPDATE',
      [categoryId]
    );

    if (!category) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'التصنيف غير موجود' });
    }

    await conn.query('UPDATE product_categories SET name = ? WHERE id = ?', [name, categoryId]);

    if (category.name !== name) {
      await conn.query('UPDATE products SET category = ? WHERE category = ?', [name, category.name]);
    }

    await conn.commit();
    res.json({ success: true, message: 'تم تحديث التصنيف بنجاح' });
  } catch (error) {
    await conn.rollback();

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'التصنيف موجود بالفعل' });
    }

    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تحديث التصنيف' });
  } finally {
    conn.release();
  }
});

// DELETE /api/products/categories/:id
router.delete('/categories/:id', requireAdmin, async (req, res) => {
  const categoryId = Number(req.params.id);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف التصنيف غير صالح' });
  }

  try {
    const [[category]] = await db.query(
      'SELECT id, name FROM product_categories WHERE id = ? LIMIT 1',
      [categoryId]
    );

    if (!category) {
      return res.status(404).json({ success: false, message: 'التصنيف غير موجود' });
    }

    const [[usage]] = await db.query(
      'SELECT COUNT(*) AS total FROM products WHERE category = ?',
      [category.name]
    );

    if (usage.total > 0) {
      return res.status(400).json({
        success: false,
        message: `لا يمكن حذف التصنيف لأنه مستخدم في ${usage.total} صنف`
      });
    }

    await db.query('DELETE FROM product_categories WHERE id = ?', [categoryId]);
    res.json({ success: true, message: 'تم حذف التصنيف بنجاح' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في حذف التصنيف' });
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

  try {
    const stock = payload.data.stock;
    const [result] = await db.query(
      'INSERT INTO products (name, barcode, category, price, stock, cost_price, unit, min_quantity, description, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        payload.data.name,
        payload.data.barcode,
        payload.data.category,
        payload.data.price,
        stock,
        payload.data.cost_price,
        payload.data.unit,
        payload.data.min_quantity,
        payload.data.description,
        payload.data.active
      ]
    );

    await ensureCategoryExists(payload.data.category);

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
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'الباركود مسجل مسبقًا' });
    }

    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في إضافة المنتج' });
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

  try {
    const [existing] = await db.query(
      'SELECT id FROM products WHERE id = ? LIMIT 1',
      [productId]
    );
    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    await db.query(
      `UPDATE products
       SET name = ?, barcode = ?, category = ?, price = ?, stock = ?, cost_price = ?, unit = ?, min_quantity = ?, description = ?, active = ?
       WHERE id = ?`,
      [
        payload.data.name,
        payload.data.barcode,
        payload.data.category,
        payload.data.price,
        payload.data.stock,
        payload.data.cost_price,
        payload.data.unit,
        payload.data.min_quantity,
        payload.data.description,
        payload.data.active,
        productId
      ]
    );

    await ensureCategoryExists(payload.data.category);

    res.json({ success: true, message: 'تم تحديث المنتج' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'الباركود مسجل مسبقًا' });
    }
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تحديث المنتج' });
  }
});

// GET /api/products/:id
router.get('/:id', requireAuth, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف المنتج غير صالح' });
  }

  try {
    const [[product]] = await db.query(
      'SELECT * FROM products WHERE id = ? AND active = 1',
      [productId]
    );

    if (!product) {
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    res.json({ success: true, data: product });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب المنتج' });
  }
});

// PUT /api/products/:id/stock
router.put('/:id/stock', requireAdmin, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف المنتج غير صالح' });
  }

  const { operation, quantity } = req.body;
  const qty = roundQty(quantity);
  if (!['add', 'sub', 'set'].includes(operation) || qty < 0) {
    return res.status(400).json({ success: false, message: 'بيانات العملية غير صالحة' });
  }

  try {
    const [[product]] = await db.query(
      'SELECT id, stock FROM products WHERE id = ? LIMIT 1',
      [productId]
    );

    if (!product) {
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    let newStock;
    if (operation === 'add') {
      newStock = roundQty(product.stock + qty);
    } else if (operation === 'sub') {
      newStock = Math.max(0, roundQty(product.stock - qty));
    } else {
      newStock = qty;
    }

    await db.query('UPDATE products SET stock = ? WHERE id = ?', [newStock, productId]);
    res.json({ success: true, message: 'تم تعديل المخزون' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تعديل المخزون' });
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
