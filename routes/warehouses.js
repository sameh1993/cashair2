const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  DOCUMENT_TYPES,
  MANUAL_DOCUMENT_TYPES,
  createStockCount,
  createStockDocument,
  getMainWarehouse,
  reverseDocument,
  updateStockDocument,
  roundMoney,
  roundQty
} = require('../services/inventory');

const router = express.Router();

function parsePositiveInt(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function isAdminUser(req) {
  return req.session?.user?.role === 'admin';
}

function shouldScopeToUser(req) {
  return !isAdminUser(req);
}

function normalizeWarehousePayload(body = {}) {
  const name = String(body.name || '').trim();
  const code = String(body.code || '').trim().toUpperCase();
  const location = String(body.location || '').trim();
  const notes = String(body.notes || '').trim();

  if (!name) {
    return { error: 'اسم المخزن مطلوب' };
  }

  if (code && !/^[A-Z0-9_-]+$/.test(code)) {
    return { error: 'كود المخزن يجب أن يحتوي على أحرف وأرقام فقط' };
  }

  return {
    data: {
      name,
      code: code || null,
      location,
      notes
    }
  };
}

function normalizePartnerPayload(body = {}) {
  const name = String(body.name || '').trim();
  const type = String(body.type || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const address = String(body.address || '').trim();
  const notes = String(body.notes || '').trim();

  if (!name) {
    return { error: 'اسم العميل أو المورد مطلوب' };
  }

  if (!['customer', 'supplier'].includes(type)) {
    return { error: 'نوع الطرف غير صالح' };
  }

  return {
    data: {
      name,
      type,
      phone,
      address,
      notes
    }
  };
}

function normalizeDocumentItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return { error: 'أضف صنفًا واحدًا على الأقل' };
  }

  const normalizedItems = [];

  for (const rawItem of items) {
    const productId = parsePositiveInt(rawItem.product_id);
    const productName = String(rawItem.product_name || '').trim();
    const quantity = roundQty(rawItem.quantity);
    const unitPrice = roundMoney(rawItem.unit_price);

    if (!productId || !productName) {
      return { error: 'بيانات الصنف غير مكتملة' };
    }

    if (!(quantity > 0)) {
      return { error: 'كمية الصنف يجب أن تكون أكبر من صفر' };
    }

    if (unitPrice < 0) {
      return { error: 'سعر الصنف غير صالح' };
    }

    normalizedItems.push({
      product_id: productId,
      product_name: productName,
      quantity,
      unit_price: unitPrice
    });
  }

  return { data: normalizedItems };
}

function normalizeDocumentPayload(body = {}) {
  const documentType = String(body.document_type || '').trim();
  const paidAmount = roundMoney(Math.max(0, Number(body.paid_amount) || 0));
  const notes = String(body.notes || '').trim();
  const config = DOCUMENT_TYPES[documentType];

  if (!MANUAL_DOCUMENT_TYPES.includes(documentType) || !config) {
    return { error: 'نوع الإذن غير صالح' };
  }

  const normalizedItems = normalizeDocumentItems(body.items);
  if (normalizedItems.error) {
    return normalizedItems;
  }

  const partnerId = parsePositiveInt(body.partner_id);
  if (config.partnerType && !partnerId) {
    return { error: config.partnerType === 'customer' ? 'اختر العميل' : 'اختر المورد' };
  }

  return {
    data: {
      documentType,
      partnerId,
      paidAmount,
      notes,
      items: normalizedItems.data
    }
  };
}

function normalizeStockCountItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return { error: 'أضف صنفًا واحدًا على الأقل إلى الجرد' };
  }

  const normalizedItems = [];

  for (const rawItem of items) {
    const productId = parsePositiveInt(rawItem.product_id);
    const productName = String(rawItem.product_name || '').trim();
    const actualQuantity = roundQty(rawItem.actual_quantity);
    const unitPrice = roundMoney(Math.max(0, Number(rawItem.unit_price) || 0));

    if (!productId || !productName) {
      return { error: 'بيانات الصنف في الجرد غير مكتملة' };
    }

    if (actualQuantity < 0) {
      return { error: 'الكمية الفعلية في الجرد لا يمكن أن تكون أقل من صفر' };
    }

    normalizedItems.push({
      product_id: productId,
      product_name: productName,
      actual_quantity: actualQuantity,
      unit_price: unitPrice
    });
  }

  return { data: normalizedItems };
}

