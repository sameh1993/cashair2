-- ===========================
-- قاعدة بيانات نظام الكاشير
-- ===========================

-- CREATE DATABASE IF NOT EXISTS cashier_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE cashier_db;
-- CREATE DATABASE IF NOT EXISTS cashier_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE cashier_db;

-- جدول المستخدمين
CREATE TABLE IF NOT EXISTS users (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  username    VARCHAR(50) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  full_name   VARCHAR(100),
  role        ENUM('admin','cashier') DEFAULT 'cashier',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- جدول المنتجات
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
);

-- جدول الفواتير
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
  FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE SET NULL
);

-- جدول تفاصيل الفاتورة
CREATE TABLE IF NOT EXISTS invoice_items (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  invoice_id    INT NOT NULL,
  product_id    INT,
  product_name  VARCHAR(255) NOT NULL,
  barcode       VARCHAR(100),
  unit_price    DECIMAL(10,2) NOT NULL,
  quantity      DECIMAL(10,3) NOT NULL,
  subtotal      DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- جدول الإعدادات
CREATE TABLE IF NOT EXISTS settings (
  `key`    VARCHAR(100) PRIMARY KEY,
  `value`  TEXT
);

-- جدول المخازن
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
);

-- جدول أرصدة المخازن
CREATE TABLE IF NOT EXISTS warehouse_stock (
  warehouse_id INT NOT NULL,
  product_id   INT NOT NULL,
  quantity     DECIMAL(12,3) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (warehouse_id, product_id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- العملاء والموردون
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
);

-- أذونات وحركات المخزن
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
  UNIQUE KEY uq_stock_documents_reference (reference_type, reference_id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- تفاصيل الأذونات المخزنية
CREATE TABLE IF NOT EXISTS stock_document_items (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  document_id   INT NOT NULL,
  product_id    INT NOT NULL,
  product_name  VARCHAR(255) NOT NULL,
  quantity      DECIMAL(12,3) NOT NULL,
  unit_price    DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total    DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (document_id) REFERENCES stock_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

-- كشف المديونية
CREATE TABLE IF NOT EXISTS partner_ledger (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  partner_id  INT NOT NULL,
  source_type VARCHAR(30) NOT NULL,
  source_id   INT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  notes       TEXT,
  created_by  INT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- جرد المخازن
CREATE TABLE IF NOT EXISTS stock_counts (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  count_number     VARCHAR(60) NOT NULL UNIQUE,
  warehouse_id     INT NOT NULL,
  notes            TEXT,
  created_by       INT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  applied_at       TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

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
  FOREIGN KEY (stock_count_id) REFERENCES stock_counts(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

-- =====================
-- بيانات أولية
-- =====================

-- مستخدم افتراضي: admin / 1234
-- INSERT IGNORE INTO users (username, password, full_name, role)
-- VALUES ('admin', '$2a$10$exigmF2pcJrdn53f7R.DG.m5p9DZjT8b87cBWcnSFnNqwTsNlRFP2', 'المدير', 'admin');
-- الباسورد: 1234

-- إعدادات افتراضية
INSERT IGNORE INTO settings VALUES ('shop_name', 'محلي');
INSERT IGNORE INTO settings VALUES ('currency', 'ج.م');
INSERT IGNORE INTO settings VALUES ('currency_position', 'after');
INSERT IGNORE INTO settings VALUES ('receipt_footer', 'شكراً لزيارتكم');
INSERT IGNORE INTO settings VALUES ('tax_enabled', '0');
INSERT IGNORE INTO settings VALUES ('tax_rate', '14');
INSERT IGNORE INTO settings VALUES ('show_stock', '1');
INSERT IGNORE INTO settings VALUES ('low_stock_alert', '5');
INSERT IGNORE INTO settings VALUES ('sales_warehouse_id', '1');

-- المخزن الرئيسي
INSERT IGNORE INTO warehouses (id, name, code, location, notes, is_primary, active)
VALUES (1, 'المخزن الرئيسي', 'MAIN', 'الفرع الرئيسي', 'تم إنشاؤه تلقائيًا', 1, 1);

-- منتجات تجريبية
INSERT IGNORE INTO products (name, barcode, price, stock, unit) VALUES
('مياه معدنية 600ml', '6001234567890', 5.00, 100, 'زجاجة'),
('عصير برتقال 250ml', '6001234567891', 8.50, 50, 'علبة'),
('شيبسي كبير', '6001234567892', 15.00, 30, 'قطعة'),
('لبن كامل الدسم', '6001234567893', 22.00, 20, 'كرتون'),
('خبز توست', '6001234567894', 18.00, 15, 'قطعة'),
('جبنة رومي 250g', '6001234567895', 45.00, 10, 'قطعة'),
('سكر 1kg', '6001234567896', 35.00, 25, 'كيلو'),
('شاي أحمر 100ظرف', '6001234567897', 28.00, 18, 'علبة'),
('نسكافيه صغير', '6001234567898', 55.00, 12, 'علبة'),
('بيبسي علبة', '6001234567899', 12.00, 60, 'علبة');

-- ترحيل الرصيد الافتتاحي إلى المخزن الرئيسي
INSERT IGNORE INTO warehouse_stock (warehouse_id, product_id, quantity)
SELECT 1, id, stock
FROM products
WHERE COALESCE(stock, 0) <> 0;
