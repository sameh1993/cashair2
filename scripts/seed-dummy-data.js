const mysql = require('mysql2/promise');

const products = [
  // ── مشروبات ──
  { name:'كوكاكولا 330ml', barcode:'5449000000996', category:'مشروبات', price:7.00, stock:50, unit:'قطعة' },
  { name:'بيبسي 330ml', barcode:'5449000000439', category:'مشروبات', price:7.00, stock:40, unit:'قطعة' },
  { name:'مياه معدنية 1.5L', barcode:'6221000000010', category:'مشروبات', price:5.00, stock:100, unit:'قطعة' },
  { name:'عصير برتقال طبيعي', barcode:'6223000000011', category:'مشروبات', price:12.00, stock:25, unit:'قطعة' },
  { name:'مشروب طاقة 250ml', barcode:'6224000000012', category:'مشروبات', price:15.00, stock:20, unit:'قطعة' },

  // ── ألبان ──
  { name:'لبن طازج 1L', barcode:'6225000000013', category:'ألبان', price:25.00, stock:15, unit:'قطعة' },
  { name:'زبادي 250g', barcode:'6226000000014', category:'ألبان', price:10.00, stock:30, unit:'قطعة' },
  { name:'جبنة بيضاء 500g', barcode:'6227000000015', category:'ألبان', price:30.00, stock:12, unit:'قطعة' },
  { name:'جبنة شيدر 200g', barcode:'6228000000016', category:'ألبان', price:22.00, stock:20, unit:'قطعة' },
  { name:'قشطة 100g', barcode:'6229000000017', category:'ألبان', price:15.00, stock:18, unit:'قطعة' },

  // ── خضروات وفواكه ──
  { name:'طماطم 1kg', barcode:'6230000000018', category:'خضروات', price:12.00, stock:30, unit:'كيلو' },
  { name:'بطاطس 1kg', barcode:'6231000000019', category:'خضروات', price:10.00, stock:40, unit:'كيلو' },
  { name:'بصل 1kg', barcode:'6232000000020', category:'خضروات', price:8.00, stock:35, unit:'كيلو' },
  { name:'ليمون 1kg', barcode:'6233000000021', category:'خضروات', price:15.00, stock:20, unit:'كيلو' },
  { name:'تفاح أحمر 1kg', barcode:'6234000000022', category:'فواكه', price:25.00, stock:15, unit:'كيلو' },
  { name:'موز 1kg', barcode:'6235000000023', category:'فواكه', price:18.00, stock:22, unit:'كيلو' },
  { name:'عنب أحمر 1kg', barcode:'6236000000024', category:'فواكه', price:30.00, stock:10, unit:'كيلو' },

  // ── منظفات ──
  { name:'صابون سائل 500ml', barcode:'6237000000025', category:'منظفات', price:20.00, stock:25, unit:'قطعة' },
  { name:'مسحوق غسيل 1kg', barcode:'6238000000026', category:'منظفات', price:35.00, stock:15, unit:'قطعة' },
  { name:'كلور 1L', barcode:'6239000000027', category:'منظفات', price:12.00, stock:30, unit:'قطعة' },
  { name:'منعم أقمشة 1L', barcode:'6240000000028', category:'منظفات', price:28.00, stock:12, unit:'قطعة' },
  { name:'سائل جلي 500ml', barcode:'6241000000029', category:'منظفات', price:15.00, stock:40, unit:'قطعة' },

  // ── حلويات ووجبات خفيفة ──
  { name:'شوكولاتة 100g', barcode:'6242000000030', category:'حلويات', price:18.00, stock:35, unit:'قطعة' },
  { name:'بسكويت سادة 200g', barcode:'6243000000031', category:'حلويات', price:12.00, stock:30, unit:'قطعة' },
  { name:'كيك محشو 150g', barcode:'6244000000032', category:'حلويات', price:15.00, stock:20, unit:'قطعة' },
  { name:'شيبسي 100g', barcode:'6245000000033', category:'وجبات خفيفة', price:8.00, stock:50, unit:'قطعة' },
  { name:'مقرمشات جبنة 120g', barcode:'6246000000034', category:'وجبات خفيفة', price:10.00, stock:40, unit:'قطعة' },

  // ── لحوم ومعلبات ──
  { name:'تونة 200g', barcode:'6247000000035', category:'معلبات', price:22.00, stock:20, unit:'قطعة' },
  { name:'فول مدمس 400g', barcode:'6248000000036', category:'معلبات', price:10.00, stock:30, unit:'قطعة' },
  { name:'صلصة طماطم 300g', barcode:'6249000000037', category:'معلبات', price:8.00, stock:35, unit:'قطعة' },
  { name:'زيت طعام 1L', barcode:'6250000000038', category:'مواد غذائية', price:35.00, stock:20, unit:'قطعة' },
  { name:'أرز بسمتي 1kg', barcode:'6251000000039', category:'مواد غذائية', price:28.00, stock:25, unit:'كيلو' },
  { name:'مكرونة 400g', barcode:'6252000000040', category:'مواد غذائية', price:12.00, stock:40, unit:'قطعة' },
  { name:'عدس أصفر 1kg', barcode:'6253000000041', category:'مواد غذائية', price:20.00, stock:15, unit:'كيلو' },
  { name:'سكر 1kg', barcode:'6223003509965', category:'مواد غذائية', price:32.00, stock:50, unit:'كيلو' },
  { name:'شاي 100ظرف', barcode:'6001234567897', category:'مشروبات', price:28.00, stock:20, unit:'علبة' },
  { name:'جبنة رومي 250g', barcode:'6001234567895', category:'ألبان', price:45.00, stock:15, unit:'قطعة' },
  { name:'خبز توست', barcode:'6001234567894', category:'مخبوزات', price:18.00, stock:25, unit:'قطعة' },
  { name:'عيش فينو', barcode:'6254000000042', category:'مخبوزات', price:1.50, stock:100, unit:'قطعة' },
  { name:'كروسان', barcode:'6255000000043', category:'مخبوزات', price:5.00, stock:40, unit:'قطعة' },

  // ── عناية شخصية ──
  { name:'صابون تواليت 125g', barcode:'6256000000044', category:'عناية شخصية', price:10.00, stock:30, unit:'قطعة' },
  { name:'شامبو 200ml', barcode:'6257000000045', category:'عناية شخصية', price:25.00, stock:15, unit:'قطعة' },
  { name:'معجون أسنان 150g', barcode:'6258000000046', category:'عناية شخصية', price:15.00, stock:25, unit:'قطعة' },
  { name:'شفرة حلاقة', barcode:'6259000000047', category:'عناية شخصية', price:8.00, stock:20, unit:'قطعة' },
  { name:'مناديل وجه 200حبة', barcode:'6260000000048', category:'عناية شخصية', price:12.00, stock:40, unit:'قطعة' },
];