function normalizeStockCountPayload(body = {}) {
  const notes = String(body.notes || '').trim();

  const normalizedItems = normalizeStockCountItems(body.items);
  if (normalizedItems.error) {
    return normalizedItems;
  }

  return {
    data: {
      notes,
      items: normalizedItems.data
    }
  };
}

function canManageDocument(user, document) {
  if (!user || !document) return false;
  return user.role === 'admin' || (
    user.role === 'cashier' && Number(document.created_by) === Number(user.id)
  );
}

function canManageManualDocument(user, document) {
  return Boolean(
    canManageDocument(user, document) &&
    MANUAL_DOCUMENT_TYPES.includes(document.document_type) &&
    !document.reference_type
  );
}

function canCreateManualDocument(user) {
  return ['admin', 'cashier'].includes(user?.role);
}

async function getPartnersWithBalances(type = null) {
  const whereParts = ['p.active = 1'];
  const params = [];

  if (type) {
    whereParts.push('p.type = ?');
    params.push(type);
  }

  const [rows] = await db.query(
    `SELECT
       p.id,
       p.name,
       p.type,
       p.phone,
       p.address,
       p.notes,
       p.created_at,
       COALESCE(b.balance, 0) AS balance,
       b.last_activity
     FROM partners p
     LEFT JOIN (
       SELECT partner_id, SUM(amount) AS balance, MAX(created_at) AS last_activity
       FROM partner_ledger
       GROUP BY partner_id
     ) b ON b.partner_id = p.id
     WHERE ${whereParts.join(' AND ')}
     ORDER BY p.type ASC, p.name ASC`,
    params
  );

  return rows;
}

