const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { getSalesWarehouse, replaceReferenceDocument, reverseDocument } = require('../services/inventory');

const router = express.Router();

function isAdminUser(req) {
  return req.session?.user?.role === 'admin';
}

function appendCashierScope(req, whereParts, params, column = 'i.cashier_id') {
  if (!isAdminUser(req)) {
    whereParts.push(`${column} = ?`);
    params.push(req.session.user.id);
  }
}

function generateInvoiceNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = Date.now().toString().slice(-6);
  return `INV-${date}-${time}`;
}

function normalizeInvoiceItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return { error: 'لا توجد منتجات في الفاتورة' };
  }

  const normalizedItems = [];

  for (const rawItem of items) {
    const quantity = Number(rawItem.quantity);
    const unitPrice = Number(rawItem.unit_price);
    const productName = String(rawItem.product_name || '').trim();
    const productId = rawItem.product_id ? Number(rawItem.product_id) : null;
    const barcode = String(rawItem.barcode || '').trim() || null;

    if (!productName) {
      return { error: 'اسم المنتج مطلوب في كل بند' };
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: 'كمية المنتج غير صالحة' };
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return { error: 'سعر المنتج غير صالح' };
    }

    if (productId !== null && (!Number.isInteger(productId) || productId <= 0)) {
      return { error: 'معرف المنتج غير صالح' };
    }

    normalizedItems.push({
      product_id: productId,
      product_name: productName,
      barcode,
      quantity,
      unit_price: unitPrice,
      subtotal: unitPrice * quantity
    });
  }

  return { data: normalizedItems };
}

function normalizePaymentMethod(value) {
  const paymentMethod = String(value || 'cash').trim().toLowerCase() || 'cash';
  return ['cash', 'card', 'other'].includes(paymentMethod) ? paymentMethod : null;
}

function normalizeInvoicePayload(body = {}) {
  const normalized = normalizeInvoiceItems(body.items);
  if (normalized.error) {
    return { error: normalized.error };
  }

  const discount = Math.max(0, Number(body.discount) || 0);
  const paymentMethod = normalizePaymentMethod(body.payment_method);
  const notes = String(body.notes || '').trim();
  const total = normalized.data.reduce((sum, item) => sum + item.subtotal, 0);
  const netTotal = Math.max(0, total - discount);
  const paidAmountInput = body.paid_amount;
  const paidAmount = paidAmountInput === undefined || paidAmountInput === null || paidAmountInput === ''
    ? netTotal
    : Number(paidAmountInput);

  if (!paymentMethod) {
    return { error: 'طريقة الدفع غير صالحة' };
  }

  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    return { error: 'المبلغ المدفوع غير صالح' };
  }

  const finalPaidAmount = Math.max(netTotal, paidAmount);

  return {
    data: {
      items: normalized.data,
      discount,
      paymentMethod,
      notes,
      total,
      netTotal,
      paidAmount: finalPaidAmount,
      changeAmount: Math.max(0, finalPaidAmount - netTotal)
    }
  };
}

function mapInvoiceItemsToStockItems(items) {
  return items
    .filter((item) => item.product_id)
    .map((item) => ({
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price
    }));
}

