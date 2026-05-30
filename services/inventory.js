const DOCUMENT_TYPES = {
  addition: {
    label: 'إذن إضافة',
    stockSign: 1,
    debtSign: 1,
    partnerType: 'supplier',
    prefix: 'ADD'
  },
  issue: {
    label: 'إذن صرف',
    stockSign: -1,
    debtSign: 1,
    partnerType: 'customer',
    prefix: 'ISS'
  },
  customer_return: {
    label: 'مرتجع عميل',
    stockSign: 1,
    debtSign: -1,
    partnerType: 'customer',
    prefix: 'CRT'
  },
  supplier_return: {
    label: 'مرتجع مورد',
    stockSign: -1,
    debtSign: -1,
    partnerType: 'supplier',
    prefix: 'SRT'
  },
  invoice_sale: {
    label: 'صرف مبيعات',
    stockSign: -1,
    debtSign: 0,
    partnerType: null,
    prefix: 'SAL'
  },
  adjustment_in: {
    label: 'تسوية زيادة',
    stockSign: 1,
    debtSign: 0,
    partnerType: null,
    prefix: 'AIN'
  },
  adjustment_out: {
    label: 'تسوية عجز',
    stockSign: -1,
    debtSign: 0,
    partnerType: null,
    prefix: 'AOT'
  }
};

const MANUAL_DOCUMENT_TYPES = ['addition', 'issue', 'customer_return', 'supplier_return'];

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

function generateReferenceNumber(prefix = 'DOC') {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = Date.now().toString().slice(-6);
  return `${prefix}-${date}-${time}`;
}

function generateDocumentNumber(documentType = 'generic') {
  const prefix = DOCUMENT_TYPES[documentType]?.prefix || 'DOC';
  return generateReferenceNumber(prefix);
}

function generateTransferNumber() {
  return generateReferenceNumber('TRF');
}

async function getSetting(conn, key) {
  const [[row]] = await conn.query(
    'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
    [key]
  );
  return row?.value ?? null;
}

async function setSetting(conn, key, value) {
  await conn.query(
    'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [key, String(value ?? '')]
  );
}

async function getPrimaryWarehouse(conn, { lock = false } = {}) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [rows] = await conn.query(
    `SELECT * FROM warehouses WHERE active = 1 ORDER BY is_primary DESC, id ASC LIMIT 1${suffix}`
  );
  return rows[0] || null;
}

async function getWarehouseById(conn, warehouseId, { lock = false } = {}) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [rows] = await conn.query(
    `SELECT * FROM warehouses WHERE id = ? LIMIT 1${suffix}`,
    [warehouseId]
  );
  return rows[0] || null;
}

async function getSalesWarehouse(conn, { lock = false } = {}) {
  const configuredId = Number(await getSetting(conn, 'sales_warehouse_id'));
  if (configuredId > 0) {
    const configuredWarehouse = await getWarehouseById(conn, configuredId, { lock });
    if (configuredWarehouse?.active) {
      return configuredWarehouse;
    }
  }

  const primaryWarehouse = await getPrimaryWarehouse(conn, { lock });
  if (primaryWarehouse) {
    await setSetting(conn, 'sales_warehouse_id', primaryWarehouse.id);
  }
  return primaryWarehouse;
}

async function getMainWarehouse(conn, { lock = false } = {}) {
  const warehouse = await getPrimaryWarehouse(conn, { lock });
  if (warehouse) {
    await setSetting(conn, 'sales_warehouse_id', warehouse.id);
  }
  return warehouse;
}

async function ensureWarehouseStockRows(conn, warehouseId, productIds) {
  const normalizedIds = [...new Set(
    (productIds || [])
      .map((productId) => Number(productId))
      .filter((productId) => Number.isInteger(productId) && productId > 0)
  )];

  if (!normalizedIds.length) return;

  const placeholders = normalizedIds.map(() => '(?, ?, 0)').join(', ');
  const params = [];
  for (const productId of normalizedIds) {
    params.push(warehouseId, productId);
  }

  await conn.query(
    `INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE quantity = quantity`,
    params
  );
}