// GET /api/warehouses/meta
router.get('/meta', requireAuth, async (req, res) => {
  try {
    const [warehouses, partners, products] = await Promise.all([
      db.query(
        'SELECT id, name, code, location, is_primary, active FROM warehouses WHERE active = 1 ORDER BY is_primary DESC, id ASC LIMIT 1'
      ),
      getPartnersWithBalances(),
      db.query(
        'SELECT id, name, barcode, price, stock, unit FROM products WHERE active = 1 ORDER BY name ASC'
      )
    ]);

    res.json({
      success: true,
      data: {
        warehouses: warehouses[0],
        partners,
        products: products[0],
        document_types: MANUAL_DOCUMENT_TYPES.map((type) => ({
          value: type,
          label: DOCUMENT_TYPES[type].label,
          partner_type: DOCUMENT_TYPES[type].partnerType
        }))
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تحميل بيانات المخازن' });
  }
});

// GET /api/warehouses/dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userScoped = shouldScopeToUser(req);
    const userId = req.session.user.id;
    const mainWarehouse = await getMainWarehouse(db);
    const mainWarehouseId = mainWarehouse?.id || 0;
    const activityFilter = userScoped ? ' AND created_by = ?' : '';
    const activityParams = userScoped ? [userId] : [];
    const documentWhereParts = ['d.warehouse_id = ?'];
    const documentParams = [mainWarehouseId];

    if (userScoped) {
      documentWhereParts.push('d.created_by = ?');
      documentParams.push(userId);
    }

    const documentWhere = documentWhereParts.length ? `WHERE ${documentWhereParts.join(' AND ')}` : '';

    const [[summary]] = await db.query(`
      SELECT
        1 AS warehouses_count,
        (SELECT COALESCE(SUM(quantity), 0) FROM warehouse_stock WHERE warehouse_id = ?) AS total_stock_quantity,
        (SELECT COUNT(*) FROM stock_documents WHERE warehouse_id = ? AND DATE(created_at) = CURDATE()${activityFilter}) AS documents_today,
        (SELECT COUNT(*) FROM stock_counts WHERE warehouse_id = ? AND DATE(created_at) = CURDATE()${activityFilter}) AS counts_today,
        (SELECT COUNT(*) FROM partners WHERE active = 1 AND type = 'customer') AS customers_count,
        (SELECT COUNT(*) FROM partners WHERE active = 1 AND type = 'supplier') AS suppliers_count
    `, [mainWarehouseId, mainWarehouseId, ...activityParams, mainWarehouseId, ...activityParams]);

    const [[debtSummary]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN partner_type = 'customer' THEN balance ELSE 0 END), 0) AS customer_debt_total,
        COALESCE(SUM(CASE WHEN partner_type = 'supplier' THEN balance ELSE 0 END), 0) AS supplier_debt_total
      FROM (
        SELECT p.type AS partner_type, COALESCE(SUM(l.amount), 0) AS balance
        FROM partners p
        LEFT JOIN partner_ledger l ON l.partner_id = p.id
        WHERE p.active = 1
        GROUP BY p.id, p.type
      ) balances
    `);

    const [recentDocuments] = await db.query(`
      SELECT
        d.id,
        d.document_number,
        d.document_type,
        d.subtotal,
        d.paid_amount,
        d.debt_delta,
        d.created_at,
        w.name AS warehouse_name,
        p.name AS partner_name
      FROM stock_documents d
      LEFT JOIN warehouses w ON w.id = d.warehouse_id
      LEFT JOIN partners p ON p.id = d.partner_id
      ${documentWhere}
      ORDER BY d.created_at DESC
      LIMIT 5
    `, documentParams);

    res.json({
      success: true,
      data: {
        ...summary,
        ...debtSummary,
        recent_documents: recentDocuments
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تحميل لوحة المخازن' });
  }
});

// GET /api/warehouses/warehouses
router.get('/warehouses', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM warehouses WHERE active = 1 ORDER BY is_primary DESC, id ASC LIMIT 1'
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب المخازن' });
  }
});

// POST /api/warehouses/warehouses
router.post('/warehouses', requireAdmin, async (req, res) => {
  res.status(400).json({ success: false, message: 'النظام مضبوط على مخزن رئيسي واحد فقط' });
});

// GET /api/warehouses/partners
router.get('/partners', requireAuth, async (req, res) => {
  try {
    const type = ['customer', 'supplier'].includes(req.query.type) ? req.query.type : null;
    const rows = await getPartnersWithBalances(type);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب الأطراف' });
  }
});

// POST /api/warehouses/partners
router.post('/partners', requireAdmin, async (req, res) => {
  const payload = normalizePartnerPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ success: false, message: payload.error });
  }

  try {
    await db.query(
      `INSERT INTO partners (name, type, phone, address, notes, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [
        payload.data.name,
        payload.data.type,
        payload.data.phone,
        payload.data.address,
        payload.data.notes
      ]
    );

    res.status(201).json({ success: true, message: 'تمت إضافة الطرف بنجاح' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'الاسم مسجل بالفعل لنفس النوع' });
    }

    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في إضافة الطرف' });
  }
});

// GET /api/warehouses/partners/:id/ledger
router.get('/partners/:id/ledger', requireAuth, async (req, res) => {
  const partnerId = parsePositiveInt(req.params.id);
  if (!partnerId) {
    return res.status(400).json({ success: false, message: 'معرف الطرف غير صالح' });
  }

  try {
    const [[partner]] = await db.query(
      `SELECT
         p.*,
         COALESCE(b.balance, 0) AS balance
       FROM partners p
       LEFT JOIN (
         SELECT partner_id, SUM(amount) AS balance
         FROM partner_ledger
         GROUP BY partner_id
       ) b ON b.partner_id = p.id
       WHERE p.id = ? AND p.active = 1
       LIMIT 1`,
      [partnerId]
    );

    if (!partner) {
      return res.status(404).json({ success: false, message: 'الطرف غير موجود' });
    }

    const ledgerWhereParts = ['l.partner_id = ?'];
    const ledgerParams = [partnerId];

    const [ledgerRows] = await db.query(
      `SELECT
         l.*,
         d.document_number,
         d.document_type,
         u.full_name AS created_by_name
       FROM partner_ledger l
       LEFT JOIN stock_documents d
         ON d.id = l.source_id AND l.source_type = 'document'
       LEFT JOIN users u ON u.id = l.created_by
       WHERE ${ledgerWhereParts.join(' AND ')}
       ORDER BY l.created_at DESC, l.id DESC`,
      ledgerParams
    );

    res.json({ success: true, data: { partner, ledger: ledgerRows } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تحميل كشف المديونية' });
  }
});

// POST /api/warehouses/partners/:id/settlements
router.post('/partners/:id/settlements', requireAdmin, async (req, res) => {
  const partnerId = parsePositiveInt(req.params.id);
  const amount = roundMoney(Number(req.body?.amount));
  const notes = String(req.body?.notes || '').trim();

  if (!partnerId) {
    return res.status(400).json({ success: false, message: 'معرف الطرف غير صالح' });
  }

  if (!(amount > 0)) {
    return res.status(400).json({ success: false, message: 'قيمة التسوية يجب أن تكون أكبر من صفر' });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [[partner]] = await conn.query(
      'SELECT * FROM partners WHERE id = ? AND active = 1 FOR UPDATE',
      [partnerId]
    );

    if (!partner) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'الطرف غير موجود' });
    }

    await conn.query(
      `INSERT INTO partner_ledger (partner_id, source_type, source_id, amount, notes, created_by)
       VALUES (?, ?, NULL, ?, ?, ?)`,
      [
        partnerId,
        'settlement',
        -amount,
        notes || (partner.type === 'customer' ? 'تحصيل من العميل' : 'سداد للمورد'),
        req.session.user.id
      ]
    );

    await conn.commit();
    res.json({ success: true, message: 'تم تسجيل التسوية بنجاح' });
  } catch (error) {
    await conn.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تسجيل التسوية' });
  } finally {
    conn.release();
  }
});

