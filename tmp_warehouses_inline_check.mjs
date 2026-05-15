

    import { createApp, ref, computed, onMounted, nextTick } from "vue.js";
    function localApi(url, opts = {}) {
      if (typeof window.api === 'function') {
        return window.api(url, opts);
      }

      return fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      })
        .then(async (res) => {
          if (res.status === 401) {
            window.location.href = '/';
            return null;
          }
          return res.json();
        })
        .catch(() => {
          localShowToast('خطأ في الاتصال بالخادم', 'error');
          return null;
        });
    }

    function localShowToast(message, type = 'success') {
      if (typeof window.showToast === 'function') {
        window.showToast(message, type);
        return;
      }
      console[type === 'error' ? 'error' : 'log'](message);
    }

    async function localGetCurrentUser() {
      if (typeof window.getCurrentUser === 'function') {
        return window.getCurrentUser();
      }

      const response = await localApi('/api/auth/me');
      if (!response || !response.success) {
        window.location.href = '/';
        return null;
      }
      return response.user;
    }

    async function localGetSettings() {
      if (typeof window.getSettings === 'function') {
        return window.getSettings();
      }

      const response = await localApi('/api/settings');
      return response && response.data ? response.data : {};
    }

    async function localLogout() {
      if (typeof window.logout === 'function') {
        return window.logout();
      }

      await localApi('/api/auth/logout', { method: 'POST' });
      window.location.href = '/';
    }

    function localFormatDate(value) {
      if (!value) return '-';
      const date = new Date(value);
      return date.toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }) + ' ' + date.toLocaleTimeString('ar-EG', {
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    createApp({
      setup() {
        const currentUser = ref(null);
        const loadingPage = ref(false);
        const activeSection = ref('documents');

        const dashboard = ref({
          warehouses_count: 0,
          total_stock_quantity: 0,
          documents_today: 0,
          counts_today: 0,
          customer_debt_total: 0,
          supplier_debt_total: 0
        });
        const warehouses = ref([]);
        const partners = ref([]);
        const products = ref([]);
        const documents = ref([]);
        const balances = ref([]);
        const stockCounts = ref([]);
        const documentTypes = ref([]);

        const currency = ref('ج.م');
        const currencyPosition = ref('after');

        const documentSaving = ref(false);
        const documentError = ref('');
        const documentFilters = ref({ type: '', search: '' });
        const documentForm = ref(createDocumentForm());
        const editingDocumentId = ref(null);
        const editingDocumentNumber = ref('');

        const balanceFilters = ref({ warehouse_id: '', search: '' });
        const countFilters = ref({ warehouse_id: '', search: '' });
        const debtFilters = ref({ type: '', search: '' });

        const warehouseForm = ref({ name: '', code: '', location: '', notes: '' });
        const warehouseSaving = ref(false);

        const partnerForm = ref({ name: '', type: 'customer', phone: '', address: '', notes: '' });
        const partnerSaving = ref(false);

        const showLedgerModal = ref(false);
        const ledgerPartner = ref(null);
        const ledgerEntries = ref([]);

        const countForm = ref(createCountForm());
        const countSaving = ref(false);
        const countError = ref('');
        const showCountDetailModal = ref(false);
        const selectedStockCount = ref(null);
        const selectedStockCountItems = ref([]);
        const showDocumentDetailModal = ref(false);
        const selectedDocument = ref(null);
        const selectedDocumentItems = ref([]);

        const showSettlementModal = ref(false);
        const settlementPartner = ref(null);
        const settlementForm = ref({ amount: 0, notes: '' });
        const settlementSaving = ref(false);

        const documentTypeMeta = {
          addition: { label: 'إذن إضافة', partnerType: 'supplier', debtSign: 1, partnerLabel: 'المورد' },
          issue: { label: 'إذن صرف', partnerType: 'customer', debtSign: 1, partnerLabel: 'العميل' },
          customer_return: { label: 'مرتجع عميل', partnerType: 'customer', debtSign: -1, partnerLabel: 'العميل' },
          supplier_return: { label: 'مرتجع مورد', partnerType: 'supplier', debtSign: -1, partnerLabel: 'المورد' }
        };

        function createDocumentItem(item = {}) {
          return {
            uid: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            product_id: item.product_id ? Number(item.product_id) : null,
            product_name: item.product_name || '',
            linked_name: item.product_name || '',
            barcode: item.barcode || '',
            quantity: Number(item.quantity ?? 1) || 1,
            unit_price: Number(item.unit_price ?? 0) || 0
          };
        }

        function createDocumentForm() {
          return {
            document_type: 'addition',
            warehouse_id: '',
            partner_id: '',
            paid_amount: 0,
            notes: '',
            items: [createDocumentItem()]
          };
        }

        function createCountItem(item = {}) {
          return {
            uid: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            product_id: item.product_id ? Number(item.product_id) : null,
            product_name: item.product_name || '',
            linked_name: item.product_name || '',
            barcode: item.barcode || '',
            actual_quantity: Number(item.actual_quantity ?? 0) || 0,
            unit_price: Number(item.unit_price ?? 0) || 0
          };
        }

        function createCountForm() {
          return {
            warehouse_id: '',
            notes: '',
            items: [createCountItem()]
          };
        }

        const isAdmin = computed(() => currentUser.value && currentUser.value.role === 'admin');
        const selectedDocumentType = computed(() => {
          const selected = documentTypeMeta[documentForm.value.document_type] || documentTypeMeta.addition;
          return selected;
        });
        const requiresPartner = computed(() => !!selectedDocumentType.value.partnerType);
        const availablePartners = computed(() => partners.value.filter((partner) => (
          !selectedDocumentType.value.partnerType || partner.type === selectedDocumentType.value.partnerType
        )));

        const documentSubtotal = computed(() => documentForm.value.items.reduce(
          (sum, item) => sum + lineTotal(item),
          0
        ));

        const documentDebtEffect = computed(() => {
          if (!requiresPartner.value) return 0;
          const remaining = Math.max(0, documentSubtotal.value - (Number(documentForm.value.paid_amount) || 0));
          return remaining * (selectedDocumentType.value.debtSign || 0);
        });

        const documentDebtEffectClass = computed(() => (
          documentDebtEffect.value > 0 ? 'status-positive' : 'status-zero'
        ));

        const documentDebtEffectLabel = computed(() => {
          const effect = documentDebtEffect.value;
          if (effect > 0) return `+ ${formatMoneyValue(effect)}`;
          if (effect < 0) return `- ${formatMoneyValue(Math.abs(effect))}`;
          return formatMoneyValue(0);
        });

        const filteredDocuments = computed(() => {
          const q = String(documentFilters.value.search || '').trim().toLowerCase();
          return documents.value.filter((doc) => {
            const matchesType = !documentFilters.value.type || doc.document_type === documentFilters.value.type;
            const haystack = `${doc.document_number || ''} ${doc.partner_name || ''} ${doc.created_by_name || ''} ${doc.item_names || ''}`.toLowerCase();
            const matchesSearch = !q || haystack.includes(q);
            return matchesType && matchesSearch;
          });
        });

        const filteredBalances = computed(() => {
          const warehouseId = Number(balanceFilters.value.warehouse_id) || null;
          const q = String(balanceFilters.value.search || '').trim().toLowerCase();
          return balances.value.filter((row) => {
            const matchesWarehouse = !warehouseId || Number(row.warehouse_id) === warehouseId;
            const haystack = `${row.product_name || ''} ${row.barcode || ''}`.toLowerCase();
            const matchesSearch = !q || haystack.includes(q);
            return matchesWarehouse && matchesSearch;
          });
        });

        const filteredStockCounts = computed(() => {
          const warehouseId = Number(countFilters.value.warehouse_id) || null;
          const q = String(countFilters.value.search || '').trim().toLowerCase();
          return stockCounts.value.filter((count) => {
            const matchesWarehouse = !warehouseId || Number(count.warehouse_id) === warehouseId;
            const haystack = `${count.count_number || ''} ${count.warehouse_name || ''}`.toLowerCase();
            const matchesSearch = !q || haystack.includes(q);
            return matchesWarehouse && matchesSearch;
          });
        });

        const filteredPartners = computed(() => {
          const q = String(debtFilters.value.search || '').trim().toLowerCase();
          return partners.value.filter((partner) => {
            const matchesType = !debtFilters.value.type || partner.type === debtFilters.value.type;
            const haystack = `${partner.name || ''} ${partner.phone || ''}`.toLowerCase();
            const matchesSearch = !q || haystack.includes(q);
            return matchesType && matchesSearch;
          });
        });

        const countTotalDifferenceQuantity = computed(() => countForm.value.items.reduce(
          (sum, item) => sum + countDifference(item),
          0
        ));

        const countTotalDifferenceValue = computed(() => countForm.value.items.reduce(
          (sum, item) => sum + countDifferenceValue(item),
          0
        ));

        const localNowLabel = computed(() => localFormatDate(new Date()));

        function formatMoneyValue(value) {
          const numeric = parseFloat(value || 0).toFixed(2);
          return currencyPosition.value === 'before'
            ? `${currency.value} ${numeric}`
            : `${numeric} ${currency.value}`;
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

        function formatDocumentType(type) {
          return (documentTypeMeta[type] && documentTypeMeta[type].label) || type || '-';
        }

        function canManageDocument(doc) {
          if (!currentUser.value || !doc) return false;
          return currentUser.value.role === 'admin' || Number(doc.created_by) === Number(currentUser.value.id);
        }

        function isManualDocument(doc) {
          return ['addition', 'issue', 'customer_return', 'supplier_return'].includes(doc?.document_type);
        }

        function canEditDocument(doc) {
          return Boolean(isAdmin.value && canManageDocument(doc) && isManualDocument(doc));
        }

        function canDeleteDocument(doc) {
          return Boolean(isAdmin.value && canManageDocument(doc) && isManualDocument(doc));
        }

        function lineTotal(item) {
          return (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
        }

        function findProductById(productId) {
          return products.value.find((product) => Number(product.id) === Number(productId)) || null;
        }

        function findProductByLookup(keyword) {
          const value = String(keyword || '').trim();
          if (!value) return null;
          return products.value.find((product) => (
            product.name === value || (product.barcode && product.barcode === value)
          )) || null;
        }

        function syncDocumentItem(item) {
          const typedValue = String(item.product_name || '').trim();
          const product = findProductByLookup(typedValue);

          if (!product) {
            if (typedValue !== String(item.linked_name || '').trim()) {
              item.product_id = null;
              item.barcode = '';
            }
            return;
          }

          item.product_id = Number(product.id);
          item.product_name = product.name;
          item.linked_name = product.name;
          item.barcode = product.barcode || '';
          if (!(Number(item.unit_price) > 0)) {
            item.unit_price = Number(product.price) || 0;
          }
        }

        function addDocumentItem() {
          documentForm.value.items.push(createDocumentItem());
        }

        function handleDocumentTypeChange() {
          documentForm.value.partner_id = '';
        }

        function removeDocumentItem(index) {
          documentForm.value.items.splice(index, 1);
          if (!documentForm.value.items.length) {
            documentForm.value.items.push(createDocumentItem());
          }
        }

        function getWarehouseProductBalance(warehouseId, productId) {
          return balances.value.find((row) => (
            Number(row.warehouse_id) === Number(warehouseId) &&
            Number(row.product_id) === Number(productId)
          )) || null;
        }

        function getCountSystemQuantity(item) {
          if (!item.product_id || !countForm.value.warehouse_id) return 0;
          const balanceRow = getWarehouseProductBalance(countForm.value.warehouse_id, item.product_id);
          return Number((balanceRow && balanceRow.quantity) || 0);
        }

        function countDifference(item) {
          return Number(item.actual_quantity || 0) - getCountSystemQuantity(item);
        }

        function countDifferenceValue(item) {
          return countDifference(item) * Number(item.unit_price || 0);
        }

        function syncCountItem(item) {
          const typedValue = String(item.product_name || '').trim();
          const product = findProductByLookup(typedValue);

          if (!product) {
            if (typedValue !== String(item.linked_name || '').trim()) {
              item.product_id = null;
              item.barcode = '';
            }
            return;
          }

          item.product_id = Number(product.id);
          item.product_name = product.name;
          item.linked_name = product.name;
          item.barcode = product.barcode || '';
          item.unit_price = Number(product.price) || 0;
          item.actual_quantity = getCountSystemQuantity(item);
        }

        function addCountItem() {
          countForm.value.items.push(createCountItem());
        }

        function handleCountWarehouseChange() {
          countForm.value.items.forEach((item) => {
            if (item.product_id) {
              item.actual_quantity = getCountSystemQuantity(item);
            }
          });
        }

        function removeCountItem(index) {
          countForm.value.items.splice(index, 1);
          if (!countForm.value.items.length) {
            countForm.value.items.push(createCountItem());
          }
        }

        async function loadSettingsData() {
          const settings = await localGetSettings();
          currency.value = settings.currency || 'ج.م';
          currencyPosition.value = settings.currency_position || 'after';
        }

        async function loadMeta() {
          const response = await localApi('/api/warehouses/meta');
          if (!response || !response.success) return;

          warehouses.value = response.data.warehouses || [];
          partners.value = response.data.partners || [];
          products.value = response.data.products || [];
          documentTypes.value = response.data.document_types || [];

          if (!documentForm.value.warehouse_id && warehouses.value.length) {
            documentForm.value.warehouse_id = warehouses.value[0].id;
          }
          if (!countForm.value.warehouse_id && warehouses.value.length) {
            countForm.value.warehouse_id = warehouses.value[0].id;
          }
        }

        async function loadDashboard() {
          const response = await localApi('/api/warehouses/dashboard');
          if (response && response.success) {
            dashboard.value = response.data || dashboard.value;
          }
        }

        async function loadDocuments() {
          const response = await localApi('/api/warehouses/documents');
          if (response && response.success) {
            documents.value = response.data || [];
          }
        }

        async function loadBalances() {
          const response = await localApi('/api/warehouses/balances');
          if (response && response.success) {
            balances.value = response.data || [];
          }
        }

        async function loadPartners() {
          const response = await localApi('/api/warehouses/partners');
          if (response && response.success) {
            partners.value = response.data || [];
          }
        }

        async function loadStockCounts() {
          const response = await localApi('/api/warehouses/stock-counts');
          if (response && response.success) {
            stockCounts.value = response.data || [];
          }
        }

        async function refreshAll() {
          loadingPage.value = true;
          try {
            await Promise.all([
              loadSettingsData(),
              loadMeta(),
              loadDashboard(),
              loadDocuments(),
              loadBalances(),
              loadPartners(),
              loadStockCounts()
            ]);
          } finally {
            loadingPage.value = false;
          }
        }

        async function saveDocument() {
          const preparedItems = documentForm.value.items
            .map((item) => {
              const typedName = String(item.product_name || '').trim();
              const matchedProduct = findProductByLookup(typedName);
              const keepLinked = item.product_id && typedName === String(item.linked_name || '').trim();

              return {
                product_id: matchedProduct
                  ? Number(matchedProduct.id)
                  : keepLinked
                    ? Number(item.product_id)
                    : null,
                product_name: matchedProduct ? matchedProduct.name : typedName,
                quantity: Number(item.quantity),
                unit_price: Number(item.unit_price)
              };
            })
            .filter((item) => item.product_name || item.quantity || item.unit_price);

          if (!preparedItems.length) {
            documentError.value = 'أضف صنفًا واحدًا على الأقل';
            return;
          }

          const invalidItem = preparedItems.find((item) => (
            !item.product_id ||
            !item.product_name ||
            !Number.isFinite(item.quantity) ||
            item.quantity <= 0 ||
            !Number.isFinite(item.unit_price) ||
            item.unit_price < 0
          ));

          if (invalidItem) {
            documentError.value = 'راجع الصنف والكمية والسعر قبل الحفظ';
            return;
          }

          documentSaving.value = true;
          documentError.value = '';

          const endpoint = editingDocumentId.value
            ? `/api/warehouses/documents/${editingDocumentId.value}`
            : '/api/warehouses/documents';
          const method = editingDocumentId.value ? 'PUT' : 'POST';

          const response = await localApi(endpoint, {
            method,
            body: {
              document_type: documentForm.value.document_type,
              warehouse_id: documentForm.value.warehouse_id,
              partner_id: requiresPartner.value ? documentForm.value.partner_id : null,
              paid_amount: Math.max(0, Number(documentForm.value.paid_amount) || 0),
              notes: String(documentForm.value.notes || '').trim(),
              items: preparedItems
            }
          });

          documentSaving.value = false;

          if (!response || !response.success) {
            documentError.value = (response && response.message) || 'تعذر حفظ الإذن';
            return;
          }

          localShowToast(response.message || 'تم حفظ الإذن', 'success');
          documentForm.value = createDocumentForm();
          editingDocumentId.value = null;
          editingDocumentNumber.value = '';
          if (warehouses.value.length) {
            documentForm.value.warehouse_id = warehouses.value[0].id;
          }
          await refreshAll();
        }

        async function startDocumentEditing(doc) {
          if (!canEditDocument(doc)) return;

          const response = await localApi(`/api/warehouses/documents/${doc.id}`);
          if (!response || !response.success) {
            localShowToast((response && response.message) || 'تعذر تحميل الإذن للتعديل', 'error');
            return;
          }

          const data = response.data;
          documentForm.value = {
            document_type: data.document_type,
            warehouse_id: data.warehouse_id ? Number(data.warehouse_id) : '',
            partner_id: data.partner_id ? Number(data.partner_id) : '',
            paid_amount: Number(data.paid_amount || 0),
            notes: data.notes || '',
            items: (data.items || []).map((item) => createDocumentItem({
              product_id: item.product_id,
              product_name: item.product_name,
              quantity: item.quantity,
              unit_price: item.unit_price
            }))
          };
          editingDocumentId.value = doc.id;
          editingDocumentNumber.value = doc.document_number || '';
          activeSection.value = 'documents';
          documentError.value = '';
          if (typeof window.scrollTo === 'function') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }

        function cancelDocumentEditing() {
          documentForm.value = createDocumentForm();
          editingDocumentId.value = null;
          editingDocumentNumber.value = '';
          documentError.value = '';
          if (warehouses.value.length) {
            documentForm.value.warehouse_id = warehouses.value[0].id;
          }
        }

        async function deleteDocument(doc) {
          if (!canDeleteDocument(doc)) return;
          if (!confirm(`حذف الإذن ${doc.document_number}؟`)) return;

          const response = await localApi(`/api/warehouses/documents/${doc.id}`, {
            method: 'DELETE'
          });

          if (!response || !response.success) {
            localShowToast((response && response.message) || 'تعذر حذف الإذن', 'error');
            return;
          }

          if (editingDocumentId.value === doc.id) {
            cancelDocumentEditing();
          }

          localShowToast(response.message || 'تم حذف الإذن', 'success');
          showDocumentDetailModal.value = false;
          await refreshAll();
        }

        async function saveStockCount() {
          const preparedItems = countForm.value.items
            .map((item) => {
              const typedName = String(item.product_name || '').trim();
              const matchedProduct = findProductByLookup(typedName);
              const keepLinked = item.product_id && typedName === String(item.linked_name || '').trim();

              return {
                product_id: matchedProduct
                  ? Number(matchedProduct.id)
                  : keepLinked
                    ? Number(item.product_id)
                    : null,
                product_name: matchedProduct ? matchedProduct.name : typedName,
                actual_quantity: Number(item.actual_quantity),
                unit_price: Number(item.unit_price)
              };
            })
            .filter((item) => item.product_name || item.actual_quantity || item.unit_price || item.product_id);

          if (!preparedItems.length) {
            countError.value = 'أضف صنفًا واحدًا على الأقل إلى الجرد';
            return;
          }

          const invalidItem = preparedItems.find((item) => (
            !item.product_id ||
            !item.product_name ||
            !Number.isFinite(item.actual_quantity) ||
            item.actual_quantity < 0 ||
            !Number.isFinite(item.unit_price) ||
            item.unit_price < 0
          ));

          if (!countForm.value.warehouse_id) {
            countError.value = 'اختر المخزن أولًا';
            return;
          }

          if (invalidItem) {
            countError.value = 'راجع بيانات أصناف الجرد قبل الحفظ';
            return;
          }

          countSaving.value = true;
          countError.value = '';

          const response = await localApi('/api/warehouses/stock-counts', {
            method: 'POST',
            body: {
              warehouse_id: countForm.value.warehouse_id,
              notes: String(countForm.value.notes || '').trim(),
              items: preparedItems
            }
          });

          countSaving.value = false;

          if (!response || !response.success) {
            countError.value = (response && response.message) || 'تعذر حفظ الجرد';
            return;
          }

          localShowToast(response.message || 'تم حفظ الجرد', 'success');
          countForm.value = createCountForm();
          if (warehouses.value.length) {
            countForm.value.warehouse_id = warehouses.value[0].id;
          }
          await refreshAll();
        }

        async function saveWarehouse() {
          warehouseSaving.value = true;
          const response = await localApi('/api/warehouses/warehouses', {
            method: 'POST',
            body: warehouseForm.value
          });
          warehouseSaving.value = false;

          if (!response || !response.success) {
            localShowToast((response && response.message) || 'تعذر إضافة المخزن', 'error');
            return;
          }

          localShowToast(response.message || 'تمت إضافة المخزن', 'success');
          warehouseForm.value = { name: '', code: '', location: '', notes: '' };
          await refreshAll();
        }

        async function savePartner() {
          partnerSaving.value = true;
          const response = await localApi('/api/warehouses/partners', {
            method: 'POST',
            body: partnerForm.value
          });
          partnerSaving.value = false;

          if (!response || !response.success) {
            localShowToast((response && response.message) || 'تعذر إضافة الطرف', 'error');
            return;
          }

          localShowToast(response.message || 'تمت إضافة الطرف', 'success');
          partnerForm.value = { name: '', type: 'customer', phone: '', address: '', notes: '' };
          await refreshAll();
        }

        async function openLedger(partner) {
          const response = await localApi(`/api/warehouses/partners/${partner.id}/ledger`);
          if (!response || !response.success) {
            localShowToast((response && response.message) || 'تعذر تحميل الكشف', 'error');
            return;
          }

          ledgerPartner.value = response.data.partner;
          ledgerEntries.value = response.data.ledger || [];
          showLedgerModal.value = true;
        }

        async function openStockCountDetail(countId) {
          const response = await localApi(`/api/warehouses/stock-counts/${countId}`);
          if (!response || !response.success) {
            localShowToast((response && response.message) || 'تعذر تحميل تفاصيل الجرد', 'error');
            return;
          }

          selectedStockCount.value = response.data;
          selectedStockCountItems.value = response.data.items || [];
          showCountDetailModal.value = true;
        }

        async function openDocumentDetail(documentId) {
          const response = await localApi(`/api/warehouses/documents/${documentId}`);
          if (!response || !response.success) {
            localShowToast((response && response.message) || 'تعذر تحميل تفاصيل الإذن', 'error');
            return;
          }

          selectedDocument.value = response.data;
          selectedDocumentItems.value = response.data.items || [];
          showDocumentDetailModal.value = true;
        }

        function openSettlement(partner) {
          settlementPartner.value = partner;
          settlementForm.value = {
            amount: Number(partner.balance) > 0 ? Number(partner.balance) : 0,
            notes: ''
          };
          showSettlementModal.value = true;
        }

        async function saveSettlement() {
          if (!settlementPartner.value) return;

          settlementSaving.value = true;
          const response = await localApi(`/api/warehouses/partners/${settlementPartner.value.id}/settlements`, {
            method: 'POST',
            body: settlementForm.value
          });
          settlementSaving.value = false;

          if (!response || !response.success) {
            localShowToast((response && response.message) || 'تعذر حفظ التسوية', 'error');
            return;
          }

          localShowToast(response.message || 'تم حفظ التسوية', 'success');
          showSettlementModal.value = false;
          await refreshAll();

          if (showLedgerModal.value && ledgerPartner.value && ledgerPartner.value.id === settlementPartner.value.id) {
            await openLedger(settlementPartner.value);
          }
        }

        function doLogout() {
          if (confirm('تسجيل الخروج؟')) localLogout();
        }

        onMounted(async () => {
          currentUser.value = await localGetCurrentUser();
          await refreshAll();

          // ضيف الكود ده بعد ما البيانات بتتحمل
          if (currentUser.value) {
            await nextTick(); // استنى لحد ما Vue يخلص التحديثات

            const avatarEl = document.getElementById('sidebar-avatar');
            const usernameEl = document.getElementById('sidebar-username');

            const displayName = currentUser.value.full_name || currentUser.value.username || currentUser.value.name || 'مستخدم';

            if (avatarEl && displayName) {
              avatarEl.textContent = displayName.charAt(0).toUpperCase();
            }

            if (usernameEl) {
              usernameEl.textContent = displayName;
            }
          }
        });


        return {
          currentUser,
          loadingPage,
          activeSection,
          dashboard,
          warehouses,
          partners,
          products,
          documents,
          balances,
          stockCounts,
          documentTypes,
          documentForm,
          editingDocumentId,
          editingDocumentNumber,
          documentSaving,
          documentError,
          documentFilters,
          balanceFilters,
          countFilters,
          debtFilters,
          warehouseForm,
          warehouseSaving,
          partnerForm,
          partnerSaving,
          showLedgerModal,
          ledgerPartner,
          ledgerEntries,
          countForm,
          countSaving,
          countError,
          showCountDetailModal,
          selectedStockCount,
          selectedStockCountItems,
          showDocumentDetailModal,
          selectedDocument,
          selectedDocumentItems,
          showSettlementModal,
          settlementPartner,
          settlementForm,
          settlementSaving,
          isAdmin,
          selectedDocumentType,
          requiresPartner,
          availablePartners,
          documentSubtotal,
          documentDebtEffectClass,
          documentDebtEffectLabel,
          filteredDocuments,
          filteredBalances,
          filteredStockCounts,
          filteredPartners,
          countTotalDifferenceQuantity,
          countTotalDifferenceValue,
          localNowLabel,
          formatMoneyValue,
          formatQty,
          signedMoney,
          signedQty,
          formatDate: localFormatDate,
          formatDocumentType,
          canManageDocument,
          canEditDocument,
          canDeleteDocument,
          lineTotal,
          findProductById,
          getCountSystemQuantity,
          countDifference,
          countDifferenceValue,
          syncDocumentItem,
          addDocumentItem,
          handleDocumentTypeChange,
          removeDocumentItem,
          syncCountItem,
          addCountItem,
          handleCountWarehouseChange,
          removeCountItem,
          refreshAll,
          saveDocument,
          startDocumentEditing,
          cancelDocumentEditing,
          deleteDocument,
          saveStockCount,
          saveWarehouse,
          savePartner,
          openLedger,
          openStockCountDetail,
          openDocumentDetail,
          openSettlement,
          saveSettlement,
          doLogout
        };
      }
    }).mount('#app');
  