(async () => {
  const db = await mysql.createPool({ host:'localhost', user:'root', password:'', database:'cashier_db', waitForConnections:true });

  for (const p of products) {
    // Check if product already exists by barcode
    const [[existing]] = await db.query('SELECT id, stock FROM products WHERE barcode = ?', [p.barcode]);
    if (existing) {
      console.log(`⏩ موجود بالفعل: ${p.name}`);
      continue;
    }

    // 1) Insert product with stock=0 initially
    const [r] = await db.query(
      'INSERT INTO products (name, barcode, category, price, stock, unit, active) VALUES (?, ?, ?, ?, 0, ?, 1)',
      [p.name, p.barcode, p.category, p.price, p.unit]
    );
    const productId = r.insertId;

    // 2) Create stock document
    const docNum = 'SEED-' + Date.now() + '-' + productId;
    const [doc] = await db.query(
      `INSERT INTO stock_documents (document_number, document_type, warehouse_id, subtotal, paid_amount, notes, created_by)
       VALUES (?, 'adjustment_in', 1, ?, 0, ?, 1)`,
      [docNum, p.price * p.stock, 'رصيد افتتاحي - بيانات اختبار']
    );
    const docId = doc.insertId;

    // 3) Insert stock document item
    await db.query(
      `INSERT INTO stock_document_items (document_id, product_id, product_name, quantity, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [docId, productId, p.name, p.stock, p.price, p.price * p.stock]
    );

    // 4) Update product stock
    await db.query('UPDATE products SET stock = ? WHERE id = ?', [p.stock, productId]);

    // 5) Update warehouse stock
    await db.query(
      `INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = ?`,
      [productId, p.stock, p.stock]
    );

    console.log(`✅ تمت الإضافة: ${p.name} (${p.category}) - ${p.stock} ${p.unit}`);
  }

  console.log('\n🎉 تم إضافة جميع المنتجات التجريبية بنجاح!');
  await db.end();
})();
