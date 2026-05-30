(function () {
  const state = {
    settings: { currency: 'ج.م', currency_position: 'after' },
    activeSection: 'documents',
    warehouses: [],
    partners: [],
    products: [],
    documents: [],
    transfers: [],
    forecasts: [],
    balances: [],
    lostSales: [],
    forecastMatrix: [],
    dashboard: {},
    documentTypes: [],
    documentItems: [newItem()],
    transferItems: [newItem()],
    forecastItems: [newItem()]
  };

  const docMeta = {
    addition: { label: 'إذن توريد من المصنع', partnerType: 'supplier', partnerLabel: 'المصنع / المورد', debtSign: 1 },
    issue: { label: 'إذن صرف خارجي', partnerType: 'customer', partnerLabel: 'العميل', debtSign: 1 },
    customer_return: { label: 'مرتجع عميل', partnerType: 'customer', partnerLabel: 'العميل', debtSign: -1 },
    supplier_return: { label: 'مرتجع مصنع', partnerType: 'supplier', partnerLabel: 'المصنع / المورد', debtSign: -1 }
  };

  const $ = (id) => document.getElementById(id);

  function newItem() {
    return { uid: `${Date.now()}-${Math.random()}`, product_id: '', product_name: '', quantity: 1, unit_price: 0 };
  }

  function money(value) {
    const amount = Number(value || 0).toFixed(2);
    return state.settings.currency_position === 'before'
      ? `${state.settings.currency} ${amount}`
      : `${amount} ${state.settings.currency}`;
  }

  function qty(value) {
    const number = Number(value || 0);
    return Math.abs(number - Math.round(number)) < 0.001 ? String(Math.round(number)) : number.toFixed(3);
  }

  function dateLabel(value) {
    if (!value) return '-';
    return new Date(value).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
  }

  function productByLookup(value) {
    const needle = String(value || '').trim();
    return state.products.find((product) => (
      product.name === needle || (product.barcode && product.barcode === needle)
    ));
  }

  function normalizeItems(items) {
    return items.map((item) => {
      const product = productByLookup(item.product_name);
      return {
        product_id: product ? product.id : item.product_id,
        product_name: product ? product.name : String(item.product_name || '').trim(),
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0)
      };
    }).filter((item) => item.product_name || item.quantity);
  }

  function showError(id, message) {
    const el = $(id);
    el.textContent = message || '';
    el.classList.toggle('d-none', !message);
  }

  async function getJson(url, options) {
    const response = await api(url, options);
    if (!response) return null;
    return response;
  }

  async function loadAll() {
    const settings = await getSettings();
    state.settings.currency = settings.currency || 'ج.م';
    state.settings.currency_position = settings.currency_position || 'after';

    const [meta, dashboard, documents, transfers, forecasts, balances, lostSales, forecastMatrix] = await Promise.all([
      getJson('/api/warehouses/meta'),
      getJson('/api/warehouses/dashboard'),
      getJson('/api/warehouses/documents'),
      getJson('/api/warehouses/transfers'),
      getJson('/api/warehouses/forecasts'),
      getJson('/api/warehouses/balances'),
      getJson('/api/warehouses/reports/lost-sales'),
      getJson('/api/warehouses/reports/forecast-matrix')
    ]);

    if (meta?.success) {
      state.warehouses = meta.data.warehouses || [];
      state.partners = meta.data.partners || [];
      state.products = meta.data.products || [];
      state.documentTypes = meta.data.document_types || [];
    }
    if (dashboard?.success) state.dashboard = dashboard.data || {};
    if (documents?.success) state.documents = documents.data || [];
    if (transfers?.success) state.transfers = transfers.data || [];
    if (forecasts?.success) state.forecasts = forecasts.data || [];
    if (balances?.success) state.balances = balances.data || [];
    if (lostSales?.success) state.lostSales = lostSales.data || [];
    if (forecastMatrix?.success) state.forecastMatrix = forecastMatrix.data || [];

    render();
  }

  function render() {
    renderStats();
    renderTabs();
    renderOptions();
    renderProductList();
    renderItems('documentItems', state.documentItems);
    renderItems('transferItems', state.transferItems);
    renderItems('forecastItems', state.forecastItems, true);
    renderDocumentTotals();
    renderTables();
  }

  function renderStats() {
    const stats = [
      ['المخازن', state.dashboard.warehouses_count || 0, 'text-primary'],
      ['إجمالي الرصيد', qty(state.dashboard.total_stock_quantity || 0), 'text-success'],
      ['أذونات اليوم', state.dashboard.documents_today || 0, 'text-warning'],
      ['تحويلات اليوم', state.dashboard.transfers_today || 0, 'text-info'],
      ['فوركاست اليوم', state.dashboard.forecasts_today || 0, 'text-primary'],
      ['مديونية العملاء', money(state.dashboard.customer_debt_total || 0), 'text-danger']
    ];

    $('statsGrid').innerHTML = stats.map(([label, value, color]) => `
      <div class="col-6 col-md-4 col-xl-2">
        <div class="card metric-card">
          <div class="card-body">
            <div class="fs-4 fw-800 ${color}">${value}</div>
            <div class="mini-label">${label}</div>
          </div>
        </div>
      </div>
    `).join('');
  }

  function renderTabs() {
    document.querySelectorAll('[data-section]').forEach((button) => {
      button.classList.toggle('active', button.dataset.section === state.activeSection);
    });
    document.querySelectorAll('.warehouse-section').forEach((section) => {
      section.classList.toggle('d-none', section.dataset.section !== state.activeSection);
    });
  }

  function options(rows, selectedValue = '', placeholder = 'اختر') {
    return `<option value="">${placeholder}</option>` + rows.map((row) => (
      `<option value="${row.id}" ${String(row.id) === String(selectedValue) ? 'selected' : ''}>${row.name}${row.rep_code ? ` - ${row.rep_code}` : ''}</option>`
    )).join('');
  }

  function renderOptions() {
    const mainWarehouse = state.warehouses.find((warehouse) => warehouse.is_primary) || state.warehouses[0];
    const repWarehouses = state.warehouses.filter((warehouse) => warehouse.warehouse_type === 'rep');
    const warehouseOptions = options(state.warehouses, $('documentWarehouse').value || mainWarehouse?.id, 'اختر المخزن');

    $('documentType').innerHTML = state.documentTypes.map((type) => (
      `<option value="${type.value}">${docMeta[type.value]?.label || type.label}</option>`
    )).join('');
    $('documentWarehouse').innerHTML = warehouseOptions;
    $('transferFrom').innerHTML = options(state.warehouses, $('transferFrom').value || mainWarehouse?.id, 'من مخزن');
    $('transferTo').innerHTML = options(state.warehouses, $('transferTo').value, 'إلى مخزن');
    $('forecastWarehouse').innerHTML = options(repWarehouses, $('forecastWarehouse').value, 'اختر مخزن المندوب');
    $('balanceWarehouseFilter').innerHTML = options(state.warehouses, $('balanceWarehouseFilter').value, 'كل المخازن');

    updatePartnerOptions();
  }

  function updatePartnerOptions() {
    const type = $('documentType').value || 'addition';
    const meta = docMeta[type] || docMeta.addition;
    $('documentPartnerLabel').textContent = meta.partnerLabel;
    $('documentPartner').innerHTML = options(
      state.partners.filter((partner) => partner.type === meta.partnerType),
      $('documentPartner').value,
      'اختر الطرف'
    );
  }

  function renderProductList() {
    $('productsList').innerHTML = state.products.map((product) => (
      `<option value="${product.name}">${product.barcode || ''}</option>${product.barcode ? `<option value="${product.barcode}">${product.name}</option>` : ''}`
    )).join('');
  }

  function renderItems(containerId, items, hidePrice) {
    $(containerId).innerHTML = items.map((item, index) => `
      <div class="item-row" data-index="${index}">
        <div class="row g-2 align-items-end">
          <div class="${hidePrice ? 'col-md-7' : 'col-md-5'}">
            <label class="form-label">الصنف</label>
            <input class="form-control item-product" list="productsList" value="${item.product_name || ''}" placeholder="اسم الصنف أو الباركود">
          </div>
          <div class="${hidePrice ? 'col-md-3' : 'col-md-2'}">
            <label class="form-label">الكمية</label>
            <input class="form-control item-qty" type="number" min="0.001" step="0.001" value="${item.quantity || 1}">
          </div>
          ${hidePrice ? '' : `
            <div class="col-md-3">
              <label class="form-label">السعر</label>
              <input class="form-control item-price" type="number" min="0" step="0.01" value="${item.unit_price || 0}">
            </div>
          `}
          <div class="col-md-2">
            <button class="btn btn-outline-danger w-100 item-remove" type="button">حذف</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  function syncItems(containerId, items, hidePrice) {
    $(containerId).querySelectorAll('.item-row').forEach((row) => {
      const index = Number(row.dataset.index);
      const productInput = row.querySelector('.item-product');
      const matched = productByLookup(productInput.value);
      items[index].product_name = matched ? matched.name : productInput.value;
      items[index].product_id = matched ? matched.id : '';
      items[index].quantity = Number(row.querySelector('.item-qty').value || 0);
      items[index].unit_price = hidePrice ? 0 : Number(row.querySelector('.item-price').value || 0);
    });
  }

  function renderDocumentTotals() {
    syncItems('documentItems', state.documentItems);
    const subtotal = state.documentItems.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_price || 0)), 0);
    const paid = Number($('documentPaid').value || 0);
    const meta = docMeta[$('documentType').value] || docMeta.addition;
    const debt = Math.max(0, subtotal - paid) * meta.debtSign;
    $('documentTotal').textContent = money(subtotal);
    $('documentDebt').textContent = money(debt);
  }

  function emptyRow(colspan, text) {
    return `<tr><td colspan="${colspan}" class="text-muted py-4">${text}</td></tr>`;
  }

  function renderTables() {
    $('documentsBody').innerHTML = state.documents.length ? state.documents.map((doc) => `
      <tr><td dir="ltr">${doc.document_number}</td><td>${docMeta[doc.document_type]?.label || doc.document_type}</td><td>${doc.warehouse_name || '-'}</td><td>${doc.partner_name || '-'}</td><td>${money(doc.subtotal)}</td><td>${dateLabel(doc.created_at)}</td></tr>
    `).join('') : emptyRow(6, 'لا توجد أذونات بعد');

    $('transfersBody').innerHTML = state.transfers.length ? state.transfers.map((transfer) => `
      <tr><td dir="ltr">${transfer.transfer_number}</td><td>${transfer.from_warehouse_name}</td><td>${transfer.to_warehouse_name}</td><td>${transfer.items_count}</td><td>${qty(transfer.total_quantity)}</td><td>${dateLabel(transfer.created_at)}</td></tr>
    `).join('') : emptyRow(6, 'لا توجد تحويلات بعد');

    $('forecastsBody').innerHTML = state.forecasts.length ? state.forecasts.map((forecast) => `
      <tr><td dir="ltr">${forecast.forecast_number}</td><td>${forecast.warehouse_name}</td><td>${forecast.period_label}</td><td>${forecast.items_count}</td><td>${qty(forecast.total_quantity)}</td><td>${dateLabel(forecast.created_at)}</td></tr>
    `).join('') : emptyRow(6, 'لا يوجد فوركاست بعد');

    const selectedWarehouse = $('balanceWarehouseFilter').value;
    const search = String($('balanceSearch').value || '').trim().toLowerCase();
    const balanceRows = state.balances.filter((row) => (
      (!selectedWarehouse || String(row.warehouse_id) === String(selectedWarehouse)) &&
      (!search || `${row.product_name || ''} ${row.barcode || ''}`.toLowerCase().includes(search))
    ));
    $('balancesBody').innerHTML = balanceRows.length ? balanceRows.map((row) => `
      <tr><td>${row.warehouse_name}</td><td>${row.product_name}</td><td dir="ltr">${row.barcode || '-'}</td><td>${qty(row.quantity)}</td><td>${row.unit || '-'}</td><td>${money(Number(row.quantity || 0) * Number(row.price || 0))}</td></tr>
    `).join('') : emptyRow(6, 'لا توجد أرصدة مطابقة');

    $('lostSalesBody').innerHTML = state.lostSales.length ? state.lostSales.map((row) => `
      <tr><td>${row.product_name}</td><td>${qty(row.forecast_quantity)}</td><td>${qty(row.supplied_quantity)}</td><td class="${Number(row.lost_sales_quantity) > 0 ? 'text-danger fw-bold' : 'text-success fw-bold'}">${qty(row.lost_sales_quantity)}</td></tr>
    `).join('') : emptyRow(4, 'لا توجد بيانات للتقرير');

    $('forecastMatrixBody').innerHTML = state.forecastMatrix.length ? state.forecastMatrix.map((row) => `
      <tr><td dir="ltr">${row.rep_code || '-'}</td><td>${row.warehouse_name}</td><td>${row.product_name}</td><td>${qty(row.forecast_quantity)}</td></tr>
    `).join('') : emptyRow(4, 'لا توجد بيانات فوركاست');
  }

  async function saveDocument() {
    syncItems('documentItems', state.documentItems);
    const payload = {
      document_type: $('documentType').value,
      warehouse_id: $('documentWarehouse').value,
      partner_id: $('documentPartner').value,
      paid_amount: Number($('documentPaid').value || 0),
      notes: $('documentNotes').value,
      items: normalizeItems(state.documentItems)
    };

    const response = await getJson('/api/warehouses/documents', { method: 'POST', body: payload });
    if (!response?.success) return showError('documentError', response?.message || 'تعذر حفظ الإذن');
    showError('documentError', '');
    showToast(response.message, 'success');
    state.documentItems.splice(0, state.documentItems.length, newItem());
    $('documentNotes').value = '';
    $('documentPaid').value = 0;
    await loadAll();
  }

  async function saveTransfer() {
    syncItems('transferItems', state.transferItems);
    const response = await getJson('/api/warehouses/transfers', {
      method: 'POST',
      body: {
        from_warehouse_id: $('transferFrom').value,
        to_warehouse_id: $('transferTo').value,
        notes: $('transferNotes').value,
        items: normalizeItems(state.transferItems)
      }
    });
    if (!response?.success) return showError('transferError', response?.message || 'تعذر حفظ التحويل');
    showError('transferError', '');
    showToast(response.message, 'success');
    state.transferItems.splice(0, state.transferItems.length, newItem());
    $('transferNotes').value = '';
    await loadAll();
  }

  async function saveForecast() {
    syncItems('forecastItems', state.forecastItems, true);
    const response = await getJson('/api/warehouses/forecasts', {
      method: 'POST',
      body: {
        warehouse_id: $('forecastWarehouse').value,
        period_label: $('forecastPeriod').value,
        notes: $('forecastNotes').value,
        items: normalizeItems(state.forecastItems)
      }
    });
    if (!response?.success) return showError('forecastError', response?.message || 'تعذر حفظ الفوركاست');
    showError('forecastError', '');
    showToast(response.message, 'success');
    state.forecastItems.splice(0, state.forecastItems.length, newItem());
    $('forecastNotes').value = '';
    await loadAll();
  }

  async function saveWarehouse() {
    const response = await getJson('/api/warehouses/warehouses', {
      method: 'POST',
      body: {
        name: $('warehouseName').value,
        code: $('warehouseCode').value,
        warehouse_type: $('warehouseType').value,
        rep_code: $('warehouseRepCode').value,
        location: $('warehouseLocation').value,
        notes: $('warehouseNotes').value
      }
    });
    if (!response?.success) return showToast(response?.message || 'تعذر إضافة المخزن', 'error');
    showToast(response.message, 'success');
    ['warehouseName', 'warehouseCode', 'warehouseRepCode', 'warehouseLocation', 'warehouseNotes'].forEach((id) => { $(id).value = ''; });
    await loadAll();
  }

  async function savePartner() {
    const response = await getJson('/api/warehouses/partners', {
      method: 'POST',
      body: {
        name: $('partnerName').value,
        type: $('partnerType').value,
        phone: $('partnerPhone').value,
        address: $('partnerAddress').value,
        notes: ''
      }
    });
    if (!response?.success) return showToast(response?.message || 'تعذر إضافة الطرف', 'error');
    showToast(response.message, 'success');
    ['partnerName', 'partnerPhone', 'partnerAddress'].forEach((id) => { $(id).value = ''; });
    await loadAll();
  }

  function bindItemEvents(containerId, items, hidePrice) {
    $(containerId).addEventListener('input', () => {
      syncItems(containerId, items, hidePrice);
      if (containerId === 'documentItems') renderDocumentTotals();
    });
    $(containerId).addEventListener('change', () => {
      syncItems(containerId, items, hidePrice);
      renderItems(containerId, items, hidePrice);
      if (containerId === 'documentItems') renderDocumentTotals();
    });
    $(containerId).addEventListener('click', (event) => {
      const button = event.target.closest('.item-remove');
      if (!button) return;
      const index = Number(button.closest('.item-row').dataset.index);
      items.splice(index, 1);
      if (!items.length) items.push(newItem());
      renderItems(containerId, items, hidePrice);
      if (containerId === 'documentItems') renderDocumentTotals();
    });
  }

  function bindEvents() {
    $('refreshButton').addEventListener('click', loadAll);
    document.querySelectorAll('[data-section]').forEach((button) => {
      button.addEventListener('click', () => {
        state.activeSection = button.dataset.section;
        renderTabs();
      });
    });

    $('documentType').addEventListener('change', () => { updatePartnerOptions(); renderDocumentTotals(); });
    $('documentPaid').addEventListener('input', renderDocumentTotals);
    $('balanceWarehouseFilter').addEventListener('change', renderTables);
    $('balanceSearch').addEventListener('input', renderTables);

    $('documentAddItem').addEventListener('click', () => { syncItems('documentItems', state.documentItems); state.documentItems.push(newItem()); renderItems('documentItems', state.documentItems); });
    $('transferAddItem').addEventListener('click', () => { syncItems('transferItems', state.transferItems); state.transferItems.push(newItem()); renderItems('transferItems', state.transferItems); });
    $('forecastAddItem').addEventListener('click', () => { syncItems('forecastItems', state.forecastItems, true); state.forecastItems.push(newItem()); renderItems('forecastItems', state.forecastItems, true); });

    $('documentSaveButton').addEventListener('click', saveDocument);
    $('transferSaveButton').addEventListener('click', saveTransfer);
    $('forecastSaveButton').addEventListener('click', saveForecast);
    $('warehouseSaveButton').addEventListener('click', saveWarehouse);
    $('partnerSaveButton').addEventListener('click', savePartner);

    bindItemEvents('documentItems', state.documentItems);
    bindItemEvents('transferItems', state.transferItems);
    bindItemEvents('forecastItems', state.forecastItems, true);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    await loadAll();
  });
})();
