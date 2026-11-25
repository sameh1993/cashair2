// routes/returns.js  —  مرتجعات المبيعات
const express = require('express');
const router = express.Router();
const db = require('../config/db');

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ success: false, message: 'غير مصرح' });
}

// ── GET /api/returns/invoice/:id  — عرض بنود فاتورة أصلية للاختيار منها
router.get('/invoice/:id', requireAuth, async (req, res) => {
  try {
    const [[invoice]] = await db.query(
      `SELECT inv.*, c.name AS customer_name
       FROM invoices inv
       LEFT JOIN customers c ON c.id = inv.customer_id
       WHERE inv.id = ?`,
      [req.params.id]
    );
    if (!invoice) return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });

    const [items] = await db.query(
      `SELECT ii.*, p.name AS product_name
       FROM invoice_items ii
       LEFT JOIN products p ON p.id = ii.product_id
       WHERE ii.invoice_id = ?`,
      [req.params.id]
    );

    // كمية مرتجعة سابقاً لكل صنف
    const [prevReturns] = await db.query(
      `SELECT ri.product_id, SUM(ri.quantity) AS returned_qty
       FROM return_invoice_items ri
       JOIN return_invoices r ON r.id = ri.return_invoice_id
       WHERE r.original_invoice_id = ?
       GROUP BY ri.product_id`,
      [req.params.id]
    );
    const returnMap = {};
    prevReturns.forEach(r => { returnMap[r.product_id] = parseFloat(r.returned_qty); });

    const itemsWithAvail = items.map(it => ({
      ...it,
      already_returned: returnMap[it.product_id] || 0,
      available_to_return: it.quantity - (returnMap[it.product_id] || 0)
    }));

    res.json({ success: true, data: { invoice, items: itemsWithAvail } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/returns/verify-pin  — التحقق من PIN المرتجع
router.post('/verify-pin', requireAuth, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.json({ success: false, message: 'الرجاء إدخال الرقم السري' });
    const [[setting]] = await db.query('SELECT `value` FROM settings WHERE `key` = ?', ['return_pin']);
    const storedPin = setting?.value || '';
    if (!storedPin) return res.json({ success: true }); // no PIN set → always allowed
    if (pin !== storedPin) return res.json({ success: false, message: 'الرقم السري غير صحيح' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/returns  — تسجيل مرتجع
router.post('/', requireAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { original_invoice_id, items, reason, pin } = req.body;
    // items = [{ product_id, product_name, quantity, unit_price }]

    // التحقق من PIN إن كان مضبوطاً
    if (pin !== undefined) {
      const [[setting]] = await conn.query('SELECT `value` FROM settings WHERE `key` = ?', ['return_pin']);
      const storedPin = setting?.value || '';
      if (storedPin && pin !== storedPin) {
        await conn.rollback();
        return res.status(403).json({ success: false, message: 'الرقم السري غير صحيح' });
      }
    }

    if (!original_invoice_id || !items?.length)
      return res.status(400).json({ success: false, message: 'بيانات ناقصة' });

    // تحقق من الفاتورة الأصلية
    const [[origInv]] = await conn.query(
      'SELECT * FROM invoices WHERE id = ?',
      [original_invoice_id]
    );
    if (!origInv) return res.status(404).json({ success: false, message: 'الفاتورة الأصلية غير موجودة' });

    // التحقق من الكميات المتاحة
    for (const item of items) {
      const [[origItem]] = await conn.query(
        'SELECT quantity FROM invoice_items WHERE invoice_id = ? AND product_id = ?',
        [original_invoice_id, item.product_id]
      );
      if (!origItem)
        throw new Error(`الصنف ${item.product_name} غير موجود في الفاتورة الأصلية`);

      const [[prevRet]] = await conn.query(
        `SELECT COALESCE(SUM(ri.quantity),0) AS ret
         FROM return_invoice_items ri
         JOIN return_invoices r ON r.id = ri.return_invoice_id
         WHERE r.original_invoice_id = ? AND ri.product_id = ?`,
        [original_invoice_id, item.product_id]
      );
      const available = origItem.quantity - prevRet.ret;
      if (item.quantity > available)
        throw new Error(`كمية مرتجع الصنف "${item.product_name}" تتجاوز المتاح (${available})`);
    }

    // إجمالي المرتجع
    const total_refund = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);

    // إنشاء فاتورة المرتجع
    const [retResult] = await conn.query(
      `INSERT INTO return_invoices
         (original_invoice_id, customer_id, customer_name, total_refund, reason, created_by)
       VALUES (?,?,?,?,?,?)`,
      [original_invoice_id,
       origInv.customer_id || 1,
       origInv.customer_name || 'عميل نقدي',
       total_refund,
       reason || '',
       req.session.user.id]
    );
    const return_invoice_id = retResult.insertId;

    // بنود المرتجع + إعادة المخزون
    for (const item of items) {
      await conn.query(
        `INSERT INTO return_invoice_items
           (return_invoice_id, product_id, product_name, quantity, unit_price, total)
         VALUES (?,?,?,?,?,?)`,
        [return_invoice_id, item.product_id, item.product_name,
         item.quantity, item.unit_price, item.quantity * item.unit_price]
      );

      // إعادة الكمية للمخزون
      await conn.query(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [item.quantity, item.product_id]
      );
    }

    await conn.commit();
    res.json({
      success: true,
      return_invoice_id,
      total_refund,
      message: `تم تسجيل المرتجع — الإجمالي: ${total_refund.toFixed(2)}`
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});

// ── GET /api/returns  — قائمة المرتجعات
router.get('/', requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = `
      SELECT r.*, oi.created_at AS original_date
      FROM return_invoices r
      JOIN invoices oi ON oi.id = r.original_invoice_id
      WHERE 1=1`;
    const params = [];
    if (from) { sql += ' AND DATE(r.created_at) >= ?'; params.push(from); }
    if (to)   { sql += ' AND DATE(r.created_at) <= ?'; params.push(to); }
    sql += ' ORDER BY r.created_at DESC';

    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/returns/:id  — تفاصيل مرتجع
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const [[ret]] = await db.query(
      'SELECT * FROM return_invoices WHERE id = ?',
      [req.params.id]
    );
    if (!ret) return res.status(404).json({ success: false, message: 'المرتجع غير موجود' });

    const [items] = await db.query(
      'SELECT * FROM return_invoice_items WHERE return_invoice_id = ?',
      [req.params.id]
    );
    res.json({ success: true, data: { ...ret, items } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