async function syncProductStocks(conn, productIds) {
  const normalizedIds = [...new Set(
    (productIds || [])
      .map((productId) => Number(productId))
      .filter((productId) => Number.isInteger(productId) && productId > 0)
  )];

  if (!normalizedIds.length) return;

  const [rows] = await conn.query(
    `SELECT p.id AS product_id, COALESCE(SUM(ws.quantity), 0) AS total_stock
     FROM products p
     LEFT JOIN warehouse_stock ws ON ws.product_id = p.id
     WHERE p.id IN (?)
     GROUP BY p.id`,
    [normalizedIds]
  );

  const stockMap = new Map(
    rows.map((row) => [Number(row.product_id), roundQty(row.total_stock)])
  );

  for (const productId of normalizedIds) {
    await conn.query(
      'UPDATE products SET stock = ? WHERE id = ?',
      [stockMap.get(productId) || 0, productId]
    );
  }
}

async function getLockedWarehouseProducts(conn, warehouseId, productIds) {
  const normalizedIds = [...new Set(
    (productIds || [])
      .map((productId) => Number(productId))
      .filter((productId) => Number.isInteger(productId) && productId > 0)
  )];

  if (!normalizedIds.length) {
    return [];
  }

  await ensureWarehouseStockRows(conn, warehouseId, normalizedIds);

  const [rows] = await conn.query(
    `SELECT
       ws.product_id,
       ws.quantity,
       p.name,
       p.active
     FROM warehouse_stock ws
     INNER JOIN products p ON p.id = ws.product_id
     WHERE ws.warehouse_id = ? AND ws.product_id IN (?)
     FOR UPDATE`,
    [warehouseId, normalizedIds]
  );

  return rows;
}

async function validatePartner(conn, partnerId, expectedType) {
  if (!partnerId) return null;

  const [[partner]] = await conn.query(
    'SELECT * FROM partners WHERE id = ? FOR UPDATE',
    [partnerId]
  );

  if (!partner || !partner.active) {
    throw new Error('PARTNER_NOT_FOUND');
  }

  if (expectedType && partner.type !== expectedType) {
    throw new Error('PARTNER_TYPE_MISMATCH');
  }

  return partner;
}

function normalizeDocumentItemsPayload(items) {
  const normalizedItems = Array.isArray(items) ? items.map((item) => ({
    product_id: Number(item.product_id),
    product_name: String(item.product_name || '').trim(),
    quantity: roundQty(item.quantity),
    unit_price: roundMoney(item.unit_price),
    line_total: roundMoney(roundQty(item.quantity) * roundMoney(item.unit_price))
  })) : [];

  const invalidItem = normalizedItems.find((item) => (
    !Number.isInteger(item.product_id) ||
    item.product_id <= 0 ||
    !item.product_name ||
    item.quantity <= 0 ||
    item.unit_price < 0
  ));

  if (!normalizedItems.length) {
    throw new Error('EMPTY_DOCUMENT_ITEMS');
  }

  if (invalidItem) {
    throw new Error('INVALID_DOCUMENT_ITEM');
  }

  return normalizedItems;
}