// POST /api/invoices
router.post('/', requireAuth, async (req, res) => {
  const payload = normalizeInvoicePayload(req.body);
  if (payload.error) {
    return res.status(400).json({ success: false, message: payload.error });
  }

  let conn;

  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const salesWarehouse = await getSalesWarehouse(conn, { lock: true });
    if (!salesWarehouse) {
      throw new Error('WAREHOUSE_NOT_FOUND');
    }

    const invoiceNumber = generateInvoiceNumber();
    const [invoiceResult] = await conn.query(
      `INSERT INTO invoices
         (invoice_number, total, discount, net_total, paid_amount, change_amount,
          payment_method, items_count, notes, cashier_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceNumber,
        payload.data.total,
        payload.data.discount,
        payload.data.netTotal,
        payload.data.paidAmount,
        payload.data.changeAmount,
        payload.data.paymentMethod,
        payload.data.items.length,
        payload.data.notes,
        req.session.user.id
      ]
    );

    for (const item of payload.data.items) {
      await conn.query(
        `INSERT INTO invoice_items
           (invoice_id, product_id, product_name, barcode, unit_price, quantity, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceResult.insertId,
          item.product_id,
          item.product_name,
          item.barcode,
          item.unit_price,
          item.quantity,
          item.subtotal
        ]
      );
    }

    await replaceReferenceDocument(conn, {
      referenceType: 'invoice',
      referenceId: invoiceResult.insertId,
      documentType: 'invoice_sale',
      warehouseId: salesWarehouse.id,
      paidAmount: payload.data.netTotal,
      notes: `حركة بيع مرتبطة بالفاتورة ${invoiceNumber}`,
      items: mapInvoiceItemsToStockItems(payload.data.items),
      createdBy: req.session.user.id
    });

    await conn.commit();
    res.status(201).json({
      success: true,
      invoice: {
        id: invoiceResult.insertId,
        invoice_number: invoiceNumber,
        net_total: payload.data.netTotal,
        change_amount: payload.data.changeAmount
      },
      message: 'تم حفظ الفاتورة بنجاح'
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error(error);

    if (error.message === 'WAREHOUSE_NOT_FOUND') {
      return res.status(500).json({ success: false, message: 'لا يوجد مخزن بيع رئيسي مضبوط للنظام' });
    }

    if (error.message?.startsWith('PRODUCT_NOT_FOUND:')) {
      return res.status(400).json({
        success: false,
        message: `المنتج غير متاح للبيع: ${error.message.split(':')[1]}`
      });
    }

    if (error.message?.startsWith('INSUFFICIENT_STOCK:')) {
      return res.status(400).json({
        success: false,
        message: `الكمية غير متوفرة في مخزن البيع: ${error.message.split(':')[1]}`
      });
    }

    res.status(500).json({ success: false, message: 'فشل في حفظ الفاتورة' });
  } finally {
    if (conn) conn.release();
  }
});

