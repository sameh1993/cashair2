(function () {
  const state = {
    currentUser: null,
    settings: {
      currency: 'ج.م',
      currency_position: 'after'
    },
    activeSection: 'documents',
    dashboard: {
      warehouses_count: 0,
      total_stock_quantity: 0,
      documents_today: 0,
      counts_today: 0,
      customer_debt_total: 0,
      supplier_debt_total: 0
    },
    warehouses: [],
    partners: [],
    products: [],
    documents: [],
    balances: [],
    stockCounts: [],
    documentTypes: [],
    documentForm: createDocumentForm(),
    countForm: createCountForm(),
    documentFilters: { type: '', search: '' },
    balanceFilters: { warehouse_id: '', search: '' },
    countFilters: { warehouse_id: '', search: '' },
    debtFilters: { type: '', search: '' },
    warehouseForm: { name: '', code: '', location: '', notes: '' },
    partnerForm: { name: '', type: 'customer', phone: '', address: '', notes: '' },
    ledgerModal: { open: false, partner: null, entries: [] },
    countModal: { open: false, count: null, items: [] },
    settlementModal: { open: false, partner: null, amount: 0, notes: '' },
    saving: {
      page: false,
      document: false,
      count: false,
      warehouse: false,
      partner: false,
      settlement: false
    }
  };

  const documentTypeMeta = {
    addition: { label: 'إذن إضافة', partnerType: 'supplier', partnerLabel: 'المورد', debtSign: 1 },
    issue: { label: 'إذن صرف', partnerType: 'customer', partnerLabel: 'العميل', debtSign: 1 },
    customer_return: { label: 'مرتجع عميل', partnerType: 'customer', partnerLabel: 'العميل', debtSign: -1 },
    supplier_return: { label: 'مرتجع مورد', partnerType: 'supplier', partnerLabel: 'المورد', debtSign: -1 }
  };

  const els = {};

  function createDocumentItem() {
    return {
      uid: uid(),
      product_id: null,
      product_name: '',
      linked_name: '',
      barcode: '',
      quantity: 1,
      unit_price: 0
    };
  }

  function createDocumentForm() {
    return {
      document_type: 'addition',
      warehouse_id: '',
      partner_id: '',
      paid_amount: 0,
      notes: '',
      items: [createDocumentItem()],
      error: ''
    };
  }

  function createCountItem() {
    return {
      uid: uid(),
      product_id: null,
      product_name: '',
      linked_name: '',
      barcode: '',
      actual_quantity: 0,
      unit_price: 0
    };
  }

  function createCountForm() {
    return {
      warehouse_id: '',
      notes: '',
      items: [createCountItem()],
      error: ''
    };
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(16).slice(2);
  }

  function isAdmin() {
    return !!(state.currentUser && state.currentUser.role === 'admin');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoneyValue(value) {
    const numeric = Number(value || 0).toFixed(2);
    return state.settings.currency_position === 'before'
      ? `${state.settings.currency} ${numeric}`
      : `${numeric} ${state.settings.currency}`;
  }

  function formatQty(value) {
    const numeric = Number(value || 0);
    if (Math.abs(numeric - Math.round(numeric)) < 0.001) {
      return String(Math.round(numeric));
    }
    return numeric.toFixed(3);
  }

  function signedMoney(value) {
    const numeric = Number(value || 0);
    if (!numeric) return formatMoneyValue(0);
    return `${numeric > 0 ? '+' : '-'} ${formatMoneyValue(Math.abs(numeric))}`;
  }

  function signedQty(value) {
    const numeric = Number(value || 0);
    if (!numeric) return formatQty(0);
    return `${numeric > 0 ? '+' : '-'} ${formatQty(Math.abs(numeric))}`;
  }

  function documentTypeLabel(type) {
    return (documentTypeMeta[type] && documentTypeMeta[type].label) || type || '-';
  }

  function findProductByLookup(keyword) {
    const value = String(keyword || '').trim();
    if (!value) return null;
    for (const product of state.products) {
      if (product.name === value || (product.barcode && product.barcode === value)) {
        return product;
      }
    }
    return null;
  }

  function findProductById(productId) {
    return state.products.find((product) => Number(product.id) === Number(productId)) || null;
  }

  function getWarehouseBalance(warehouseId, productId) {
    return state.balances.find((row) => (
      Number(row.warehouse_id) === Number(warehouseId) &&
      Number(row.product_id) === Number(productId)
    )) || null;
  }

  function getCountSystemQuantity(item) {
    if (!item.product_id || !state.countForm.warehouse_id) return 0;
    const balance = getWarehouseBalance(state.countForm.warehouse_id, item.product_id);
    return Number(balance ? balance.quantity : 0);
  }

  function countDifference(item) {
    return Number(item.actual_quantity || 0) - getCountSystemQuantity(item);
  }

  function countDifferenceValue(item) {
    return countDifference(item) * Number(item.unit_price || 0);
  }

  function documentSubtotal() {
    return state.documentForm.items.reduce((sum, item) => (
      sum + (Number(item.quantity || 0) * Number(item.unit_price || 0))
    ), 0);
  }

  function documentDebtEffect() {
    const meta = documentTypeMeta[state.documentForm.document_type];
    if (!meta || !meta.partnerType) return 0;
    const remaining = Math.max(0, documentSubtotal() - Number(state.documentForm.paid_amount || 0));
    return remaining * meta.debtSign;
  }

  function countTotalDifferenceQuantity() {
    return state.countForm.items.reduce((sum, item) => sum + countDifference(item), 0);
  }

  function countTotalDifferenceValue() {
    return state.countForm.items.reduce((sum, item) => sum + countDifferenceValue(item), 0);
  }

  function availablePartners() {
    const meta = documentTypeMeta[state.documentForm.document_type];
    if (!meta || !meta.partnerType) return [];
    return state.partners.filter((partner) => partner.type === meta.partnerType);
  }

  function filteredDocuments() {
    const search = String(state.documentFilters.search || '').trim().toLowerCase();
    return state.documents.filter((doc) => {
      const matchesType = !state.documentFilters.type || doc.document_type === state.documentFilters.type;
      const haystack = `${doc.document_number || ''} ${doc.partner_name || ''}`.toLowerCase();
      const matchesSearch = !search || haystack.includes(search);
      return matchesType && matchesSearch;
    });
  }

  function filteredBalances() {
    const warehouseId = Number(state.balanceFilters.warehouse_id) || null;
    const search = String(state.balanceFilters.search || '').trim().toLowerCase();
    return state.balances.filter((row) => {
      const matchesWarehouse = !warehouseId || Number(row.warehouse_id) === warehouseId;
      const haystack = `${row.product_name || ''} ${row.barcode || ''}`.toLowerCase();
      const matchesSearch = !search || haystack.includes(search);
      return matchesWarehouse && matchesSearch;
    });
  }

  function filteredStockCounts() {
    const warehouseId = Number(state.countFilters.warehouse_id) || null;
    const search = String(state.countFilters.search || '').trim().toLowerCase();
    return state.stockCounts.filter((count) => {
      const matchesWarehouse = !warehouseId || Number(count.warehouse_id) === warehouseId;
      const haystack = `${count.count_number || ''} ${count.warehouse_name || ''}`.toLowerCase();
      const matchesSearch = !search || haystack.includes(search);
      return matchesWarehouse && matchesSearch;
    });
  }

  function filteredPartners() {
    const search = String(state.debtFilters.search || '').trim().toLowerCase();
    return state.partners.filter((partner) => {
      const matchesType = !state.debtFilters.type || partner.type === state.debtFilters.type;
      const haystack = `${partner.name || ''} ${partner.phone || ''}`.toLowerCase();
      const matchesSearch = !search || haystack.includes(search);
      return matchesType && matchesSearch;
    });
  }

  function setLoading(button, loading, idleText) {
    if (!button) return;
    button.disabled = !!loading;
    button.innerHTML = loading
      ? '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span>'
      : idleText;
  }

  function toggleHidden(element, hidden) {
    if (!element) return;
    element.classList.toggle('hidden', !!hidden);
  }

  function renderAll() {
    renderStats();
    renderTabs();
    renderSelectOptions();
    renderDatalist();
    renderDocumentSection();
    renderBalancesSection();
    renderCountsSection();
    renderDebtsSection();
    renderSetupSection();
    renderLedgerModal();
    renderCountModal();
    renderSettlementModal();
    renderAdminState();
  }

  function renderStats() {
    els.statsGrid.innerHTML = `
      ${statCard('عدد المخازن', state.dashboard.warehouses_count || 0, 'var(--primary)')}
      ${statCard('إجمالي الرصيد الكمي', formatQty(state.dashboard.total_stock_quantity || 0), 'var(--success)')}
      ${statCard('حركات اليوم', state.dashboard.documents_today || 0, 'var(--warning)')}
      ${statCard('عمليات الجرد اليوم', state.dashboard.counts_today || 0, '#0f766e')}
      ${statCard('مديونية العملاء', formatMoneyValue(state.dashboard.customer_debt_total || 0), '#b91c1c')}
      ${statCard('مديونية الموردين', formatMoneyValue(state.dashboard.supplier_debt_total || 0), '#7c3aed')}
    `;
  }

  function statCard(label, value, color) {
    return `
      <div class="stat-card">
        <div class="stat-value" style="color:${color};">${escapeHtml(value)}</div>
        <div class="stat-label">${escapeHtml(label)}</div>
      </div>
    `;
  }

  function renderTabs() {
    document.querySelectorAll('[data-section]').forEach((button) => {
      button.classList.toggle('active', button.dataset.section === state.activeSection);
    });
    document.querySelectorAll('.warehouse-section').forEach((section) => {
      section.classList.toggle('hidden', section.dataset.section !== state.activeSection);
    });
  }

  function renderSelectOptions() {
    const warehouseOptions = ['<option value="">اختر المخزن</option>']
      .concat(state.warehouses.map((warehouse) => (
        `<option value="${warehouse.id}">${escapeHtml(warehouse.name)}${warehouse.is_primary ? ' (رئيسي)' : ''}</option>`
      )))
      .join('');

    els.documentType.innerHTML = state.documentTypes.map((type) => (
      `<option value="${type.value}">${escapeHtml(type.label)}</option>`
    )).join('');
    els.documentType.value = state.documentForm.document_type;

    els.documentWarehouse.innerHTML = warehouseOptions;
    els.documentWarehouse.value = String(state.documentForm.warehouse_id || '');

    els.countWarehouse.innerHTML = warehouseOptions;
    els.countWarehouse.value = String(state.countForm.warehouse_id || '');

    els.balanceWarehouseFilter.innerHTML = `<option value="">كل المخازن</option>${state.warehouses.map((warehouse) => (
      `<option value="${warehouse.id}">${escapeHtml(warehouse.name)}</option>`
    )).join('')}`;
    els.balanceWarehouseFilter.value = String(state.balanceFilters.warehouse_id || '');

    els.countWarehouseFilter.innerHTML = `<option value="">كل المخازن</option>${state.warehouses.map((warehouse) => (
      `<option value="${warehouse.id}">${escapeHtml(warehouse.name)}</option>`
    )).join('')}`;
    els.countWarehouseFilter.value = String(state.countFilters.warehouse_id || '');

    const partnerOptions = ['<option value="">اختر الطرف</option>']
      .concat(availablePartners().map((partner) => (
        `<option value="${partner.id}">${escapeHtml(partner.name)} | ${partner.type === 'customer' ? 'عميل' : 'مورد'}</option>`
      )))
      .join('');
    els.documentPartner.innerHTML = partnerOptions;
    els.documentPartner.value = String(state.documentForm.partner_id || '');
    els.documentPartnerLabel.textContent = (documentTypeMeta[state.documentForm.document_type] || {}).partnerLabel || 'الطرف';
  }

  function renderDatalist() {
    els.productsDatalist.innerHTML = state.products.map((product) => (
      `<option value="${escapeHtml(product.name)}">${escapeHtml(product.barcode || '')}</option>${product.barcode ? `<option value="${escapeHtml(product.barcode)}">${escapeHtml(product.name)}</option>` : ''}`
    )).join('');
  }

  function renderDocumentSection() {
    els.documentNote.classList.toggle('hidden', isAdmin());
    els.documentError.textContent = state.documentForm.error || '';
    els.documentError.classList.toggle('hidden', !state.documentForm.error);
    els.documentSummaryTotal.textContent = formatMoneyValue(documentSubtotal());
    els.documentSummaryPaid.textContent = formatMoneyValue(state.documentForm.paid_amount || 0);
    const debtEffect = documentDebtEffect();
    els.documentSummaryEffect.textContent = signedMoney(debtEffect);
    els.documentSummaryEffect.className = `value ${debtEffect > 0 ? 'status-positive' : debtEffect < 0 ? 'text-success' : 'status-zero'}`;

    els.documentItemsBody.innerHTML = state.documentForm.items.map((item, index) => {
      const product = item.product_id ? findProductById(item.product_id) : null;
      return `
        <tr>
          <td style="min-width:260px;">
            <input type="text" class="form-control doc-product-input" data-index="${index}" value="${escapeHtml(item.product_name)}" list="warehouse-products-list" placeholder="اسم الصنف أو الباركود" ${!isAdmin() ? 'disabled' : ''}>
            ${product ? `<div class="text-muted" style="font-size:11px;margin-top:4px;">الرصيد الكلي الحالي: ${formatQty(product.stock)}</div>` : ''}
          </td>
          <td style="min-width:130px;"><input type="number" class="form-control doc-qty-input" data-index="${index}" value="${escapeHtml(item.quantity)}" min="0.001" step="0.001" style="direction:ltr;" ${!isAdmin() ? 'disabled' : ''}></td>
          <td style="min-width:150px;"><input type="number" class="form-control doc-price-input" data-index="${index}" value="${escapeHtml(item.unit_price)}" min="0" step="0.01" style="direction:ltr;" ${!isAdmin() ? 'disabled' : ''}></td>
          <td class="fw-bold" style="color:var(--primary);white-space:nowrap;">${formatMoneyValue(Number(item.quantity || 0) * Number(item.unit_price || 0))}</td>
          <td><button class="btn btn-sm btn-danger doc-remove-btn" data-index="${index}" ${!isAdmin() ? 'disabled' : ''}>حذف</button></td>
        </tr>
      `;
    }).join('');

    els.documentsHistoryBody.innerHTML = filteredDocuments().length
      ? filteredDocuments().map((doc) => `
          <tr>
            <td style="direction:ltr;text-align:right;font-weight:700;color:var(--primary);">${escapeHtml(doc.document_number)}</td>
            <td>${escapeHtml(documentTypeLabel(doc.document_type))}</td>
            <td>${escapeHtml(doc.warehouse_name || '-')}</td>
            <td>${escapeHtml(doc.partner_name || '-')}</td>
            <td>${formatMoneyValue(doc.subtotal)}</td>
            <td>${formatMoneyValue(doc.paid_amount)}</td>
            <td class="${Number(doc.debt_delta) > 0 ? 'status-positive' : 'status-zero'}">${signedMoney(doc.debt_delta)}</td>
            <td class="text-muted" style="font-size:12px;white-space:nowrap;">${escapeHtml(formatDate(doc.created_at))}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="8" class="text-center" style="padding:32px;color:#94a3b8;">لا توجد بيانات مطابقة</td></tr>';

    els.documentRecentList.innerHTML = state.documents.length
      ? state.documents.slice(0, 6).map((doc) => `
          <div style="padding:10px 0;border-bottom:1px dashed #dbeafe;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div>
                <div style="font-weight:800;color:#0f172a;">${escapeHtml(documentTypeLabel(doc.document_type))}</div>
                <div style="font-size:12px;color:#64748b;direction:ltr;">${escapeHtml(doc.document_number)}</div>
              </div>
              <span class="badge badge-info">${escapeHtml(doc.items_count)} صنف</span>
            </div>
            <div style="font-size:12px;color:#475569;margin-top:6px;">
              ${escapeHtml(doc.warehouse_name || '-')}${doc.partner_name ? ` | ${escapeHtml(doc.partner_name)}` : ''}
            </div>
            <div style="display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:12px;color:#64748b;">
              <span>${escapeHtml(formatDate(doc.created_at))}</span>
              <span style="font-weight:700;color:#0f172a;">${formatMoneyValue(doc.subtotal)}</span>
            </div>
          </div>
        `).join('')
      : '<div class="text-muted" style="font-size:13px;">لا توجد حركات حتى الآن.</div>';
  }

  function renderBalancesSection() {
    const rows = filteredBalances();
    els.balancesBody.innerHTML = rows.length
      ? rows.map((row) => `
          <tr>
            <td class="fw-bold">${escapeHtml(row.warehouse_name)}</td>
            <td>${escapeHtml(row.product_name)}</td>
            <td style="direction:ltr;text-align:right;color:#64748b;font-size:12px;">${escapeHtml(row.barcode || '-')}</td>
            <td><span class="${Number(row.quantity) > 0 ? 'badge badge-success' : 'badge badge-danger'}">${formatQty(row.quantity)}</span></td>
            <td>${escapeHtml(row.unit || 'قطعة')}</td>
            <td>${formatMoneyValue(row.price)}</td>
            <td class="fw-bold">${formatMoneyValue(Number(row.quantity || 0) * Number(row.price || 0))}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="7" class="text-center" style="padding:32px;color:#94a3b8;">لا توجد أرصدة مطابقة</td></tr>';
  }

  function renderCountsSection() {
    els.countNote.classList.toggle('hidden', isAdmin());
    els.countError.textContent = state.countForm.error || '';
    els.countError.classList.toggle('hidden', !state.countForm.error);
    els.countSummaryItems.textContent = state.countForm.items.length;
    const qtyDiff = countTotalDifferenceQuantity();
    const valueDiff = countTotalDifferenceValue();
    els.countSummaryQty.textContent = signedQty(qtyDiff);
    els.countSummaryValue.textContent = signedMoney(valueDiff);
    els.countSummaryQty.className = `value ${qtyDiff === 0 ? 'status-zero' : qtyDiff > 0 ? 'text-success' : 'status-positive'}`;
    els.countSummaryValue.className = `value ${valueDiff === 0 ? 'status-zero' : valueDiff > 0 ? 'text-success' : 'status-positive'}`;
    els.countNowLabel.textContent = formatDate(new Date());

    els.countItemsBody.innerHTML = state.countForm.items.map((item, index) => `
      <tr>
        <td style="min-width:260px;"><input type="text" class="form-control count-product-input" data-index="${index}" value="${escapeHtml(item.product_name)}" list="warehouse-products-list" placeholder="اسم الصنف أو الباركود" ${!isAdmin() ? 'disabled' : ''}></td>
        <td><span class="badge badge-info">${formatQty(getCountSystemQuantity(item))}</span></td>
        <td style="min-width:150px;"><input type="number" class="form-control count-actual-input" data-index="${index}" value="${escapeHtml(item.actual_quantity)}" min="0" step="0.001" style="direction:ltr;" ${!isAdmin() ? 'disabled' : ''}></td>
        <td class="${countDifference(item) === 0 ? 'status-zero' : countDifference(item) > 0 ? 'text-success fw-bold' : 'status-positive'}">${signedQty(countDifference(item))}</td>
        <td class="fw-bold">${formatMoneyValue(countDifferenceValue(item))}</td>
        <td><button class="btn btn-sm btn-danger count-remove-btn" data-index="${index}" ${!isAdmin() ? 'disabled' : ''}>حذف</button></td>
      </tr>
    `).join('');

    const counts = filteredStockCounts();
    els.countHistoryBody.innerHTML = counts.length
      ? counts.map((count) => `
          <tr>
            <td style="direction:ltr;text-align:right;font-weight:700;color:var(--primary);">${escapeHtml(count.count_number)}</td>
            <td>${escapeHtml(count.warehouse_name || '-')}</td>
            <td>${escapeHtml(count.items_count)}</td>
            <td class="${Number(count.total_difference_quantity) === 0 ? 'status-zero' : Number(count.total_difference_quantity) > 0 ? 'text-success fw-bold' : 'status-positive'}">${signedQty(count.total_difference_quantity)}</td>
            <td class="${Number(count.total_difference_value) === 0 ? 'status-zero' : Number(count.total_difference_value) > 0 ? 'text-success fw-bold' : 'status-positive'}">${signedMoney(count.total_difference_value)}</td>
            <td>${escapeHtml(count.created_by_name || '-')}</td>
            <td class="text-muted" style="font-size:12px;white-space:nowrap;">${escapeHtml(formatDate(count.created_at))}</td>
            <td><button class="btn btn-sm btn-outline count-detail-btn" data-id="${count.id}">عرض</button></td>
          </tr>
        `).join('')
      : '<tr><td colspan="8" class="text-center" style="padding:32px;color:#94a3b8;">لا توجد عمليات جرد مطابقة</td></tr>';
  }

  function renderDebtsSection() {
    const partners = filteredPartners();
    els.debtsBody.innerHTML = partners.length
      ? partners.map((partner) => `
          <tr>
            <td class="fw-bold">${escapeHtml(partner.name)}</td>
            <td><span class="${partner.type === 'customer' ? 'badge badge-warning' : 'badge badge-info'}">${partner.type === 'customer' ? 'عميل' : 'مورد'}</span></td>
            <td>${escapeHtml(partner.phone || '-')}</td>
            <td class="${Number(partner.balance) > 0 ? 'status-positive' : 'status-zero'}">${formatMoneyValue(partner.balance || 0)}</td>
            <td class="text-muted" style="font-size:12px;">${partner.last_activity ? escapeHtml(formatDate(partner.last_activity)) : '-'}</td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;">
                <button class="btn btn-sm btn-outline ledger-open-btn" data-id="${partner.id}">كشف</button>
                <button class="btn btn-sm btn-primary settlement-open-btn" data-id="${partner.id}" ${!isAdmin() ? 'disabled' : ''}>تسوية</button>
              </div>
            </td>
          </tr>
        `).join('')
      : '<tr><td colspan="6" class="text-center" style="padding:32px;color:#94a3b8;">لا توجد أطراف مطابقة</td></tr>';
  }

  function renderSetupSection() {
    els.setupNote.classList.toggle('hidden', isAdmin());
    els.warehouseListBody.innerHTML = state.warehouses.length
      ? state.warehouses.map((warehouse) => `
          <tr>
            <td class="fw-bold">${escapeHtml(warehouse.name)}${warehouse.is_primary ? ' (رئيسي)' : ''}</td>
            <td style="direction:ltr;text-align:right;">${escapeHtml(warehouse.code)}</td>
            <td>${escapeHtml(warehouse.location || '-')}</td>
            <td><span class="${warehouse.active ? 'badge badge-success' : 'badge badge-gray'}">${warehouse.active ? 'نشط' : 'موقوف'}</span></td>
          </tr>
        `).join('')
      : '<tr><td colspan="4" class="text-center" style="padding:32px;color:#94a3b8;">لا توجد مخازن</td></tr>';
  }

  function renderLedgerModal() {
    toggleHidden(els.ledgerModal, !state.ledgerModal.open);
    if (!state.ledgerModal.partner) return;
    els.ledgerTitle.textContent = `📒 كشف ${state.ledgerModal.partner.name}`;
    els.ledgerSummary.innerHTML = `
      <div class="summary-box"><div class="label">النوع</div><div class="value" style="font-size:16px;">${state.ledgerModal.partner.type === 'customer' ? 'عميل' : 'مورد'}</div></div>
      <div class="summary-box"><div class="label">الرصيد الحالي</div><div class="value ${Number(state.ledgerModal.partner.balance) > 0 ? 'status-positive' : 'status-zero'}" style="font-size:16px;">${formatMoneyValue(state.ledgerModal.partner.balance || 0)}</div></div>
      <div class="summary-box"><div class="label">الهاتف</div><div class="value" style="font-size:16px;">${escapeHtml(state.ledgerModal.partner.phone || '-')}</div></div>
    `;
    els.ledgerBody.innerHTML = state.ledgerModal.entries.length
      ? state.ledgerModal.entries.map((entry) => `
          <tr>
            <td class="text-muted" style="font-size:12px;white-space:nowrap;">${escapeHtml(formatDate(entry.created_at))}</td>
            <td>${entry.source_type === 'document' ? escapeHtml(documentTypeLabel(entry.document_type)) : 'تسوية'}</td>
            <td style="direction:ltr;text-align:right;">${escapeHtml(entry.document_number || '-')}</td>
            <td class="${Number(entry.amount) > 0 ? 'status-positive' : 'status-zero'}">${signedMoney(entry.amount)}</td>
            <td>${escapeHtml(entry.notes || '-')}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="5" class="text-center" style="padding:32px;color:#94a3b8;">لا توجد حركات على هذا الطرف</td></tr>';
  }

  function renderCountModal() {
    toggleHidden(els.countModal, !state.countModal.open);
    if (!state.countModal.count) return;
    els.countModalTitle.textContent = `📋 تفاصيل الجرد ${state.countModal.count.count_number}`;
    els.countModalSummary.innerHTML = `
      <div class="summary-box"><div class="label">المخزن</div><div class="value" style="font-size:16px;">${escapeHtml(state.countModal.count.warehouse_name || '-')}</div></div>
      <div class="summary-box"><div class="label">المنفذ</div><div class="value" style="font-size:16px;">${escapeHtml(state.countModal.count.created_by_name || '-')}</div></div>
      <div class="summary-box"><div class="label">التاريخ</div><div class="value" style="font-size:16px;">${escapeHtml(formatDate(state.countModal.count.created_at))}</div></div>
    `;
    els.countModalBody.innerHTML = state.countModal.items.length
      ? state.countModal.items.map((item) => `
          <tr>
            <td class="fw-bold">${escapeHtml(item.product_name)}</td>
            <td>${formatQty(item.system_quantity)}</td>
            <td>${formatQty(item.actual_quantity)}</td>
            <td class="${Number(item.difference_quantity) === 0 ? 'status-zero' : Number(item.difference_quantity) > 0 ? 'text-success fw-bold' : 'status-positive'}">${signedQty(item.difference_quantity)}</td>
            <td class="${Number(item.difference_value) === 0 ? 'status-zero' : Number(item.difference_value) > 0 ? 'text-success fw-bold' : 'status-positive'}">${signedMoney(item.difference_value)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="5" class="text-center" style="padding:32px;color:#94a3b8;">لا توجد تفاصيل للجرد</td></tr>';
  }

  function renderSettlementModal() {
    toggleHidden(els.settlementModal, !state.settlementModal.open);
    els.settlementTitle.textContent = `💰 تسوية ${state.settlementModal.partner ? state.settlementModal.partner.name : ''}`;
    els.settlementAmount.value = state.settlementModal.amount || 0;
    els.settlementNotes.value = state.settlementModal.notes || '';
  }

  function renderAdminState() {
    const admin = isAdmin();
    const disabledSelector = '[data-admin-only="true"]';
    document.querySelectorAll(disabledSelector).forEach((element) => {
      if ('disabled' in element) {
        element.disabled = !admin;
      }
    });
  }

  async function loadSettings() {
    const settings = await getSettings();
    state.settings.currency = settings.currency || 'ج.م';
    state.settings.currency_position = settings.currency_position || 'after';
  }

  async function loadMeta() {
    const response = await api('/api/warehouses/meta');
    if (!response || !response.success) return;
    state.warehouses = response.data.warehouses || [];
    state.partners = response.data.partners || [];
    state.products = response.data.products || [];
    state.documentTypes = response.data.document_types || [];
    if (!state.documentForm.warehouse_id && state.warehouses.length) {
      state.documentForm.warehouse_id = state.warehouses[0].id;
    }
    if (!state.countForm.warehouse_id && state.warehouses.length) {
      state.countForm.warehouse_id = state.warehouses[0].id;
    }
  }

  async function loadDashboard() {
    const response = await api('/api/warehouses/dashboard');
    if (response && response.success) {
      state.dashboard = response.data || state.dashboard;
    }
  }

  async function loadDocuments() {
    const response = await api('/api/warehouses/documents');
    if (response && response.success) {
      state.documents = response.data || [];
    }
  }

  async function loadBalances() {
    const response = await api('/api/warehouses/balances');
    if (response && response.success) {
      state.balances = response.data || [];
    }
  }

  async function loadPartners() {
    const response = await api('/api/warehouses/partners');
    if (response && response.success) {
      state.partners = response.data || [];
    }
  }

  async function loadStockCounts() {
    const response = await api('/api/warehouses/stock-counts');
    if (response && response.success) {
      state.stockCounts = response.data || [];
    }
  }

  async function refreshAll() {
    state.saving.page = true;
    setLoading(els.refreshButton, true, 'تحديث');
    try {
      await Promise.all([
        loadSettings(),
        loadMeta(),
        loadDashboard(),
        loadDocuments(),
        loadBalances(),
        loadPartners(),
        loadStockCounts()
      ]);
      renderAll();
    } finally {
      state.saving.page = false;
      setLoading(els.refreshButton, false, 'تحديث');
    }
  }

  async function saveDocument() {
    const items = state.documentForm.items.map((item) => {
      const matchedProduct = findProductByLookup(item.product_name);
      const keepLinked = item.product_id && item.product_name === item.linked_name;
      return {
        product_id: matchedProduct ? Number(matchedProduct.id) : keepLinked ? Number(item.product_id) : null,
        product_name: matchedProduct ? matchedProduct.name : String(item.product_name || '').trim(),
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price)
      };
    }).filter((item) => item.product_id || item.product_name);

    const invalidItem = items.find((item) => (
      !item.product_id ||
      !item.product_name ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isFinite(item.unit_price) ||
      item.unit_price < 0
    ));

    if (!items.length) {
      state.documentForm.error = 'أضف صنفًا واحدًا على الأقل';
      renderDocumentSection();
      return;
    }

    if (invalidItem) {
      state.documentForm.error = 'راجع الصنف والكمية والسعر قبل الحفظ';
      renderDocumentSection();
      return;
    }

    state.documentForm.error = '';
    state.saving.document = true;
    setLoading(els.documentSaveButton, true, 'حفظ الإذن');

    const response = await api('/api/warehouses/documents', {
      method: 'POST',
      body: {
        document_type: state.documentForm.document_type,
        warehouse_id: state.documentForm.warehouse_id,
        partner_id: state.documentForm.partner_id || null,
        paid_amount: Math.max(0, Number(state.documentForm.paid_amount) || 0),
        notes: String(state.documentForm.notes || '').trim(),
        items
      }
    });

    state.saving.document = false;
    setLoading(els.documentSaveButton, false, 'حفظ الإذن');

    if (!response || !response.success) {
      state.documentForm.error = (response && response.message) || 'تعذر حفظ الإذن';
      renderDocumentSection();
      return;
    }

    showToast(response.message || 'تم حفظ الإذن', 'success');
    state.documentForm = createDocumentForm();
    if (state.warehouses.length) {
      state.documentForm.warehouse_id = state.warehouses[0].id;
    }
    await refreshAll();
  }

  async function saveStockCount() {
    const items = state.countForm.items.map((item) => {
      const matchedProduct = findProductByLookup(item.product_name);
      const keepLinked = item.product_id && item.product_name === item.linked_name;
      return {
        product_id: matchedProduct ? Number(matchedProduct.id) : keepLinked ? Number(item.product_id) : null,
        product_name: matchedProduct ? matchedProduct.name : String(item.product_name || '').trim(),
        actual_quantity: Number(item.actual_quantity),
        unit_price: Number(item.unit_price)
      };
    }).filter((item) => item.product_id || item.product_name);

    const invalidItem = items.find((item) => (
      !item.product_id ||
      !item.product_name ||
      !Number.isFinite(item.actual_quantity) ||
      item.actual_quantity < 0 ||
      !Number.isFinite(item.unit_price) ||
      item.unit_price < 0
    ));

    if (!state.countForm.warehouse_id) {
      state.countForm.error = 'اختر المخزن أولًا';
      renderCountsSection();
      return;
    }

    if (!items.length) {
      state.countForm.error = 'أضف صنفًا واحدًا على الأقل إلى الجرد';
      renderCountsSection();
      return;
    }

    if (invalidItem) {
      state.countForm.error = 'راجع بيانات أصناف الجرد قبل الحفظ';
      renderCountsSection();
      return;
    }

    state.countForm.error = '';
    state.saving.count = true;
    setLoading(els.countSaveButton, true, 'حفظ الجرد');

    const response = await api('/api/warehouses/stock-counts', {
      method: 'POST',
      body: {
        warehouse_id: state.countForm.warehouse_id,
        notes: String(state.countForm.notes || '').trim(),
        items
      }
    });

    state.saving.count = false;
    setLoading(els.countSaveButton, false, 'حفظ الجرد');

    if (!response || !response.success) {
      state.countForm.error = (response && response.message) || 'تعذر حفظ الجرد';
      renderCountsSection();
      return;
    }

    showToast(response.message || 'تم حفظ الجرد', 'success');
    state.countForm = createCountForm();
    if (state.warehouses.length) {
      state.countForm.warehouse_id = state.warehouses[0].id;
    }
    await refreshAll();
  }

  async function saveWarehouse() {
    state.saving.warehouse = true;
    setLoading(els.warehouseSaveButton, true, 'إضافة المخزن');
    const response = await api('/api/warehouses/warehouses', {
      method: 'POST',
      body: state.warehouseForm
    });
    state.saving.warehouse = false;
    setLoading(els.warehouseSaveButton, false, 'إضافة المخزن');
    if (!response || !response.success) {
      showToast((response && response.message) || 'تعذر إضافة المخزن', 'error');
      return;
    }
    showToast(response.message || 'تمت إضافة المخزن', 'success');
    state.warehouseForm = { name: '', code: '', location: '', notes: '' };
    els.warehouseForm.reset();
    await refreshAll();
  }

  async function savePartner() {
    state.saving.partner = true;
    setLoading(els.partnerSaveButton, true, 'إضافة الطرف');
    const response = await api('/api/warehouses/partners', {
      method: 'POST',
      body: state.partnerForm
    });
    state.saving.partner = false;
    setLoading(els.partnerSaveButton, false, 'إضافة الطرف');
    if (!response || !response.success) {
      showToast((response && response.message) || 'تعذر إضافة الطرف', 'error');
      return;
    }
    showToast(response.message || 'تمت إضافة الطرف', 'success');
    state.partnerForm = { name: '', type: 'customer', phone: '', address: '', notes: '' };
    els.partnerForm.reset();
    await refreshAll();
  }

  async function openLedger(partnerId) {
    const response = await api(`/api/warehouses/partners/${partnerId}/ledger`);
    if (!response || !response.success) {
      showToast((response && response.message) || 'تعذر تحميل الكشف', 'error');
      return;
    }
    state.ledgerModal.open = true;
    state.ledgerModal.partner = response.data.partner;
    state.ledgerModal.entries = response.data.ledger || [];
    renderLedgerModal();
  }

  async function openCountDetail(countId) {
    const response = await api(`/api/warehouses/stock-counts/${countId}`);
    if (!response || !response.success) {
      showToast((response && response.message) || 'تعذر تحميل تفاصيل الجرد', 'error');
      return;
    }
    state.countModal.open = true;
    state.countModal.count = response.data;
    state.countModal.items = response.data.items || [];
    renderCountModal();
  }

  function openSettlement(partnerId) {
    const partner = state.partners.find((item) => Number(item.id) === Number(partnerId));
    if (!partner) return;
    state.settlementModal.open = true;
    state.settlementModal.partner = partner;
    state.settlementModal.amount = Number(partner.balance) > 0 ? Number(partner.balance) : 0;
    state.settlementModal.notes = '';
    renderSettlementModal();
  }

  async function saveSettlement() {
    if (!state.settlementModal.partner) return;
    state.saving.settlement = true;
    setLoading(els.settlementSaveButton, true, 'حفظ التسوية');
    const response = await api(`/api/warehouses/partners/${state.settlementModal.partner.id}/settlements`, {
      method: 'POST',
      body: {
        amount: Number(els.settlementAmount.value),
        notes: String(els.settlementNotes.value || '').trim()
      }
    });
    state.saving.settlement = false;
    setLoading(els.settlementSaveButton, false, 'حفظ التسوية');
    if (!response || !response.success) {
      showToast((response && response.message) || 'تعذر حفظ التسوية', 'error');
      return;
    }
    showToast(response.message || 'تم حفظ التسوية', 'success');
    state.settlementModal.open = false;
    renderSettlementModal();
    await refreshAll();
    if (state.ledgerModal.open && state.ledgerModal.partner && Number(state.ledgerModal.partner.id) === Number(state.settlementModal.partner.id)) {
      await openLedger(state.settlementModal.partner.id);
    }
  }

  function bindEvents() {
    els.refreshButton.addEventListener('click', refreshAll);

    document.querySelectorAll('[data-section]').forEach((button) => {
      button.addEventListener('click', () => {
        state.activeSection = button.dataset.section;
        renderTabs();
      });
    });

    els.documentType.addEventListener('change', function () {
      state.documentForm.document_type = this.value;
      state.documentForm.partner_id = '';
      renderSelectOptions();
      renderDocumentSection();
    });
    els.documentWarehouse.addEventListener('change', function () {
      state.documentForm.warehouse_id = this.value;
    });
    els.documentPartner.addEventListener('change', function () {
      state.documentForm.partner_id = this.value;
    });
    els.documentPaid.addEventListener('input', function () {
      state.documentForm.paid_amount = Number(this.value || 0);
      renderDocumentSection();
    });
    els.documentNotes.addEventListener('input', function () {
      state.documentForm.notes = this.value;
    });
    els.documentAddItem.addEventListener('click', function () {
      state.documentForm.items.push(createDocumentItem());
      renderDocumentSection();
    });
    els.documentSaveButton.addEventListener('click', saveDocument);
    els.documentSearch.addEventListener('input', function () {
      state.documentFilters.search = this.value;
      renderDocumentSection();
    });
    els.documentTypeFilter.addEventListener('change', function () {
      state.documentFilters.type = this.value;
      renderDocumentSection();
    });
    els.documentItemsBody.addEventListener('input', handleDocumentItemsInput);
    els.documentItemsBody.addEventListener('click', handleDocumentItemsClick);
    els.documentItemsBody.addEventListener('change', handleDocumentItemsChange);

    els.balanceWarehouseFilter.addEventListener('change', function () {
      state.balanceFilters.warehouse_id = this.value;
      renderBalancesSection();
    });
    els.balanceSearch.addEventListener('input', function () {
      state.balanceFilters.search = this.value;
      renderBalancesSection();
    });

    els.countWarehouse.addEventListener('change', function () {
      state.countForm.warehouse_id = this.value;
      state.countForm.items.forEach((item) => {
        if (item.product_id) item.actual_quantity = getCountSystemQuantity(item);
      });
      renderCountsSection();
    });
    els.countNotes.addEventListener('input', function () {
      state.countForm.notes = this.value;
    });
    els.countAddItem.addEventListener('click', function () {
      state.countForm.items.push(createCountItem());
      renderCountsSection();
    });
    els.countSaveButton.addEventListener('click', saveStockCount);
    els.countSearch.addEventListener('input', function () {
      state.countFilters.search = this.value;
      renderCountsSection();
    });
    els.countWarehouseFilter.addEventListener('change', function () {
      state.countFilters.warehouse_id = this.value;
      renderCountsSection();
    });
    els.countItemsBody.addEventListener('input', handleCountItemsInput);
    els.countItemsBody.addEventListener('click', handleCountItemsClick);
    els.countItemsBody.addEventListener('change', handleCountItemsChange);
    els.countHistoryBody.addEventListener('click', function (event) {
      const button = event.target.closest('.count-detail-btn');
      if (button) openCountDetail(button.dataset.id);
    });

    els.debtTypeFilter.addEventListener('change', function () {
      state.debtFilters.type = this.value;
      renderDebtsSection();
    });
    els.debtSearch.addEventListener('input', function () {
      state.debtFilters.search = this.value;
      renderDebtsSection();
    });
    els.debtsBody.addEventListener('click', function (event) {
      const ledgerButton = event.target.closest('.ledger-open-btn');
      const settlementButton = event.target.closest('.settlement-open-btn');
      if (ledgerButton) openLedger(ledgerButton.dataset.id);
      if (settlementButton) openSettlement(settlementButton.dataset.id);
    });

    els.warehouseForm.addEventListener('input', syncWarehouseForm);
    els.partnerForm.addEventListener('input', syncPartnerForm);
    els.warehouseSaveButton.addEventListener('click', saveWarehouse);
    els.partnerSaveButton.addEventListener('click', savePartner);

    els.ledgerClose.addEventListener('click', closeLedger);
    els.ledgerModal.addEventListener('click', function (event) {
      if (event.target === els.ledgerModal) closeLedger();
    });

    els.countModalClose.addEventListener('click', closeCountModal);
    els.countModal.addEventListener('click', function (event) {
      if (event.target === els.countModal) closeCountModal();
    });

    els.settlementClose.addEventListener('click', closeSettlementModal);
    els.settlementCancel.addEventListener('click', closeSettlementModal);
    els.settlementModal.addEventListener('click', function (event) {
      if (event.target === els.settlementModal) closeSettlementModal();
    });
    els.settlementSaveButton.addEventListener('click', saveSettlement);

    els.logoutButton.addEventListener('click', function () {
      if (confirm('تسجيل الخروج؟')) logout();
    });
  }

  function handleDocumentItemsInput(event) {
    const index = Number(event.target.dataset.index);
    if (!Number.isInteger(index)) return;
    const item = state.documentForm.items[index];
    if (!item) return;
    if (event.target.classList.contains('doc-qty-input')) {
      item.quantity = Number(event.target.value || 0);
      renderDocumentSection();
    }
    if (event.target.classList.contains('doc-price-input')) {
      item.unit_price = Number(event.target.value || 0);
      renderDocumentSection();
    }
  }

  function handleDocumentItemsChange(event) {
    const index = Number(event.target.dataset.index);
    if (!Number.isInteger(index)) return;
    const item = state.documentForm.items[index];
    if (!item) return;
    if (event.target.classList.contains('doc-product-input')) {
      item.product_name = event.target.value;
      const product = findProductByLookup(item.product_name);
      if (product) {
        item.product_id = Number(product.id);
        item.product_name = product.name;
        item.linked_name = product.name;
        item.barcode = product.barcode || '';
        if (!(Number(item.unit_price) > 0)) item.unit_price = Number(product.price) || 0;
      } else if (item.product_name !== item.linked_name) {
        item.product_id = null;
        item.barcode = '';
      }
      renderDocumentSection();
    }
  }

  function handleDocumentItemsClick(event) {
    const button = event.target.closest('.doc-remove-btn');
    if (!button) return;
    const index = Number(button.dataset.index);
    state.documentForm.items.splice(index, 1);
    if (!state.documentForm.items.length) state.documentForm.items.push(createDocumentItem());
    renderDocumentSection();
  }

  function handleCountItemsInput(event) {
    const index = Number(event.target.dataset.index);
    if (!Number.isInteger(index)) return;
    const item = state.countForm.items[index];
    if (!item) return;
    if (event.target.classList.contains('count-actual-input')) {
      item.actual_quantity = Number(event.target.value || 0);
      renderCountsSection();
    }
  }

  function handleCountItemsChange(event) {
    const index = Number(event.target.dataset.index);
    if (!Number.isInteger(index)) return;
    const item = state.countForm.items[index];
    if (!item) return;
    if (event.target.classList.contains('count-product-input')) {
      item.product_name = event.target.value;
      const product = findProductByLookup(item.product_name);
      if (product) {
        item.product_id = Number(product.id);
        item.product_name = product.name;
        item.linked_name = product.name;
        item.barcode = product.barcode || '';
        item.unit_price = Number(product.price) || 0;
        item.actual_quantity = getCountSystemQuantity(item);
      } else if (item.product_name !== item.linked_name) {
        item.product_id = null;
        item.barcode = '';
      }
      renderCountsSection();
    }
  }

  function handleCountItemsClick(event) {
    const button = event.target.closest('.count-remove-btn');
    if (!button) return;
    const index = Number(button.dataset.index);
    state.countForm.items.splice(index, 1);
    if (!state.countForm.items.length) state.countForm.items.push(createCountItem());
    renderCountsSection();
  }

  function syncWarehouseForm() {
    state.warehouseForm = {
      name: els.warehouseName.value,
      code: els.warehouseCode.value,
      location: els.warehouseLocation.value,
      notes: els.warehouseNotes.value
    };
  }

  function syncPartnerForm() {
    state.partnerForm = {
      name: els.partnerName.value,
      type: els.partnerType.value,
      phone: els.partnerPhone.value,
      address: els.partnerAddress.value,
      notes: els.partnerNotes.value
    };
  }

  function closeLedger() {
    state.ledgerModal.open = false;
    renderLedgerModal();
  }

  function closeCountModal() {
    state.countModal.open = false;
    renderCountModal();
  }

  function closeSettlementModal() {
    state.settlementModal.open = false;
    renderSettlementModal();
  }

  function cacheElements() {
    const ids = [
      'refreshButton', 'statsGrid', 'documentType', 'documentWarehouse', 'documentPartner',
      'documentPartnerLabel', 'documentPaid', 'documentNotes', 'documentAddItem',
      'documentSaveButton', 'documentSearch', 'documentTypeFilter', 'documentItemsBody',
      'documentError', 'documentSummaryTotal', 'documentSummaryPaid', 'documentSummaryEffect',
      'documentRecentList', 'documentsHistoryBody', 'documentNote', 'balanceWarehouseFilter',
      'balanceSearch', 'balancesBody', 'countWarehouse', 'countNotes', 'countAddItem',
      'countSaveButton', 'countSearch', 'countWarehouseFilter', 'countItemsBody', 'countError',
      'countSummaryItems', 'countSummaryQty', 'countSummaryValue', 'countNowLabel',
      'countHistoryBody', 'countNote', 'debtTypeFilter', 'debtSearch', 'debtsBody',
      'warehouseForm', 'warehouseName', 'warehouseCode', 'warehouseLocation', 'warehouseNotes',
      'warehouseSaveButton', 'partnerForm', 'partnerName', 'partnerType', 'partnerPhone',
      'partnerAddress', 'partnerNotes', 'partnerSaveButton', 'warehouseListBody',
      'setupNote', 'productsDatalist', 'ledgerModal', 'ledgerTitle', 'ledgerSummary',
      'ledgerBody', 'ledgerClose', 'countModal', 'countModalTitle', 'countModalSummary',
      'countModalBody', 'countModalClose', 'settlementModal', 'settlementTitle',
      'settlementAmount', 'settlementNotes', 'settlementSaveButton', 'settlementClose',
      'settlementCancel', 'logoutButton'
    ];
    ids.forEach((id) => { els[id] = document.getElementById(id); });
  }

  async function init() {
    cacheElements();
    bindEvents();
    state.currentUser = await getCurrentUser();
    await refreshAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