// GET /api/warehouses/balances
router.get('/balances', requireAuth, async (req, res) => {
  try {
    const whereParts = ['w.active = 1', 'p.active = 1'];
    const params = [];
    const mainWarehouse = await getMainWarehouse(db);
    if (mainWarehouse) {
      whereParts.push('w.id = ?');
      params.push(mainWarehouse.id);
    }

    if (req.query.search) {
      whereParts.push('(p.name LIKE ? OR IFNULL(p.barcode, "") LIKE ?)');
      params.push(`%${req.query.search}%`, `%${req.query.search}%`);
    }

    const [rows] = await db.query(
      `SELECT
         ws.warehouse_id,
         w.name AS warehouse_name,
         p.id AS product_id,
         p.name AS product_name,
         p.barcode,
         p.unit,
         p.price,
         ws.quantity
       FROM warehouse_stock ws
       INNER JOIN warehouses w ON w.id = ws.warehouse_id
       INNER JOIN products p ON p.id = ws.product_id
       WHERE ${whereParts.join(' AND ')}
       ORDER BY w.is_primary DESC, w.name ASC, p.name ASC`,
      params
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب أرصدة المخازن' });
  }
});

// GET /api/warehouses/documents
router.get('/documents', requireAuth, async (req, res) => {
  try {
    const whereParts = ['d.document_type IN (?)'];
    const params = [MANUAL_DOCUMENT_TYPES];
    const isAdminUser = req.session?.user?.role === 'admin';

    if (!isAdminUser) {
      whereParts.push('d.created_by = ?');
      params.push(req.session.user.id);
    }

    const mainWarehouse = await getMainWarehouse(db);
    if (mainWarehouse) {
      whereParts.push('d.warehouse_id = ?');
      params.push(mainWarehouse.id);
    }

    if (MANUAL_DOCUMENT_TYPES.includes(req.query.document_type)) {
      whereParts.push('d.document_type = ?');
      params.push(req.query.document_type);
    }

    if (req.query.search) {
      whereParts.push(`(
        d.document_number LIKE ?
        OR IFNULL(p.name, "") LIKE ?
        OR EXISTS (
          SELECT 1
          FROM stock_document_items sdi
          WHERE sdi.document_id = d.id
            AND sdi.product_name LIKE ?
        )
      )`);
      params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT
         d.*,
         w.name AS warehouse_name,
         p.name AS partner_name,
         p.type AS partner_type,
         u.full_name AS created_by_name,
         (
           SELECT COUNT(*)
           FROM stock_document_items di
           WHERE di.document_id = d.id
         ) AS items_count,
         (
           SELECT GROUP_CONCAT(di.product_name ORDER BY di.product_name ASC SEPARATOR '، ')
           FROM stock_document_items di
           WHERE di.document_id = d.id
         ) AS item_names
       FROM stock_documents d
       LEFT JOIN warehouses w ON w.id = d.warehouse_id
       LEFT JOIN partners p ON p.id = d.partner_id
       LEFT JOIN users u ON u.id = d.created_by
       ${whereClause}
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT 200`,
      params
    );

    res.json({
      success: true,
      data: rows.map((document) => ({
        ...document,
        can_edit: canManageManualDocument(req.session.user, document),
        can_delete: canManageManualDocument(req.session.user, document)
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب حركة المخازن' });
  }
});

// GET /api/warehouses/documents/:id
router.get('/documents/:id', requireAuth, async (req, res) => {
  const documentId = parsePositiveInt(req.params.id);
  if (!documentId) {
    return res.status(400).json({ success: false, message: 'معرف الإذن غير صالح' });
  }

  try {
    const isAdminUser = req.session?.user?.role === 'admin';
    const whereParts = ['d.id = ?'];
    const params = [documentId];

    if (!isAdminUser) {
      whereParts.push('d.created_by = ?');
      params.push(req.session.user.id);
    }

    const [[document]] = await db.query(
      `SELECT
         d.*,
         w.name AS warehouse_name,
         p.name AS partner_name,
         p.type AS partner_type,
         u.full_name AS created_by_name
       FROM stock_documents d
       LEFT JOIN warehouses w ON w.id = d.warehouse_id
       LEFT JOIN partners p ON p.id = d.partner_id
       LEFT JOIN users u ON u.id = d.created_by
       WHERE ${whereParts.join(' AND ')}
       LIMIT 1`,
      params
    );

    if (!document) {
      return res.status(404).json({ success: false, message: 'الإذن غير موجود' });
    }

    const [items] = await db.query(
      `SELECT
         id,
         document_id,
         product_id,
         product_name,
         quantity,
         unit_price,
         line_total
       FROM stock_document_items
       WHERE document_id = ?
       ORDER BY id ASC`,
      [documentId]
    );

    res.json({
      success: true,
      data: {
        ...document,
        items,
        can_edit: canManageManualDocument(req.session.user, document),
        can_delete: canManageManualDocument(req.session.user, document)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تحميل تفاصيل الإذن' });
  }
});

// GET /api/warehouses/stock-counts
router.get('/stock-counts', requireAuth, async (req, res) => {
  try {
    const whereParts = [];
    const params = [];

    if (shouldScopeToUser(req)) {
      whereParts.push('c.created_by = ?');
      params.push(req.session.user.id);
    }

    const mainWarehouse = await getMainWarehouse(db);
    if (mainWarehouse) {
      whereParts.push('c.warehouse_id = ?');
      params.push(mainWarehouse.id);
    }

    if (req.query.search) {
      whereParts.push('(c.count_number LIKE ? OR IFNULL(w.name, "") LIKE ?)');
      params.push(`%${req.query.search}%`, `%${req.query.search}%`);
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT
         c.*,
         w.name AS warehouse_name,
         u.full_name AS created_by_name,
         COALESCE(i.items_count, 0) AS items_count,
         COALESCE(i.total_difference_quantity, 0) AS total_difference_quantity,
         COALESCE(i.total_difference_value, 0) AS total_difference_value
       FROM stock_counts c
       LEFT JOIN warehouses w ON w.id = c.warehouse_id
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN (
         SELECT
           stock_count_id,
           COUNT(*) AS items_count,
           SUM(difference_quantity) AS total_difference_quantity,
           SUM(difference_value) AS total_difference_value
         FROM stock_count_items
         GROUP BY stock_count_id
       ) i ON i.stock_count_id = c.id
       ${whereClause}
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT 200`,
      params
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في جلب سجل الجرد' });
  }
});

// GET /api/warehouses/stock-counts/:id
router.get('/stock-counts/:id', requireAuth, async (req, res) => {
  const countId = parsePositiveInt(req.params.id);
  if (!countId) {
    return res.status(400).json({ success: false, message: 'معرف الجرد غير صالح' });
  }

  try {
    const whereParts = ['c.id = ?'];
    const params = [countId];

    if (shouldScopeToUser(req)) {
      whereParts.push('c.created_by = ?');
      params.push(req.session.user.id);
    }

    const [[count]] = await db.query(
      `SELECT
         c.*,
         w.name AS warehouse_name,
         u.full_name AS created_by_name
       FROM stock_counts c
       LEFT JOIN warehouses w ON w.id = c.warehouse_id
       LEFT JOIN users u ON u.id = c.created_by
       WHERE ${whereParts.join(' AND ')}
       LIMIT 1`,
      params
    );

    if (!count) {
      return res.status(404).json({ success: false, message: 'عملية الجرد غير موجودة' });
    }

    const [items] = await db.query(
      `SELECT *
       FROM stock_count_items
       WHERE stock_count_id = ?
       ORDER BY difference_quantity DESC, product_name ASC`,
      [countId]
    );

    res.json({ success: true, data: { ...count, items } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل في تحميل تفاصيل الجرد' });
  }
});

// POST /api/warehouses/documents
router.post('/documents', requireAuth, async (req, res) => {
  if (!canCreateManualDocument(req.session.user)) {
    return res.status(403).json({ success: false, message: 'غير مصرح بإنشاء أذونات مخزنية' });
  }

  const payload = normalizeDocumentPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ success: false, message: payload.error });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    const mainWarehouse = await getMainWarehouse(conn, { lock: true });
    if (!mainWarehouse) {
      throw new Error('WAREHOUSE_NOT_FOUND');
    }

    const result = await createStockDocument(conn, {
      documentType: payload.data.documentType,
      warehouseId: mainWarehouse.id,
      partnerId: payload.data.partnerId,
      paidAmount: payload.data.paidAmount,
      notes: payload.data.notes,
      items: payload.data.items,
      createdBy: req.session.user.id
    });

    await conn.commit();
    res.status(201).json({
      success: true,
      data: result,
      message: 'تم حفظ الإذن المخزني بنجاح'
    });
  } catch (error) {
    await conn.rollback();
    console.error(error);

    if (error.message === 'PARTNER_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'الطرف غير موجود' });
    }

    if (error.message === 'PARTNER_TYPE_MISMATCH') {
      return res.status(400).json({ success: false, message: 'الطرف المختار لا يطابق نوع الإذن' });
    }

    if (error.message === 'WAREHOUSE_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'المخزن غير موجود' });
    }

    if (error.message === 'INVALID_PAID_AMOUNT') {
      return res.status(400).json({ success: false, message: 'المبلغ المسدد لا يمكن أن يتجاوز إجمالي الإذن' });
    }

    if (error.message?.startsWith('PRODUCT_NOT_FOUND:')) {
      return res.status(400).json({
        success: false,
        message: `الصنف غير متاح: ${error.message.split(':')[1]}`
      });
    }

    if (error.message?.startsWith('INSUFFICIENT_STOCK:')) {
      return res.status(400).json({
        success: false,
        message: `الكمية غير متوفرة في المخزن: ${error.message.split(':')[1]}`
      });
    }

    res.status(500).json({ success: false, message: 'فشل في حفظ الإذن المخزني' });
  } finally {
    conn.release();
  }
});

// PUT /api/warehouses/documents/:id
router.put('/documents/:id', requireAuth, async (req, res) => {
  const documentId = parsePositiveInt(req.params.id);
  if (!documentId) {
    return res.status(400).json({ success: false, message: 'معرف الإذن غير صالح' });
  }

  const payload = normalizeDocumentPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ success: false, message: payload.error });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    const mainWarehouse = await getMainWarehouse(conn, { lock: true });
    if (!mainWarehouse) {
      throw new Error('WAREHOUSE_NOT_FOUND');
    }

    const [[existingDocument]] = await conn.query(
      'SELECT * FROM stock_documents WHERE id = ? FOR UPDATE',
      [documentId]
    );

    if (!existingDocument || !canManageDocument(req.session.user, existingDocument)) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'الإذن غير موجود' });
    }

    if (!MANUAL_DOCUMENT_TYPES.includes(existingDocument.document_type) || existingDocument.reference_type) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'هذا الإذن غير متاح للتعديل' });
    }

    const result = await updateStockDocument(conn, documentId, {
      documentType: payload.data.documentType,
      warehouseId: mainWarehouse.id,
      partnerId: payload.data.partnerId,
      paidAmount: payload.data.paidAmount,
      notes: payload.data.notes,
      items: payload.data.items,
      createdBy: existingDocument.created_by || req.session.user.id
    });

    await conn.commit();
    res.json({
      success: true,
      data: result,
      message: 'تم تعديل الإذن المخزني بنجاح'
    });
  } catch (error) {
    await conn.rollback();
    console.error(error);

    if (error.message === 'PARTNER_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'الطرف غير موجود' });
    }

    if (error.message === 'PARTNER_TYPE_MISMATCH') {
      return res.status(400).json({ success: false, message: 'الطرف المختار لا يطابق نوع الإذن' });
    }

    if (error.message === 'WAREHOUSE_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'المخزن غير موجود' });
    }

    if (error.message === 'INVALID_PAID_AMOUNT') {
      return res.status(400).json({ success: false, message: 'المبلغ المسدد لا يمكن أن يتجاوز إجمالي الإذن' });
    }

    if (error.message?.startsWith('PRODUCT_NOT_FOUND:')) {
      return res.status(400).json({
        success: false,
        message: `الصنف غير متاح: ${error.message.split(':')[1]}`
      });
    }

    if (error.message?.startsWith('INSUFFICIENT_STOCK:')) {
      return res.status(400).json({
        success: false,
        message: `الكمية غير متوفرة في المخزن: ${error.message.split(':')[1]}`
      });
    }

    res.status(500).json({ success: false, message: 'فشل في تعديل الإذن المخزني' });
  } finally {
    conn.release();
  }
});

