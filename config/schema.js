const db = require('./db');
const bcrypt = require('bcryptjs');

const DEFAULT_ADMIN_HASH = '$2a$10$exigmF2pcJrdn53f7R.DG.m5p9DZjT8b87cBWcnSFnNqwTsNlRFP2';
const DEFAULT_ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1234';

function isBcryptHash(hash) {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(hash || '').trim());
}

async function ensureCoreSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      username    VARCHAR(50) UNIQUE NOT NULL,
      password    VARCHAR(255) NOT NULL,
      full_name   VARCHAR(100),
      role        ENUM('admin','cashier') DEFAULT 'cashier',
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS products (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      name        VARCHAR(255) NOT NULL,
      barcode     VARCHAR(100) UNIQUE,
      category    VARCHAR(100) NOT NULL DEFAULT 'عام',
      price       DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock       DECIMAL(12,3) NOT NULL DEFAULT 0,
      unit        VARCHAR(30) DEFAULT 'قطعة',
      active      TINYINT(1) DEFAULT 1,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id              INT PRIMARY KEY AUTO_INCREMENT,
      invoice_number  VARCHAR(50) UNIQUE NOT NULL,
      total           DECIMAL(10,2) NOT NULL,
      discount        DECIMAL(10,2) DEFAULT 0,
      net_total       DECIMAL(10,2) NOT NULL,
      paid_amount     DECIMAL(10,2) DEFAULT 0,
      change_amount   DECIMAL(10,2) DEFAULT 0,
      payment_method  ENUM('cash','card','other') DEFAULT 'cash',
      items_count     INT DEFAULT 0,
      notes           TEXT,
      cashier_id      INT,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_invoices_cashier
        FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      invoice_id    INT NOT NULL,
      product_id    INT,
      product_name  VARCHAR(255) NOT NULL,
      barcode       VARCHAR(100),
      unit_price    DECIMAL(10,2) NOT NULL,
      quantity      DECIMAL(10,3) NOT NULL,
      subtotal      DECIMAL(10,2) NOT NULL,
      CONSTRAINT fk_invoice_items_invoice
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      CONSTRAINT fk_invoice_items_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\`    VARCHAR(100) PRIMARY KEY,
      \`value\`  TEXT
    )
  `);
}

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

async function ensureDefaultAdminUser() {
  const [[adminUser]] = await db.query(
    'SELECT id, password FROM users WHERE username = ? LIMIT 1',
    [DEFAULT_ADMIN_USERNAME]
  );

  if (adminUser) {
    const shouldResetPassword = process.env.RESET_ADMIN_PASSWORD === 'true';
    const hasValidPasswordHash = isBcryptHash(adminUser.password);

    if (!shouldResetPassword && hasValidPasswordHash) return;

    const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    await db.query(
      "UPDATE users SET password = ?, role = 'admin' WHERE id = ?",
      [hash, adminUser.id]
    );

    console.log(`ℹ️ تم ${shouldResetPassword ? 'إعادة ضبط' : 'إصلاح'} كلمة مرور المستخدم ${DEFAULT_ADMIN_USERNAME}`);
    return;
  }

  await db.query(
    `INSERT INTO users (username, password, full_name, role)
     VALUES (?, ?, 'المدير', 'admin')`,
    [
      DEFAULT_ADMIN_USERNAME,
      DEFAULT_ADMIN_PASSWORD === '1234'
        ? DEFAULT_ADMIN_HASH
        : await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10)
    ]
  );

  console.log(`ℹ️ تم إنشاء المستخدم الافتراضي ${DEFAULT_ADMIN_USERNAME}`);
}

