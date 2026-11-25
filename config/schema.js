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
  await db.query(`
    CREATE TABLE IF NOT EXISTS product_categories (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

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

  // إضافة أعمدة إضافية إذا لم تكن موجودة
  const extraColumns = [
    { name: 'cost_price',    def: 'DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER price' },
    { name: 'min_quantity',  def: 'INT DEFAULT 5 AFTER stock' },
    { name: 'description',   def: 'TEXT NULL AFTER unit' },
  ];

  for (const col of extraColumns) {
    const [[row]] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = ?`,
      [col.name]
    );
    if (!row) {
      await db.query(`ALTER TABLE products ADD COLUMN \`${col.name}\` ${col.def}`);
      console.log(`ℹ️ تمت إضافة عمود ${col.name} إلى جدول products`);
    }
  }
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

async function ensureProductCategories() {
  await db.query(`
    INSERT IGNORE INTO product_categories (name)
    SELECT DISTINCT TRIM(category)
    FROM products
    WHERE category IS NOT NULL AND TRIM(category) <> ''
  `);
}

async function ensureSimpleWarehouse() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      name        VARCHAR(120) NOT NULL,
      location    VARCHAR(255),
      notes       TEXT,
      is_primary  TINYINT(1) NOT NULL DEFAULT 0,
      active      TINYINT(1) NOT NULL DEFAULT 1,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [[warehouseCount]] = await db.query('SELECT COUNT(*) AS total FROM warehouses');
  if (!warehouseCount.total) {
    await db.query(`
      INSERT INTO warehouses (name, is_primary, active)
      VALUES ('المخزن الرئيسي', 1, 1)
    `);
  }
}

async function ensureOtherTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS shop_settings (
      id          INT PRIMARY KEY DEFAULT 1,
      shop_name   VARCHAR(200) NOT NULL DEFAULT 'محلي',
      address     VARCHAR(255),
      phone       VARCHAR(50),
      phone2      VARCHAR(50),
      tax_number  VARCHAR(100),
      logo_url    VARCHAR(500),
      invoice_note TEXT
    )
  `);

  await db.query(`
    INSERT INTO shop_settings (id, shop_name) VALUES (1, 'محلي')
    ON DUPLICATE KEY UPDATE shop_name = shop_name
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      name          VARCHAR(150) NOT NULL,
      phone         VARCHAR(50),
      address       VARCHAR(255),
      customer_type ENUM('cash','credit') NOT NULL DEFAULT 'cash',
      notes         TEXT,
      active        TINYINT(1) NOT NULL DEFAULT 1,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(150) NOT NULL,
      phone VARCHAR(50),
      address VARCHAR(255),
      notes TEXT,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_suppliers_name (name)
    )
  `);

  await db.query(`
    INSERT INTO customers (id, name, customer_type) VALUES (1, 'عميل نقدي', 'cash')
    ON DUPLICATE KEY UPDATE name = name
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS return_invoices (
      id                    INT PRIMARY KEY AUTO_INCREMENT,
      original_invoice_id   INT NOT NULL,
      customer_id           INT,
      customer_name         VARCHAR(150),
      total_refund          DECIMAL(10,2) NOT NULL DEFAULT 0,
      reason                TEXT,
      created_by            INT,
      created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_return_original (original_invoice_id),
      KEY idx_return_created_by (created_by)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS return_invoice_items (
      id                  INT PRIMARY KEY AUTO_INCREMENT,
      return_invoice_id   INT NOT NULL,
      product_id          INT,
      product_name        VARCHAR(255) NOT NULL,
      quantity            DECIMAL(10,3) NOT NULL,
      unit_price          DECIMAL(10,2) NOT NULL,
      total               DECIMAL(10,2) NOT NULL,
      KEY idx_return_items_return (return_invoice_id),
      CONSTRAINT fk_return_items_return
        FOREIGN KEY (return_invoice_id) REFERENCES return_invoices(id) ON DELETE CASCADE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      category      VARCHAR(100) NOT NULL,
      amount        DECIMAL(10,2) NOT NULL,
      expense_date  DATE NOT NULL,
      description   TEXT,
      created_by    INT,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_expenses_date (expense_date),
      KEY idx_expenses_category (category)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id                INT PRIMARY KEY AUTO_INCREMENT,
      type              ENUM('purchase','return_to_supplier','adjustment') NOT NULL,
      document_number   VARCHAR(50),
      supplier_name     VARCHAR(255),
      notes             TEXT,
      created_by        INT,
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_stock_movements_type (type),
      KEY idx_stock_movements_date (created_at)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS stock_movement_items (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      movement_id   INT NOT NULL,
      product_id    INT,
      product_name  VARCHAR(255) NOT NULL,
      quantity      DECIMAL(12,3) NOT NULL,
      unit_price    DECIMAL(10,2) DEFAULT 0,
      total         DECIMAL(10,2) DEFAULT 0,
      KEY idx_movement_items_movement (movement_id),
      CONSTRAINT fk_movement_items_movement
        FOREIGN KEY (movement_id) REFERENCES stock_movements(id) ON DELETE CASCADE,
      CONSTRAINT fk_movement_items_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    )
  `);

  await db.query(`
    INSERT IGNORE INTO suppliers (name)
    SELECT DISTINCT TRIM(sm.supplier_name)
    FROM stock_movements sm
    WHERE sm.supplier_name IS NOT NULL AND TRIM(sm.supplier_name) <> ''
  `);
}

async function ensureStockMovementsMigration() {
  try {
    await db.query(`
      ALTER TABLE stock_movements
      MODIFY COLUMN type ENUM('purchase','return_to_supplier','adjustment','sale','sale_reversal') NOT NULL
    `);
  } catch (_) {}
  try {
    await db.query(`
      ALTER TABLE stock_movements
      ADD COLUMN invoice_id INT DEFAULT NULL AFTER document_number,
      ADD KEY idx_stock_movements_invoice (invoice_id)
    `);
  } catch (_) {}
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
    ['low_stock_alert', '5'],
    ['return_pin', '']
  ];

  await db.query(
    `INSERT IGNORE INTO settings (\`key\`, \`value\`) VALUES ${settings.map(() => '(?, ?)').join(', ')}`,
    settings.flat()
  );
}

async function ensureSchema() {
  await ensureCoreSchema();
  await ensureProductsSchema();
  await ensureProductStockPrecision();
  await ensureDefaultAdminUser();
  await ensureProductCategories();
  await ensureSimpleWarehouse();
  await ensureOtherTables();
  await ensureStockMovementsMigration();
  await ensureDefaultSettings();
}

module.exports = { ensureSchema };
