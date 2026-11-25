const db = require('../config/db');

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundQty(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 1000) / 1000;
}

async function createStockDocument(conn, opts) {
  const { items } = opts;
  for (const item of items) {
    const qtyChange = opts.documentType === 'invoice_sale' || opts.documentType === 'adjustment_out'
      ? -Math.abs(item.quantity)
      : Math.abs(item.quantity);
    await conn.query(
      'UPDATE products SET stock = GREATEST(0, stock + ?) WHERE id = ?',
      [qtyChange, item.product_id]
    );
  }
  return { id: null };
}

async function recordMovement(conn, opts) {
  const { type, invoiceId, items, createdBy } = opts;
  const documentNumber = invoiceId ? `INV-${invoiceId}` : null;
  const notes = opts.notes || '';
  const [movement] = await conn.query(
    `INSERT INTO stock_movements (type, document_number, invoice_id, notes, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [type, documentNumber, invoiceId || null, notes, createdBy]
  );
  const movementId = movement.insertId;
  for (const item of items) {
    await conn.query(
      `INSERT INTO stock_movement_items (movement_id, product_id, product_name, quantity, unit_price, total)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [movementId, item.product_id, item.product_name, item.quantity, item.unit_price || 0, (item.quantity || 0) * (item.unit_price || 0)]
    );
  }
  return movementId;
}

async function replaceReferenceDocument(conn, opts) {
  const oldId = opts.oldDocumentId || opts.referenceId;
  const oldItems = [];
  if (oldId) {
    const [items] = await conn.query(
      'SELECT product_id, COALESCE(product_name,"") AS product_name, quantity, unit_price FROM invoice_items WHERE invoice_id = ?',
      [oldId]
    );
    for (const item of items) {
      await conn.query(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [item.quantity, item.product_id]
      );
      oldItems.push(item);
    }
  }
  if (opts.items) {
    for (const item of opts.items) {
      const [[prod]] = await conn.query(
        'SELECT stock FROM products WHERE id = ? FOR UPDATE',
        [item.product_id]
      );
      if (!prod) throw new Error(`PRODUCT_NOT_FOUND:${item.product_name}`);
      if (prod.stock < item.quantity) {
        throw new Error(`INSUFFICIENT_STOCK:${item.product_name} (المتوفر ${prod.stock}, المطلوب ${item.quantity})`);
      }
      await conn.query(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [item.quantity, item.product_id]
      );
    }
  }
  return oldItems;
}

async function reverseDocument(conn, invoiceId) {
  const [[ret]] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM return_invoices WHERE original_invoice_id = ?',
    [invoiceId]
  );
  if (ret && ret.cnt > 0) {
    throw new Error(`لا يمكن حذف الفاتورة رقم ${invoiceId} لأن لها مرتجعات مسجلة`);
  }
  const [items] = await conn.query(
    'SELECT product_id, COALESCE(product_name,"") AS product_name, quantity, unit_price FROM invoice_items WHERE invoice_id = ?',
    [invoiceId]
  );
  for (const item of items) {
    await conn.query(
      'UPDATE products SET stock = stock + ? WHERE id = ?',
      [item.quantity, item.product_id]
    );
  }
  return items;
}

module.exports = {
  createStockDocument,
  replaceReferenceDocument,
  reverseDocument,
  recordMovement,
  roundMoney,
  roundQty
};