async function ensureWarehouseSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      name        VARCHAR(120) NOT NULL,
      code        VARCHAR(40) NOT NULL UNIQUE,
      warehouse_type ENUM('main','rep') NOT NULL DEFAULT 'rep',
      rep_code    VARCHAR(40) NULL,
      location    VARCHAR(255),
      notes       TEXT,
      is_primary  TINYINT(1) NOT NULL DEFAULT 0,
      active      TINYINT(1) NOT NULL DEFAULT 1,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [warehouseTypeColumn] = await db.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'warehouses'
      AND COLUMN_NAME = 'warehouse_type'
    LIMIT 1
  `);

  if (!warehouseTypeColumn.length) {
    await db.query(`
      ALTER TABLE warehouses
      ADD COLUMN warehouse_type ENUM('main','rep') NOT NULL DEFAULT 'rep'
      AFTER code
    `);
  }

  const [repCodeColumn] = await db.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'warehouses'
      AND COLUMN_NAME = 'rep_code'
    LIMIT 1
  `);

  if (!repCodeColumn.length) {
    await db.query(`
      ALTER TABLE warehouses
      ADD COLUMN rep_code VARCHAR(40) NULL
      AFTER warehouse_type
    `);
  }

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

  await db.query(`
    CREATE TABLE IF NOT EXISTS stock_transfers (
      id                    INT PRIMARY KEY AUTO_INCREMENT,
      transfer_number       VARCHAR(60) NOT NULL UNIQUE,
      from_warehouse_id     INT NOT NULL,
      to_warehouse_id       INT NOT NULL,
      notes                 TEXT,
      created_by            INT NULL,
      created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_stock_transfers_from_created (from_warehouse_id, created_at),
      KEY idx_stock_transfers_to_created (to_warehouse_id, created_at),
      CONSTRAINT fk_stock_transfers_from
        FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
      CONSTRAINT fk_stock_transfers_to
        FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
      CONSTRAINT fk_stock_transfers_user
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS stock_transfer_items (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      transfer_id   INT NOT NULL,
      product_id    INT NOT NULL,
      product_name  VARCHAR(255) NOT NULL,
      quantity      DECIMAL(12,3) NOT NULL,
      unit_price    DECIMAL(12,2) NOT NULL DEFAULT 0,
      KEY idx_stock_transfer_items_transfer (transfer_id),
      KEY idx_stock_transfer_items_product (product_id),
      CONSTRAINT fk_stock_transfer_items_transfer
        FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE,
      CONSTRAINT fk_stock_transfer_items_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS forecasts (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      forecast_number VARCHAR(60) NOT NULL UNIQUE,
      warehouse_id  INT NOT NULL,
      period_label  VARCHAR(80) NOT NULL,
      notes         TEXT,
      created_by    INT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_forecasts_warehouse_created (warehouse_id, created_at),
      CONSTRAINT fk_forecasts_warehouse
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
      CONSTRAINT fk_forecasts_user
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS forecast_items (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      forecast_id   INT NOT NULL,
      product_id    INT NOT NULL,
      product_name  VARCHAR(255) NOT NULL,
      quantity      DECIMAL(12,3) NOT NULL,
      KEY idx_forecast_items_forecast (forecast_id),
      KEY idx_forecast_items_product (product_id),
      CONSTRAINT fk_forecast_items_forecast
        FOREIGN KEY (forecast_id) REFERENCES forecasts(id) ON DELETE CASCADE,
      CONSTRAINT fk_forecast_items_product
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
      INSERT INTO warehouses (name, code, warehouse_type, location, notes, is_primary, active)
      VALUES ('المخزن الرئيسي', 'MAIN', 'main', 'الفرع الرئيسي', 'تم إنشاؤه تلقائيًا', 1, 1)
    `);

    console.log('ℹ️ تم إنشاء المخزن الرئيسي');
  } else {
    await db.query(`
      UPDATE warehouses
      SET warehouse_type = CASE WHEN is_primary = 1 THEN 'main' ELSE warehouse_type END
    `);

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

async function ensureDefaultSettings() {
  const settings = [
    ['shop_name', 'محلي'],
    ['currency', 'ج.م'],
    ['currency_position', 'after'],
    ['receipt_footer', 'شكراً لزيارتكم'],
    ['tax_enabled', '0'],
    ['tax_rate', '14'],
    ['show_stock', '1'],
    ['low_stock_alert', '5']
  ];

  await db.query(
    `INSERT IGNORE INTO settings (\`key\`, \`value\`) VALUES ${settings.map(() => '(?, ?)').join(', ')}`,
    settings.flat()
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
  await ensureCoreSchema();
  await ensureProductsSchema();
  await ensureProductStockPrecision();
  await ensureDefaultAdminUser();
  await ensureWarehouseSchema();
  await ensureDefaultWarehouse();
  await ensureDefaultSettings();
  await ensureSalesWarehouseSetting();
  await seedWarehouseStockFromProducts();
  await syncProductsStockFromWarehouses();
}

module.exports = { ensureSchema };
