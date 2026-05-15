
const { createApp, ref, computed, onMounted, nextTick } = Vue;

createApp({
  setup() {
    const settings       = ref({});
    const allProducts    = ref([]);
    const productsLoaded = ref(false);
    const searchQuery    = ref('');
    const cartItems      = ref([]);
    const discount       = ref(0);
    const searchInput    = ref(null);
    const todayStats     = ref({});

    // Payment
    const showPayment   = ref(false);
    const paidDisplay   = ref('');
    const paymentMethod = ref('cash');
    const saving        = ref(false);
    const lastInvoice   = ref(null);
    const cartItemsSnapshot = ref([]);
    const receiptMeta = ref({
      subtotal: 0,
      discount: 0,
      paid_amount: 0,
      payment_method: 'cash',
      cashier_name: '',
      printed_at: ''
    });

    // Computed
    const subtotal = computed(() =>
      cartItems.value.reduce((s, i) => s + i.unit_price * i.quantity, 0)
    );
    const netTotal = computed(() => Math.max(0, subtotal.value - (discount.value || 0)));
    const paidAmount = computed(() => {
      const v = parseFloat(paidDisplay.value);
      return isNaN(v) ? 0 : v;
    });
    const change = computed(() => Math.max(0, paidAmount.value - netTotal.value));
    const quickAmounts = computed(() => {
      const t = netTotal.value;
      const candidates = [50, 100, 200, 500].filter(v => v >= t);
      return candidates.slice(0, 3);
    });

    const filteredProducts = computed(() => {
      const q = searchQuery.value.trim().toLowerCase();
      if (!q) return allProducts.value;
      return allProducts.value.filter(p =>
        p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q))
      );
    });

    function formatMoney(amount) {
      const cur = settings.value.currency || 'ج.م';
      const pos = settings.value.currency_position || 'after';
      const val = parseFloat(amount || 0).toFixed(2);
      return pos === 'before' ? `${cur} ${val}` : `${val} ${cur}`;
    }

    async function loadSettings() {
      const r = await fetch('/api/settings');
      const d = await r.json();
      if (d.success) settings.value = d.data;
    }

    async function loadProducts() {
      productsLoaded.value = false;
      const r = await fetch('/api/products');
      const d = await r.json();
      if (d.success) {
        allProducts.value = d.data;
        productsLoaded.value = true;
        // cache in localStorage for offline
        try { localStorage.setItem('pos_products', JSON.stringify(d.data)); } catch {}
      } else {
        // try cache
        try {
          const cached = localStorage.getItem('pos_products');
          if (cached) { allProducts.value = JSON.parse(cached); productsLoaded.value = true; }
        } catch {}
      }
    }

    async function loadTodayStats() {
      const r = await fetch('/api/invoices/stats/today');
      const d = await r.json();
      if (d.success) todayStats.value = d.data;
    }

    function reloadProducts() { loadProducts(); loadTodayStats(); }

    function addToInvoice(product) {
      const existing = cartItems.value.find(i => i.product_id === product.id);
      if (existing) {
        existing.quantity++;
      } else {
        cartItems.value.push({
          product_id:   product.id,
          product_name: product.name,
          barcode:      product.barcode,
          unit:         product.unit,
          unit_price:   parseFloat(product.price),
          quantity:     1,
        });
      }
      // clear search after adding
      searchQuery.value = '';
      focusSearch();
    }

    function removeItem(idx) { cartItems.value.splice(idx, 1); }
    function increaseQty(idx) { cartItems.value[idx].quantity++; }
    function decreaseQty(idx) {
      if (cartItems.value[idx].quantity > 1) cartItems.value[idx].quantity--;
      else removeItem(idx);
    }
    function clearCart() {
      if (!cartItems.value.length) return;
      if (confirm('مسح الفاتورة الحالية؟')) {
        cartItems.value = [];
        discount.value = 0;
      }
    }

    function focusSearch() {
      nextTick(() => searchInput.value?.focus());
    }

    function handleSearchEnter() {
      if (filteredProducts.value.length === 1) {
        addToInvoice(filteredProducts.value[0]);
      }
    }

    function clearSearch() { searchQuery.value = ''; focusSearch(); }

    function addDiscount() {
      const val = prompt('أدخل قيمة الخصم:', discount.value || 0);
      if (val !== null && !isNaN(parseFloat(val))) {
        discount.value = Math.max(0, parseFloat(val));
      }
    }

    function openPayment() {
      if (!cartItems.value.length) return;
      setPaid(netTotal.value);
      paymentMethod.value = 'cash';
      showPayment.value = true;
    }

    function numpadPress(key) {
      if (key === 'C') { paidDisplay.value = ''; return; }
      if (key === '⌫') { paidDisplay.value = paidDisplay.value.slice(0, -1); return; }
      if (key === '.' && paidDisplay.value.includes('.')) return;
      if (paidDisplay.value.length >= 10) return;
      paidDisplay.value += key;
    }

    function setPaid(amount) {
      paidDisplay.value = parseFloat(amount).toFixed(2).replace(/\.00$/, '');
    }

    function recalc() {
      setPaid(netTotal.value);
    }

    function paymentMethodLabel(method) {
      if (method === 'card') return 'بطاقة';
      if (method === 'other') return 'أخرى';
      return 'نقدي';
    }

    async function completeSale() {
      if (saving.value) return;
      saving.value = true;
      try {
        const payload = {
          items: cartItems.value,
          discount: discount.value || 0,
          paid_amount: Math.max(netTotal.value, paidAmount.value),
          payment_method: paymentMethod.value,
        };
        const r = await fetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json();
        if (d.success) {
          lastInvoice.value = d.invoice;
          cartItemsSnapshot.value = [...cartItems.value];
          receiptMeta.value = {
            subtotal: subtotal.value,
            discount: discount.value || 0,
            paid_amount: Math.max(netTotal.value, paidAmount.value),
            payment_method: paymentMethod.value,
            cashier_name: (currentUser.value && (currentUser.value.full_name || currentUser.value.username)) || 'الكاشير',
            printed_at: new Date().toLocaleString('ar-EG')
          };
          showPayment.value = false;
          showToast(`✅ تم البيع بنجاح! الباقي: ${formatMoney(d.invoice.change_amount)}`, 'success');

          // print receipt
          await nextTick();
          setTimeout(() => window.print(), 200);

          // reset
          cartItems.value = [];
          discount.value = 0;
          paidDisplay.value = '';
          await loadTodayStats();
          // refresh stock
          await loadProducts();
          focusSearch();
        } else {
          showToast(d.message || 'حدث خطأ', 'error');
        }
      } catch {
        showToast('خطأ في الاتصال', 'error');
      } finally {
        saving.value = false;
      }
    }

    function doLogout() {
      if (confirm('تسجيل الخروج؟')) logout();
    }

    onMounted(async () => {
      await loadSettings();
      await loadProducts();
      await loadTodayStats();
      focusSearch();
    });

    return {
      settings, allProducts, productsLoaded, searchQuery, searchInput,
      cartItems, discount, todayStats,
      showPayment, paidDisplay, paymentMethod, saving, lastInvoice, cartItemsSnapshot, receiptMeta,
      subtotal, netTotal, paidAmount, change, quickAmounts, filteredProducts,
      formatMoney, loadProducts, reloadProducts, addToInvoice, removeItem,
      increaseQty, decreaseQty, clearCart, focusSearch, handleSearchEnter, clearSearch,
      addDiscount, openPayment, numpadPress, setPaid, recalc, paymentMethodLabel, completeSale, doLogout,
    };
  }
}).mount('#app');