async function createStockDocument(conn, payload) {
  const config = DOCUMENT_TYPES[payload.documentType];
  if (!config) {
    throw new Error('INVALID_DOCUMENT_TYPE');
  }

  const warehouseId = Number(payload.warehouseId);
  if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
    throw new Error('INVALID_WAREHOUSE');
  }

  const warehouse = await getWarehouseById(conn, warehouseId, { lock: true });
  if (!warehouse || !warehouse.active) {
    throw new Error('WAREHOUSE_NOT_FOUND');
  }

  const normalizedItems = normalizeDocumentItemsPayload(payload.items);

  const partnerId = payload.partnerId ? Number(payload.partnerId) : null;
  await validatePartner(conn, partnerId, config.partnerType);

  const productIds = normalizedItems.map((item) => item.product_id);
  const productRows = await getLockedWarehouseProducts(conn, warehouseId, productIds);
  const productMap = new Map(productRows.map((row) => [Number(row.product_id), row]));

  for (const item of normalizedItems) {
    const product = productMap.get(item.product_id);
    if (!product) {
      throw new Error(`PRODUCT_NOT_FOUND:${item.product_name}`);
    }

    if (!Number(product.active) && payload.documentType === 'invoice_sale') {
      throw new Error(`PRODUCT_NOT_FOUND:${item.product_name}`);
    }

    const currentQty = roundQty(product.quantity);
    if (config.stockSign < 0 && currentQty < item.quantity) {
      throw new Error(`INSUFFICIENT_STOCK:${product.name}`);
    }
  }

  const subtotal = roundMoney(
    normalizedItems.reduce((sum, item) => sum + item.line_total, 0)
  );
  const paidAmount = roundMoney(Math.max(0, toNumber(payload.paidAmount)));

  if (paidAmount > subtotal) {
    throw new Error('INVALID_PAID_AMOUNT');
  }

  const debtDelta = config.debtSign === 0
    ? 0
    : roundMoney(config.debtSign * Math.max(0, subtotal - paidAmount));

  const documentNumber = payload.documentNumber || generateDocumentNumber(payload.documentType);
  const [documentResult] = await conn.query(
    `INSERT INTO stock_documents
       (document_number, document_type, warehouse_id, partner_id, subtotal, paid_amount,
        debt_delta, notes, reference_type, reference_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      documentNumber,
      payload.documentType,
      warehouseId,
      partnerId,
      subtotal,
      paidAmount,
      debtDelta,
      String(payload.notes || '').trim(),
      payload.referenceType || null,
      payload.referenceId || null,
      payload.createdBy || null
    ]
  );

  for (const item of normalizedItems) {
    await conn.query(
      `INSERT INTO stock_document_items
         (document_id, product_id, product_name, quantity, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        documentResult.insertId,
        item.product_id,
        item.product_name,
        item.quantity,
        item.unit_price,
        item.line_total
      ]
    );

    await conn.query(
      `UPDATE warehouse_stock
       SET quantity = quantity + ?
       WHERE warehouse_id = ? AND product_id = ?`,
      [roundQty(config.stockSign * item.quantity), warehouseId, item.product_id]
    );
  }

  await syncProductStocks(conn, productIds);

  if (partnerId && debtDelta !== 0) {
    await conn.query(
      `INSERT INTO partner_ledger
         (partner_id, source_type, source_id, amount, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        partnerId,
        'document',
        documentResult.insertId,
        debtDelta,
        String(payload.notes || '').trim() || config.label,
        payload.createdBy || null
      ]
    );
  }

  return {
    id: documentResult.insertId,
    document_number: documentNumber,
    subtotal,
    paid_amount: paidAmount,
    debt_delta: debtDelta
  };
}

async function updateStockDocument(conn, documentId, payload) {
  const [[existingDocument]] = await conn.query(
    'SELECT * FROM stock_documents WHERE id = ? FOR UPDATE',
    [documentId]
  );

  if (!existingDocument) {
    throw new Error('DOCUMENT_NOT_FOUND');
  }

  const oldConfig = DOCUMENT_TYPES[existingDocument.document_type];
  const newConfig = DOCUMENT_TYPES[payload.documentType];

  if (!oldConfig || !newConfig) {
    throw new Error('INVALID_DOCUMENT_TYPE');
  }

  const newWarehouseId = Number(payload.warehouseId);
  if (!Number.isInteger(newWarehouseId) || newWarehouseId <= 0) {
    throw new Error('INVALID_WAREHOUSE');
  }

  const warehouse = await getWarehouseById(conn, newWarehouseId, { lock: true });
  if (!warehouse || !warehouse.active) {
    throw new Error('WAREHOUSE_NOT_FOUND');
  }

  const normalizedItems = normalizeDocumentItemsPayload(payload.items);
  const partnerId = payload.partnerId ? Number(payload.partnerId) : null;
  await validatePartner(conn, partnerId, newConfig.partnerType);

  const [existingItems] = await conn.query(
    'SELECT * FROM stock_document_items WHERE document_id = ?',
    [documentId]
  );

  const warehouseProductIds = new Map();
  const addWarehouseProductIds = (warehouseId, items) => {
    const key = Number(warehouseId);
    const current = warehouseProductIds.get(key) || [];
    current.push(...items.map((item) => Number(item.product_id)).filter(Boolean));
    warehouseProductIds.set(key, current);
  };

  addWarehouseProductIds(existingDocument.warehouse_id, existingItems);
  addWarehouseProductIds(newWarehouseId, normalizedItems);

  const stockState = new Map();
  for (const [warehouseId, productIds] of warehouseProductIds.entries()) {
    const rows = await getLockedWarehouseProducts(conn, warehouseId, productIds);
    for (const row of rows) {
      stockState.set(`${warehouseId}:${Number(row.product_id)}`, row);
    }
  }

  for (const item of normalizedItems) {
    const product = stockState.get(`${newWarehouseId}:${item.product_id}`);
    if (!product) {
      throw new Error(`PRODUCT_NOT_FOUND:${item.product_name}`);
    }

    if (!Number(product.active) && payload.documentType === 'invoice_sale') {
      throw new Error(`PRODUCT_NOT_FOUND:${item.product_name}`);
    }
  }

  const deltaMap = new Map();
  const applyDelta = (warehouseId, productId, qtyDelta, productName) => {
    const key = `${Number(warehouseId)}:${Number(productId)}`;
    const current = deltaMap.get(key) || {
      warehouseId: Number(warehouseId),
      productId: Number(productId),
      quantityDelta: 0,
      productName
    };
    current.quantityDelta = roundQty(current.quantityDelta + qtyDelta);
    deltaMap.set(key, current);
  };

  for (const item of existingItems) {
    applyDelta(
      existingDocument.warehouse_id,
      item.product_id,
      roundQty(-oldConfig.stockSign * Number(item.quantity)),
      item.product_name
    );
  }

  for (const item of normalizedItems) {
    applyDelta(
      newWarehouseId,
      item.product_id,
      roundQty(newConfig.stockSign * item.quantity),
      item.product_name
    );
  }

  for (const change of deltaMap.values()) {
    const product = stockState.get(`${change.warehouseId}:${change.productId}`);
    const currentQty = roundQty(product?.quantity || 0);
    const nextQty = roundQty(currentQty + change.quantityDelta);
    if (nextQty < 0) {
      throw new Error(`INSUFFICIENT_STOCK:${change.productName}`);
    }
  }

  const subtotal = roundMoney(
    normalizedItems.reduce((sum, item) => sum + item.line_total, 0)
  );
  const paidAmount = roundMoney(Math.max(0, toNumber(payload.paidAmount)));

  if (paidAmount > subtotal) {
    throw new Error('INVALID_PAID_AMOUNT');
  }

  const debtDelta = newConfig.debtSign === 0
    ? 0
    : roundMoney(newConfig.debtSign * Math.max(0, subtotal - paidAmount));

  await conn.query(
    `UPDATE stock_documents
     SET document_type = ?, warehouse_id = ?, partner_id = ?, subtotal = ?, paid_amount = ?,
         debt_delta = ?, notes = ?, created_by = ?
     WHERE id = ?`,
    [
      payload.documentType,
      newWarehouseId,
      partnerId,
      subtotal,
      paidAmount,
      debtDelta,
      String(payload.notes || '').trim(),
      payload.createdBy || existingDocument.created_by || null,
      documentId
    ]
  );

  for (const change of deltaMap.values()) {
    if (!change.quantityDelta) continue;
    await conn.query(
      `UPDATE warehouse_stock
       SET quantity = quantity + ?
       WHERE warehouse_id = ? AND product_id = ?`,
      [change.quantityDelta, change.warehouseId, change.productId]
    );
  }

  await conn.query('DELETE FROM stock_document_items WHERE document_id = ?', [documentId]);

  for (const item of normalizedItems) {
    await conn.query(
      `INSERT INTO stock_document_items
         (document_id, product_id, product_name, quantity, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        documentId,
        item.product_id,
        item.product_name,
        item.quantity,
        item.unit_price,
        item.line_total
      ]
    );
  }

  await conn.query(
    'DELETE FROM partner_ledger WHERE source_type = ? AND source_id = ?',
    ['document', documentId]
  );

  if (partnerId && debtDelta !== 0) {
    await conn.query(
      `INSERT INTO partner_ledger
         (partner_id, source_type, source_id, amount, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        partnerId,
        'document',
        documentId,
        debtDelta,
        String(payload.notes || '').trim() || newConfig.label,
        payload.createdBy || existingDocument.created_by || null
      ]
    );
  }

  await syncProductStocks(conn, [
    ...new Set([
      ...existingItems.map((item) => Number(item.product_id)),
      ...normalizedItems.map((item) => Number(item.product_id))
    ].filter(Boolean))
  ]);

  return {
    id: documentId,
    document_number: existingDocument.document_number,
    subtotal,
    paid_amount: paidAmount,
    debt_delta: debtDelta
  };
}

async function reverseDocument(conn, documentId) {
  const [[document]] = await conn.query(
    'SELECT * FROM stock_documents WHERE id = ? FOR UPDATE',
    [documentId]
  );

  if (!document) {
    return;
  }

  const config = DOCUMENT_TYPES[document.document_type];
  if (!config) {
    throw new Error('INVALID_DOCUMENT_TYPE');
  }

  const [items] = await conn.query(
    'SELECT * FROM stock_document_items WHERE document_id = ?',
    [documentId]
  );

  const productIds = items.map((item) => Number(item.product_id)).filter(Boolean);
  const productRows = await getLockedWarehouseProducts(conn, document.warehouse_id, productIds);
  const productMap = new Map(productRows.map((row) => [Number(row.product_id), row]));

  for (const item of items) {
    const productId = Number(item.product_id);
    const reverseQty = roundQty(-config.stockSign * Number(item.quantity));
    if (reverseQty < 0) {
      const product = productMap.get(productId);
      const currentQty = roundQty(product?.quantity || 0);
      if (currentQty < Math.abs(reverseQty)) {
        throw new Error(`INSUFFICIENT_STOCK:${item.product_name}`);
      }
    }

    await conn.query(
      `UPDATE warehouse_stock
       SET quantity = quantity + ?
       WHERE warehouse_id = ? AND product_id = ?`,
      [reverseQty, document.warehouse_id, productId]
    );
  }

  await syncProductStocks(conn, productIds);
  await conn.query(
    'DELETE FROM partner_ledger WHERE source_type = ? AND source_id = ?',
    ['document', documentId]
  );
  await conn.query('DELETE FROM stock_document_items WHERE document_id = ?', [documentId]);
  await conn.query('DELETE FROM stock_documents WHERE id = ?', [documentId]);
}

async function replaceReferenceDocument(conn, payload) {
  if (!payload.referenceType || !payload.referenceId) {
    throw new Error('INVALID_REFERENCE');
  }

  const [[existingDocument]] = await conn.query(
    `SELECT id
     FROM stock_documents
     WHERE reference_type = ? AND reference_id = ?
     LIMIT 1
     FOR UPDATE`,
    [payload.referenceType, payload.referenceId]
  );

  if (existingDocument) {
    await reverseDocument(conn, existingDocument.id);
  }

  return createStockDocument(conn, payload);
}

async function createStockCount(conn, payload) {
  const warehouseId = Number(payload.warehouseId);
  if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
    throw new Error('INVALID_WAREHOUSE');
  }

  const warehouse = await getWarehouseById(conn, warehouseId, { lock: true });
  if (!warehouse || !warehouse.active) {
    throw new Error('WAREHOUSE_NOT_FOUND');
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    throw new Error('EMPTY_COUNT_ITEMS');
  }

  const normalizedItems = items.map((item) => ({
    product_id: Number(item.product_id),
    product_name: String(item.product_name || '').trim(),
    actual_quantity: roundQty(item.actual_quantity),
    unit_price: roundMoney(item.unit_price)
  }));

  const invalidItem = normalizedItems.find((item) => (
    !Number.isInteger(item.product_id) ||
    item.product_id <= 0 ||
    !item.product_name ||
    item.actual_quantity < 0 ||
    item.unit_price < 0
  ));

  if (invalidItem) {
    throw new Error('INVALID_COUNT_ITEM');
  }

  const productIds = normalizedItems.map((item) => item.product_id);
  const productRows = await getLockedWarehouseProducts(conn, warehouseId, productIds);
  const productMap = new Map(productRows.map((row) => [Number(row.product_id), row]));

  for (const item of normalizedItems) {
    const product = productMap.get(item.product_id);
    if (!product) {
      throw new Error(`PRODUCT_NOT_FOUND:${item.product_name}`);
    }
  }

  const countNumber = payload.countNumber || generateReferenceNumber('CNT');
  const [countResult] = await conn.query(
    `INSERT INTO stock_counts
       (count_number, warehouse_id, notes, created_by, applied_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      countNumber,
      warehouseId,
      String(payload.notes || '').trim(),
      payload.createdBy || null
    ]
  );

  let totalDifferenceQuantity = 0;
  let totalDifferenceValue = 0;

  for (const item of normalizedItems) {
    const product = productMap.get(item.product_id);
    const systemQuantity = roundQty(product.quantity);
    const differenceQuantity = roundQty(item.actual_quantity - systemQuantity);
    const differenceValue = roundMoney(differenceQuantity * item.unit_price);

    totalDifferenceQuantity += differenceQuantity;
    totalDifferenceValue += differenceValue;

    await conn.query(
      `INSERT INTO stock_count_items
         (stock_count_id, product_id, product_name, system_quantity, actual_quantity,
          difference_quantity, unit_price, difference_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        countResult.insertId,
        item.product_id,
        item.product_name,
        systemQuantity,
        item.actual_quantity,
        differenceQuantity,
        item.unit_price,
        differenceValue
      ]
    );

    await conn.query(
      `UPDATE warehouse_stock
       SET quantity = ?
       WHERE warehouse_id = ? AND product_id = ?`,
      [item.actual_quantity, warehouseId, item.product_id]
    );
  }

  await syncProductStocks(conn, productIds);

  return {
    id: countResult.insertId,
    count_number: countNumber,
    total_difference_quantity: roundQty(totalDifferenceQuantity),
    total_difference_value: roundMoney(totalDifferenceValue)
  };
}

async function createStockTransfer(conn, payload) {
  const fromWarehouseId = Number(payload.fromWarehouseId);
  const toWarehouseId = Number(payload.toWarehouseId);

  if (!Number.isInteger(fromWarehouseId) || fromWarehouseId <= 0 ||
      !Number.isInteger(toWarehouseId) || toWarehouseId <= 0 ||
      fromWarehouseId === toWarehouseId) {
    throw new Error('INVALID_TRANSFER_WAREHOUSES');
  }

  const [warehouses] = await conn.query(
    'SELECT * FROM warehouses WHERE id IN (?) AND active = 1 FOR UPDATE',
    [[fromWarehouseId, toWarehouseId]]
  );
  const warehouseMap = new Map(warehouses.map((warehouse) => [Number(warehouse.id), warehouse]));

  if (!warehouseMap.has(fromWarehouseId) || !warehouseMap.has(toWarehouseId)) {
    throw new Error('WAREHOUSE_NOT_FOUND');
  }

  const normalizedItems = normalizeDocumentItemsPayload(payload.items);
  const productIds = normalizedItems.map((item) => item.product_id);

  await ensureWarehouseStockRows(conn, fromWarehouseId, productIds);
  await ensureWarehouseStockRows(conn, toWarehouseId, productIds);

  const sourceProducts = await getLockedWarehouseProducts(conn, fromWarehouseId, productIds);
  const productMap = new Map(sourceProducts.map((row) => [Number(row.product_id), row]));

  for (const item of normalizedItems) {
    const product = productMap.get(item.product_id);
    if (!product) {
      throw new Error(`PRODUCT_NOT_FOUND:${item.product_name}`);
    }

    if (roundQty(product.quantity) < item.quantity) {
      throw new Error(`INSUFFICIENT_STOCK:${product.name}`);
    }
  }

  const transferNumber = payload.transferNumber || generateTransferNumber();
  const [transferResult] = await conn.query(
    `INSERT INTO stock_transfers
       (transfer_number, from_warehouse_id, to_warehouse_id, notes, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [
      transferNumber,
      fromWarehouseId,
      toWarehouseId,
      String(payload.notes || '').trim(),
      payload.createdBy || null
    ]
  );

  for (const item of normalizedItems) {
    await conn.query(
      `INSERT INTO stock_transfer_items
         (transfer_id, product_id, product_name, quantity, unit_price)
       VALUES (?, ?, ?, ?, ?)`,
      [transferResult.insertId, item.product_id, item.product_name, item.quantity, item.unit_price]
    );

    await conn.query(
      `UPDATE warehouse_stock
       SET quantity = quantity - ?
       WHERE warehouse_id = ? AND product_id = ?`,
      [item.quantity, fromWarehouseId, item.product_id]
    );

    await conn.query(
      `UPDATE warehouse_stock
       SET quantity = quantity + ?
       WHERE warehouse_id = ? AND product_id = ?`,
      [item.quantity, toWarehouseId, item.product_id]
    );
  }

  await syncProductStocks(conn, productIds);

  return {
    id: transferResult.insertId,
    transfer_number: transferNumber
  };
}

module.exports = {
  DOCUMENT_TYPES,
  MANUAL_DOCUMENT_TYPES,
  createStockDocument,
  createStockTransfer,
  createStockCount,
  generateDocumentNumber,
  getPrimaryWarehouse,
  getMainWarehouse,
  getSalesWarehouse,
  replaceReferenceDocument,
  reverseDocument,
  updateStockDocument,
  roundMoney,
  roundQty,
  setSetting,
  syncProductStocks
};
