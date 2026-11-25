// routes/reports.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ success: false, message: 'غير مصرح' });
}

// ── GET /api/reports/profit-loss?from=&to=
// تقرير الأرباح والخسائر
router.get('/profit-loss', requireAuth, async (req, res) => {
  try {
    const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                                      .toISOString().split('T')[0];
    const to   = req.query.to   || new Date().toISOString().split('T')[0];

    // إيرادات المبيعات
    const [[sales]] = await db.query(
      `SELECT
         COALESCE(SUM(total), 0)            AS total_sales,
         COALESCE(SUM(discount), 0)         AS total_discounts,
         COUNT(*)                           AS invoice_count
       FROM invoices
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to]
    );

    // تكلفة البضاعة المباعة (COGS)
    const [[cogs]] = await db.query(
      `SELECT COALESCE(SUM(ii.quantity * p.price), 0) AS total_cogs
       FROM invoice_items ii
       JOIN invoices inv ON inv.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       WHERE DATE(inv.created_at) BETWEEN ? AND ?`,
      [from, to]
    );

    // المرتجعات
    const [[returns_]] = await db.query(
      `SELECT COALESCE(SUM(total_refund), 0) AS total_returns
       FROM return_invoices
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to]
    );

    // المصروفات — مجمعة حسب الفئة
    const [expensesByCategory] = await db.query(
      `SELECT category,
              SUM(amount) AS total,
              COUNT(*)    AS count
       FROM expenses
       WHERE expense_date BETWEEN ? AND ?
       GROUP BY category
       ORDER BY total DESC`,
      [from, to]
    );
    const total_expenses = expensesByCategory.reduce((s, e) => s + parseFloat(e.total), 0);

    // حساب الأرباح
    const net_sales      = parseFloat(sales.total_sales) - parseFloat(returns_.total_returns);
    const gross_profit   = net_sales - parseFloat(cogs.total_cogs);
    const net_profit     = gross_profit - total_expenses;
    const gross_margin   = net_sales > 0 ? ((gross_profit / net_sales) * 100).toFixed(1) : 0;
    const net_margin     = net_sales > 0 ? ((net_profit   / net_sales) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        period: { from, to },
        revenue: {
          total_sales:     parseFloat(sales.total_sales),
          total_discounts: parseFloat(sales.total_discounts),
          total_returns:   parseFloat(returns_.total_returns),
          net_sales,
          invoice_count:   sales.invoice_count
        },
        cost: {
          total_cogs: parseFloat(cogs.total_cogs)
        },
        gross_profit,
        gross_margin: parseFloat(gross_margin),
        expenses: {
          by_category: expensesByCategory,
          total: total_expenses
        },
        net_profit,
        net_margin: parseFloat(net_margin)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/reports/products?from=&to=&limit=50
// تقرير الأصناف: الأكثر مبيعاً + الراكدة
router.get('/products', requireAuth, async (req, res) => {
  try {
    const from  = req.query.from  || new Date(Date.now() - 90*24*60*60*1000).toISOString().split('T')[0];
    const to    = req.query.to    || new Date().toISOString().split('T')[0];
    const limit = parseInt(req.query.limit) || 100;

    // كل الأصناف مع إحصائيات المبيعات في الفترة
    const [products] = await db.query(
      `SELECT
         p.id,
         p.name,
         p.barcode,
         p.stock,
         p.price           AS sell_price,
         COALESCE(s.qty_sold,    0) AS qty_sold,
         COALESCE(s.revenue,     0) AS revenue,
         COALESCE(s.times_sold,  0) AS times_sold
       FROM products p
       LEFT JOIN (
         SELECT
           ii.product_id,
           SUM(ii.quantity)                AS qty_sold,
           SUM(ii.quantity * ii.unit_price) AS revenue,
           COUNT(DISTINCT ii.invoice_id)   AS times_sold
         FROM invoice_items ii
         JOIN invoices inv ON inv.id = ii.invoice_id
         WHERE DATE(inv.created_at) BETWEEN ? AND ?
         GROUP BY ii.product_id
       ) s ON s.product_id = p.id
       WHERE p.active = 1 OR p.active IS NULL
       ORDER BY qty_sold DESC
       LIMIT ?`,
      [from, to, limit]
    );

    const top_sellers = products.filter(p => p.qty_sold > 0);
    const dormant     = products.filter(p => p.qty_sold === 0);

    res.json({
      success: true,
      data: {
        period: { from, to },
        top_sellers,
        dormant,
        summary: {
          total_products: products.length,
          active_products: top_sellers.length,
          dormant_products: dormant.length
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/reports/expenses?from=&to=
router.get('/expenses', requireAuth, async (req, res) => {
  try {
    const from = req.query.from || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const to   = req.query.to   || new Date().toISOString().split('T')[0];

    const [rows] = await db.query(
      `SELECT * FROM expenses
       WHERE expense_date BETWEEN ? AND ?
       ORDER BY expense_date DESC`,
      [from, to]
    );
    const [[total]] = await db.query(
      'SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE expense_date BETWEEN ? AND ?',
      [from, to]
    );

    res.json({ success: true, data: rows, total: parseFloat(total.total) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/reports/expenses  — إضافة مصروف
router.post('/expenses', requireAuth, async (req, res) => {
  try {
    const { category, amount, expense_date, description } = req.body;
    if (!category || !amount || !expense_date)
      return res.status(400).json({ success: false, message: 'البيانات ناقصة' });

    await db.query(
      `INSERT INTO expenses (category, amount, expense_date, description, created_by)
       VALUES (?,?,?,?,?)`,
      [category, amount, expense_date, description || '', req.session.user.id]
    );
    res.json({ success: true, message: 'تم إضافة المصروف' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/reports/expenses/:id
router.delete('/expenses/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'تم الحذف' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