// PUT /api/invoices/:id
router.put('/:id', requireAuth, async (req, res) => {
  const invoiceId = Number(req.params.id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف الفاتورة غير صالح' });
  }

  const payload = normalizeInvoicePayload(req.body);
  if (payload.error) {
    return res.status(400).json({ success: false, message: payload.error });
  }

  let conn;

  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const invoiceParams = [invoiceId];
    let invoiceQuery = 'SELECT id, invoice_number, cashier_id FROM invoices WHERE id = ?';
    if (!isAdminUser(req)) {
      invoiceQuery += ' AND cashier_id = ?';
      invoiceParams.push(req.session.user.id);
    }
    invoiceQuery += ' FOR UPDATE';

    const [[invoice]] = await conn.query(invoiceQuery, invoiceParams);

    if (!invoice) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
    }

    const salesWarehouse = await getSalesWarehouse(conn, { lock: true });
    if (!salesWarehouse) {
      throw new Error('WAREHOUSE_NOT_FOUND');
    }

    await conn.query(
      `UPDATE invoices
       SET total = ?, discount = ?, net_total = ?, paid_amount = ?, change_amount = ?,
           payment_method = ?, items_count = ?, notes = ?
       WHERE id = ?`,
      [
        payload.data.total,
        payload.data.discount,
        payload.data.netTotal,
        payload.data.paidAmount,
        payload.data.changeAmount,
        payload.data.paymentMethod,
        payload.data.items.length,
        payload.data.notes,
        invoiceId
      ]
    );

    await conn.query('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);

    for (const item of payload.data.items) {
      await conn.query(
        `INSERT INTO invoice_items
           (invoice_id, product_id, product_name, barcode, unit_price, quantity, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          item.product_id,
          item.product_name,
          item.barcode,
          item.unit_price,
          item.quantity,
          item.subtotal
        ]
      );
    }

    await replaceReferenceDocument(conn, {
      referenceType: 'invoice',
      referenceId: invoiceId,
      documentType: 'invoice_sale',
      warehouseId: salesWarehouse.id,
      paidAmount: payload.data.netTotal,
      notes: `تحديث حركة بيع للفواتير ${invoice.invoice_number}`,
      items: mapInvoiceItemsToStockItems(payload.data.items),
      createdBy: req.session.user.id
    });

    await conn.commit();
    res.json({
      success: true,
      data: {
        id: invoiceId,
        invoice_number: invoice.invoice_number,
        net_total: payload.data.netTotal,
        change_amount: payload.data.changeAmount
      },
      message: 'تم تحديث الفاتورة بنجاح'
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error(error);

    if (error.message === 'WAREHOUSE_NOT_FOUND') {
      return res.status(500).json({ success: false, message: 'لا يوجد مخزن بيع رئيسي مضبوط للنظام' });
    }

    if (error.message?.startsWith('PRODUCT_NOT_FOUND:')) {
      return res.status(400).json({
        success: false,
        message: `المنتج غير متاح للبيع: ${error.message.split(':')[1]}`
      });
    }

    if (error.message?.startsWith('INSUFFICIENT_STOCK:')) {
      return res.status(400).json({
        success: false,
        message: `الكمية غير متوفرة في مخزن البيع: ${error.message.split(':')[1]}`
      });
    }

    res.status(500).json({ success: false, message: 'فشل في تحديث الفاتورة' });
  } finally {
    if (conn) conn.release();
  }
});

// DELETE /api/invoices/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const invoiceId = Number(req.params.id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف الفاتورة غير صالح' });
  }

  let conn;

  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const invoiceParams = [invoiceId];
    let invoiceQuery = 'SELECT id, invoice_number, cashier_id FROM invoices WHERE id = ?';
    if (!isAdminUser(req)) {
      invoiceQuery += ' AND cashier_id = ?';
      invoiceParams.push(req.session.user.id);
    }
    invoiceQuery += ' FOR UPDATE';

    const [[invoice]] = await conn.query(invoiceQuery, invoiceParams);

    if (!invoice) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
    }

    const [[stockDocument]] = await conn.query(
      `SELECT id
       FROM stock_documents
       WHERE reference_type = ? AND reference_id = ?
       LIMIT 1
       FOR UPDATE`,
      ['invoice', invoiceId]
    );

    if (stockDocument) {
      await reverseDocument(conn, stockDocument.id);
    }

    await conn.query('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
    await conn.query('DELETE FROM invoices WHERE id = ?', [invoiceId]);

    await conn.commit();
    res.json({ success: true, message: `تم حذف الفاتورة ${invoice.invoice_number} بنجاح` });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error(error);

    if (error.message?.startsWith('INSUFFICIENT_STOCK:')) {
      return res.status(400).json({
        success: false,
        message: `لا يمكن حذف الفاتورة لأن الرصيد الحالي لا يسمح بعكس الحركة: ${error.message.split(':')[1]}`
      });
    }

    res.status(500).json({ success: false, message: 'فشل في حذف الفاتورة' });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/invoices
router.get('/', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const whereParts = [];
    const params = [];

    appendCashierScope(req, whereParts, params);

    if (req.query.from) {
      whereParts.push('DATE(i.created_at) >= ?');
      params.push(req.query.from);
    }

    if (req.query.to) {
      whereParts.push('DATE(i.created_at) <= ?');
      params.push(req.query.to);
    }

    if (req.query.search) {
      whereParts.push('i.invoice_number LIKE ?');
      params.push(`%${req.query.search}%`);
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT i.*, u.full_name AS cashier_name
       FROM invoices i
       LEFT JOIN users u ON i.cashier_id = u.id
       ${where}
       ORDER BY i.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM invoices i ${where}`,
      params
    );

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب الفواتير' });
  }
});

// GET /api/invoices/stats/today
router.get('/stats/today', requireAuth, async (req, res) => {
  try {
    const params = [];
    let statsWhere = 'WHERE DATE(created_at) = CURDATE()';
    if (!isAdminUser(req)) {
      statsWhere += ' AND cashier_id = ?';
      params.push(req.session.user.id);
    }

    const [[stats]] = await db.query(`
      SELECT
        COUNT(*) AS invoices_count,
        COALESCE(SUM(net_total), 0) AS total_sales,
        COALESCE(SUM(items_count), 0) AS items_sold
      FROM invoices
      ${statsWhere}
    `, params);

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب إحصائيات اليوم' });
  }
});

// GET /api/invoices/:id
router.get('/:id', requireAuth, async (req, res) => {
  const invoiceId = Number(req.params.id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ success: false, message: 'معرف الفاتورة غير صالح' });
  }

  try {
    const params = [invoiceId];
    let query = `
      SELECT i.*, u.full_name AS cashier_name
      FROM invoices i
      LEFT JOIN users u ON i.cashier_id = u.id
      WHERE i.id = ?
    `;
    if (!isAdminUser(req)) {
      query += ' AND i.cashier_id = ?';
      params.push(req.session.user.id);
    }

    const [[invoice]] = await db.query(query, params);

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'الفاتورة غير موجودة' });
    }

    const [items] = await db.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ?',
      [invoiceId]
    );

    res.json({ success: true, data: { ...invoice, items } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب الفاتورة' });
  }
});

module.exports = router;