// DELETE /api/warehouses/documents/:id
router.delete('/documents/:id', requireAuth, async (req, res) => {
  const documentId = parsePositiveInt(req.params.id);
  if (!documentId) {
    return res.status(400).json({ success: false, message: 'معرف الإذن غير صالح' });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [[existingDocument]] = await conn.query(
      'SELECT * FROM stock_documents WHERE id = ? FOR UPDATE',
      [documentId]
    );

    if (!existingDocument || !canManageDocument(req.session.user, existingDocument)) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'الإذن غير موجود' });
    }

    if (!MANUAL_DOCUMENT_TYPES.includes(existingDocument.document_type) || existingDocument.reference_type) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'هذا الإذن غير متاح للحذف' });
    }

    await reverseDocument(conn, documentId);
    await conn.commit();

    res.json({ success: true, message: 'تم حذف الإذن المخزني بنجاح' });
  } catch (error) {
    await conn.rollback();
    console.error(error);

    if (error.message?.startsWith('INSUFFICIENT_STOCK:')) {
      return res.status(400).json({
        success: false,
        message: `لا يمكن حذف الإذن لأن الرصيد الحالي لا يسمح بعكس الحركة: ${error.message.split(':')[1]}`
      });
    }

    res.status(500).json({ success: false, message: 'فشل في حذف الإذن المخزني' });
  } finally {
    conn.release();
  }
});

