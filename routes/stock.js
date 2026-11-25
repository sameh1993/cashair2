const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function generateDocNumber(type) {
  const prefix = type === 'purchase' ? 'PO' : 'RT';
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}-${ts}`;
}

// POST /api/stock/purchase - إذن إضافة للمخزن
router.post('/purchase', requireAuth, async (req, res) => {
  const { supplier_name, notes, items } = req.body;
  if (!items || !items.length) {
    return res.status(400).json({ success: false, message: 'يجب إضافة صنف واحد على الأقل' });
  }

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const docNumber = generateDocNumber('purchase');
    const [movement] = await conn.query(
      `INSERT INTO stock_movements (type, document_number, supplier_name, notes, created_by)
       VALUES ('purchase', ?, ?, ?, ?)`,
      [docNumber, supplier_name || null, notes || null, req.session.user.id]
    );

    for (const item of items) {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unit_price) || 0;
      if (qty <= 0) continue;

      await conn.query(
        `INSERT INTO stock_movement_items (movement_id, product_id, product_name, quantity, unit_price, total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [movement.insertId, item.product_id, item.product_name, qty, price, qty * price]
      );

      await conn.query(
        'UPDATE products SET stock = stock + ?, price = GREATEST(?, price) WHERE id = ?',
        [qty, price, item.product_id]
      );
    }

    await conn.commit();
    res.status(201).json({ success: true, message: 'تمت إضافة الأصناف إلى المخزن', document_number: docNumber });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في إضافة الأصناف' });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/stock/return - إذن مرتجع لمورد
router.post('/return', requireAuth, async (req, res) => {
  const { supplier_name, notes, items } = req.body;
  if (!items || !items.length) {
    return res.status(400).json({ success: false, message: 'يجب إضافة صنف واحد على الأقل' });
  }

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const docNumber = generateDocNumber('return_to_supplier');
    const [movement] = await conn.query(
      `INSERT INTO stock_movements (type, document_number, supplier_name, notes, created_by)
       VALUES ('return_to_supplier', ?, ?, ?, ?)`,
      [docNumber, supplier_name || null, notes || null, req.session.user.id]
    );

    for (const item of items) {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unit_price) || 0;
      if (qty <= 0) continue;

      await conn.query(
        `INSERT INTO stock_movement_items (movement_id, product_id, product_name, quantity, unit_price, total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [movement.insertId, item.product_id, item.product_name, qty, price, qty * price]
      );

      await conn.query(
        'UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?',
        [qty, item.product_id]
      );
    }

    await conn.commit();
    res.status(201).json({ success: true, message: 'تم إرجاع الأصناف للمورد', document_number: docNumber });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في إرجاع الأصناف' });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/stock/movements/:productId - تقرير بحركات صنف
router.get('/movements/:productId', requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف المنتج غير صالح' });
  }

  try {
    const [[product]] = await db.query(
      'SELECT id, name, stock, price, min_quantity FROM products WHERE id = ? AND active = 1',
      [productId]
    );
    if (!product) {
      return res.status(404).json({ success: false, message: 'المنتج غير موجود' });
    }

    // حركات المشتريات والمرتجعات من stock_movements
    const [stockMoves] = await db.query(`
      SELECT sm.id, sm.type, sm.document_number, sm.supplier_name, sm.notes, sm.created_at,
             smi.quantity, smi.unit_price, smi.total
      FROM stock_movements sm
      JOIN stock_movement_items smi ON smi.movement_id = sm.id
      WHERE smi.product_id = ?
      ORDER BY sm.created_at DESC
    `, [productId]);

    // حركات المبيعات من invoices
    const [salesMoves] = await db.query(`
      SELECT i.id, 'sale' AS type, i.invoice_number AS document_number,
             NULL AS supplier_name, i.notes, i.created_at,
             ii.quantity, ii.unit_price, ii.subtotal AS total
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE ii.product_id = ?
      ORDER BY i.created_at DESC
    `, [productId]);

    // دمج وترتيب
    const movements = [...stockMoves, ...salesMoves].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    // حساب الإجماليات
    const totalPurchased = stockMoves
      .filter(m => m.type === 'purchase')
      .reduce((s, m) => s + Number(m.quantity), 0);
    const totalReturned = stockMoves
      .filter(m => m.type === 'return_to_supplier')
      .reduce((s, m) => s + Number(m.quantity), 0);
    const totalSold = salesMoves.reduce((s, m) => s + Number(m.quantity), 0);

    res.json({
      success: true,
      data: {
        product,
        movements,
        stats: {
          total_purchased: totalPurchased,
          total_returned: totalReturned,
          total_sold: totalSold,
          current_stock: Number(product.stock)
        }
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب حركات الصنف' });
  }
});

// GET /api/stock/report - تقرير رصيد المخزن والنواقص
router.get('/report', requireAuth, async (req, res) => {
  try {
    const [products] = await db.query(`
      SELECT id, name, barcode, category, price, cost_price, stock, unit, min_quantity
      FROM products
      WHERE active = 1
      ORDER BY stock ASC, name ASC
    `);

    const totalProducts = products.length;
    const totalStockValue = products.reduce((s, p) => s + (Number(p.stock) * (Number(p.cost_price) || Number(p.price))), 0);
    const lowStock = products.filter(p => Number(p.stock) <= Number(p.min_quantity || 5));
    const outOfStock = products.filter(p => Number(p.stock) <= 0);
    const totalItems = products.reduce((s, p) => s + Math.max(0, Number(p.stock)), 0);

    // آخر حركات الإضافة
    const [recentMovements] = await db.query(`
      SELECT sm.id, sm.type, sm.document_number, sm.supplier_name, sm.created_at,
             smi.product_name, smi.quantity
      FROM stock_movements sm
      JOIN stock_movement_items smi ON smi.movement_id = sm.id
      ORDER BY sm.created_at DESC
      LIMIT 50
    `);

    res.json({
      success: true,
      data: {
        products,
        low_stock: lowStock,
        out_of_stock: outOfStock,
        recent_movements: recentMovements,
        stats: {
          total_products: totalProducts,
          total_items: totalItems,
          total_stock_value: totalStockValue,
          low_stock_count: lowStock.length,
          out_of_stock_count: outOfStock.length
        }
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب تقرير المخزن' });
  }
});

// GET /api/stock/documents - قائمة أذون الإضافة والمرتجع
router.get('/documents', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT sm.*, u.full_name AS created_by_name
      FROM stock_movements sm
      LEFT JOIN users u ON u.id = sm.created_by
      ORDER BY sm.created_at DESC
      LIMIT 100
    `);

    // جلب الأصناف لكل مستند
    const docs = [];
    for (const row of rows) {
      const [items] = await db.query(
        'SELECT * FROM stock_movement_items WHERE movement_id = ?',
        [row.id]
      );
      docs.push({ ...row, items });
    }

    res.json({ success: true, data: docs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب المستندات' });
  }
});

module.exports = router;
