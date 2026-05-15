const db = require('./db');

async function ensureProductsSchema() {
  const [categoryColumn] = await db.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'products'
      AND COLUMN_NAME = 'category'
    LIMIT 1
  `);

  if (!categoryColumn.length) {
    await db.query(`
      ALTER TABLE products
      ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT 'عام'
      AFTER barcode
    `);

    console.log('ℹ️ تمت إضافة عمود category إلى جدول products');
  }

  await db.query(`
    UPDATE products
    SET category = 'عام'
    WHERE category IS NULL OR TRIM(category) = ''
  `);
}

async function ensureProductStockPrecision() {
  const [[stockColumn]] = await db.query(`
    SELECT DATA_TYPE, COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'products'
      AND COLUMN_NAME = 'stock'
    LIMIT 1
  `);

  if (!stockColumn) return;

  const isDecimal = stockColumn.DATA_TYPE === 'decimal'
    && String(stockColumn.COLUMN_TYPE || '').startsWith('decimal(12,3)');

  if (!isDecimal) {
    await db.query(`
      ALTER TABLE products
      MODIFY COLUMN stock DECIMAL(12,3) NOT NULL DEFAULT 0
    `);

    console.log('ℹ️ تم تحديث عمود stock ليقبل الكسور العشرية');
  }
}

async function ensureWarehouseSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      name        VARCHAR(120) NOT NULL,
      code        VARCHAR(40) NOT NULL UNIQUE,
      location    VARCHAR(255),
      notes       TEXT,
      is_primary  TINYINT(1) NOT NULL DEFAULT 0,
      active      TINYINT(1) NOT NULL DEFAULT 1,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS warehouse_stock (
      warehouse_id INT NOT NULL,
      product_id   INT NOT NULL,
      quantity     DECIMAL(12,3) NOT NULL DEFAULT 0,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (warehouse_id, product_id),
      CONSTRAINT fk_warehouse_stock_warehouse
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
      CONSTRAINT fk_warehouse_stock_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS partners (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      name        VARCHAR(150) NOT NULL,
      type        ENUM('customer','supplier') NOT NULL,
      phone       VARCHAR(50),
      address     VARCHAR(255),
      notes       TEXT,
      active      TINYINT(1) NOT NULL DEFAULT 1,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_partner_name_type (name, type)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS stock_documents (
      id              INT PRIMARY KEY AUTO_INCREMENT,
      document_number VARCHAR(60) NOT NULL UNIQUE,
      document_type   VARCHAR(30) NOT NULL,
      warehouse_id    INT NOT NULL,
      partner_id      INT NULL,
      subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
      paid_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
      debt_delta      DECIMAL(12,2) NOT NULL DEFAULT 0,
      notes           TEXT,
      reference_type  VARCHAR(30) NULL,
      reference_id    INT NULL,
      created_by      INT NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_stock_documents_type_created (document_type, created_at),
      KEY idx_stock_documents_warehouse (warehouse_id),
      KEY idx_stock_documents_partner (partner_id),
      KEY idx_stock_documents_reference (reference_type, reference_id),
      UNIQUE KEY uq_stock_documents_reference (reference_type, reference_id),
      CONSTRAINT fk_stock_documents_warehouse
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
      CONSTRAINT fk_stock_documents_partner
        FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE SET NULL,
      CONSTRAINT fk_stock_documents_user
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS stock_document_items (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      document_id   INT NOT NULL,
      product_id    INT NOT NULL,
      product_name  VARCHAR(255) NOT NULL,
      quantity      DECIMAL(12,3) NOT NULL,
      unit_price    DECIMAL(12,2) NOT NULL DEFAULT 0,
      line_total    DECIMAL(12,2) NOT NULL DEFAULT 0,
      KEY idx_stock_document_items_document (document_id),
      KEY idx_stock_document_items_product (product_id),
      CONSTRAINT fk_stock_document_items_document
        FOREIGN KEY (document_id) REFERENCES stock_documents(id) ON DELETE CASCADE,
      CONSTRAINT fk_stock_document_items_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS partner_ledger (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      partner_id  INT NOT NULL,
      source_type VARCHAR(30) NOT NULL,
      source_id   INT NULL,
      amount      DECIMAL(12,2) NOT NULL,
      notes       TEXT,
      created_by  INT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_partner_ledger_partner (partner_id, created_at),
      CONSTRAINT fk_partner_ledger_partner
        FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
      CONSTRAINT fk_partner_ledger_user
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS stock_counts (
      id               INT PRIMARY KEY AUTO_INCREMENT,
      count_number     VARCHAR(60) NOT NULL UNIQUE,
      warehouse_id     INT NOT NULL,
      notes            TEXT,
      created_by       INT NULL,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      applied_at       TIMESTAMP NULL DEFAULT NULL,
      KEY idx_stock_counts_warehouse_created (warehouse_id, created_at),
      CONSTRAINT fk_stock_counts_warehouse
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
      CONSTRAINT fk_stock_counts_user
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS stock_count_items (
      id                   INT PRIMARY KEY AUTO_INCREMENT,
      stock_count_id       INT NOT NULL,
      product_id           INT NOT NULL,
      product_name         VARCHAR(255) NOT NULL,
      system_quantity      DECIMAL(12,3) NOT NULL DEFAULT 0,
      actual_quantity      DECIMAL(12,3) NOT NULL DEFAULT 0,
      difference_quantity  DECIMAL(12,3) NOT NULL DEFAULT 0,
      unit_price           DECIMAL(12,2) NOT NULL DEFAULT 0,
      difference_value     DECIMAL(12,2) NOT NULL DEFAULT 0,
      KEY idx_stock_count_items_count (stock_count_id),
      KEY idx_stock_count_items_product (product_id),
      CONSTRAINT fk_stock_count_items_count
        FOREIGN KEY (stock_count_id) REFERENCES stock_counts(id) ON DELETE CASCADE,
      CONSTRAINT fk_stock_count_items_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    )
  `);
}