// POST /api/warehouses/stock-counts
router.post('/stock-counts', requireAdmin, async (req, res) => {
  const payload = normalizeStockCountPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ success: false, message: payload.error });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    const mainWarehouse = await getMainWarehouse(conn, { lock: true });
    if (!mainWarehouse) {
      throw new Error('WAREHOUSE_NOT_FOUND');
    }

    const result = await createStockCount(conn, {
      warehouseId: mainWarehouse.id,
      notes: payload.data.notes,
      items: payload.data.items,
      createdBy: req.session.user.id
    });

    await conn.commit();
    res.status(201).json({
      success: true,
      data: result,
      message: 'تم حفظ الجرد وتحديث الرصيد بنجاح'
    });
  } catch (error) {
    await conn.rollback();
    console.error(error);

    if (error.message === 'WAREHOUSE_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'المخزن غير موجود' });
    }

    if (error.message === 'EMPTY_COUNT_ITEMS') {
      return res.status(400).json({ success: false, message: 'أضف صنفًا واحدًا على الأقل إلى الجرد' });
    }

    if (error.message === 'INVALID_COUNT_ITEM') {
      return res.status(400).json({ success: false, message: 'بيانات صنف الجرد غير صالحة' });
    }

    if (error.message?.startsWith('PRODUCT_NOT_FOUND:')) {
      return res.status(400).json({
        success: false,
        message: `الصنف غير موجود: ${error.message.split(':')[1]}`
      });
    }

    res.status(500).json({ success: false, message: 'فشل في حفظ الجرد' });
  } finally {
    conn.release();
  }
});

module.exports = router;