async function ensureDefaultWarehouse() {
  const [[warehouseCount]] = await db.query(
    'SELECT COUNT(*) AS total FROM warehouses'
  );

  if (!warehouseCount.total) {
    await db.query(`
      INSERT INTO warehouses (name, code, location, notes, is_primary, active)
      VALUES ('المخزن الرئيسي', 'MAIN', 'الفرع الرئيسي', 'تم إنشاؤه تلقائيًا', 1, 1)
    `);

    console.log('ℹ️ تم إنشاء المخزن الرئيسي');
  } else {
    const [[primaryWarehouse]] = await db.query(
      'SELECT id FROM warehouses WHERE is_primary = 1 LIMIT 1'
    );

    if (!primaryWarehouse) {
      await db.query(`
        UPDATE warehouses
        SET is_primary = CASE WHEN id = (SELECT id_keep FROM (SELECT id AS id_keep FROM warehouses ORDER BY id ASC LIMIT 1) tmp) THEN 1 ELSE 0 END
      `);
    }
  }
}

async function ensureSalesWarehouseSetting() {
  const [[warehouse]] = await db.query(
    'SELECT id FROM warehouses WHERE active = 1 ORDER BY is_primary DESC, id ASC LIMIT 1'
  );

  if (!warehouse) return;

  const [[settingRow]] = await db.query(
    "SELECT `value` FROM settings WHERE `key` = 'sales_warehouse_id' LIMIT 1"
  );
  const currentWarehouseId = Number(settingRow?.value);

  if (currentWarehouseId > 0) {
    const [[existingWarehouse]] = await db.query(
      'SELECT id FROM warehouses WHERE id = ? AND active = 1 LIMIT 1',
      [currentWarehouseId]
    );
    if (existingWarehouse) return;
  }

  await db.query(
    `INSERT INTO settings (\`key\`, \`value\`)
     VALUES ('sales_warehouse_id', ?)
     ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
    [String(warehouse.id)]
  );
}

async function seedWarehouseStockFromProducts() {
  const [[stockRowsCount]] = await db.query(
    'SELECT COUNT(*) AS total FROM warehouse_stock'
  );

  if (stockRowsCount.total) {
    return;
  }

  const [[warehouse]] = await db.query(
    'SELECT id FROM warehouses WHERE active = 1 ORDER BY is_primary DESC, id ASC LIMIT 1'
  );

  if (!warehouse) return;

  const [products] = await db.query(
    'SELECT id, stock FROM products WHERE COALESCE(stock, 0) <> 0'
  );

  if (!products.length) return;

  const placeholders = products.map(() => '(?, ?, ?)').join(', ');
  const params = [];
  for (const product of products) {
    params.push(warehouse.id, product.id, product.stock);
  }

  await db.query(
    `INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
     VALUES ${placeholders}`,
    params
  );

  console.log('ℹ️ تم ترحيل أرصدة المنتجات الحالية إلى المخزن الرئيسي');
}

async function syncProductsStockFromWarehouses() {
  await db.query(`
    UPDATE products p
    LEFT JOIN (
      SELECT product_id, COALESCE(SUM(quantity), 0) AS total_stock
      FROM warehouse_stock
      GROUP BY product_id
    ) ws ON ws.product_id = p.id
    SET p.stock = COALESCE(ws.total_stock, 0)
  `);
}

async function ensureSchema() {
  await ensureProductsSchema();
  await ensureProductStockPrecision();
  await ensureWarehouseSchema();
  await ensureDefaultWarehouse();
  await ensureSalesWarehouseSetting();
  await seedWarehouseStockFromProducts();
  await syncProductsStockFromWarehouses();
}

module.exports = { ensureSchema };
