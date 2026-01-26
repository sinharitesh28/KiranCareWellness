// drugDispensing.js - Unified Layout (Quick First)
class MedicineDispensing {
    constructor() {
        this.selectedItems = [];
        this.currentCustomer = null;
        
        // Mode States
        this.isQuickMode = true; 
        this.quickModeItem = null;
        this.isEditMode = false;
        this.editingTransactionId = null;

        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadUserInfo();
        this.setMode('quick'); // Enforce Quick Mode start
        this.handlePaymentMethodSelection();
    }

    async loadUserInfo() {
        try {
            const res = await this.apiCall('/auth/user-info', 'GET');
            if (res.success && res.user) {
                const userEl = document.getElementById('user-id');
                if (userEl) userEl.textContent = `User: ${res.user.employeeCode} (${res.user.role})`;
            }
        } catch (e) { console.warn('Could not load user info:', e.message); }
    }

    handlePaymentMethodSelection() {
        document.querySelectorAll('input[name="paymentMethod"], input[name="quickPayment"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const groupName = e.target.name;
                document.querySelectorAll(`input[name="${groupName}"]`).forEach(r => {
                    const label = r.closest('.payment-option');
                    if(r.checked) {
                        label.classList.add('border-primary', 'bg-green-50');
                        label.classList.remove('border-gray-200');
                    } else {
                        label.classList.remove('border-primary', 'bg-green-50');
                        label.classList.add('border-gray-200');
                    }
                });
            });
        });
    }

    bindEvents() {
        document.getElementById('modeQuick').onclick = () => this.setMode('quick');
        document.getElementById('modeStandard').onclick = () => this.setMode('standard');

        const searchInput = document.getElementById('medicineSearch');
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.handleSearchInput(e.target.value.trim()), 300);
        });

        // History Search
        const histSearch = document.getElementById('historySearch');
        let histTimeout;
        histSearch.addEventListener('input', (e) => {
            clearTimeout(histTimeout);
            histTimeout = setTimeout(() => this.handleHistorySearch(e.target.value.trim()), 400);
        });

        document.getElementById('closeQtySheet').onclick = () => this.closeBottomSheet();
        document.getElementById('qtyOverlay').onclick = () => this.closeBottomSheet();
        document.getElementById('unitStrip').onclick = () => this.setQuickUnit('pack');
        document.getElementById('unitLoose').onclick = () => this.setQuickUnit('loose');

        document.querySelectorAll('.numpad-btn').forEach(btn => {
            btn.onclick = (e) => this.handleNumpad(e.currentTarget);
        });

        document.getElementById('fabCheckout').onclick = () => this.saveBill();
        document.getElementById('saveBill').onclick = () => this.saveBill();
        document.getElementById('cancelEdit').onclick = () => this.exitEditMode();
        
        document.getElementById('addManualItem').onclick = () => this.addManualItem();
        document.getElementById('customerMobile').onblur = (e) => this.handleCustomerMobileBlur(e);
    }

    handleCustomerMobileBlur(e) {
        const mobile = e.target.value.trim();
        if (mobile.length === 10) {
            this.apiCall('/api/dispense/search-customer', 'GET', { mobile }).then(res => {
                if (res.success && res.customer) {
                    document.getElementById('customerName').value = res.customer.name || '';
                    document.getElementById('customerEmail').value = res.customer.email || '';
                    this.showToast(`Welcome back, ${res.customer.name}`);
                }
            });
        }
    }

    setMode(mode) {
        if(this.isEditMode && mode === 'quick') {
            return this.showToast("Finish modification first or Cancel", "error");
        }

        this.isQuickMode = (mode === 'quick');
        const qBtn = document.getElementById('modeQuick');
        const sBtn = document.getElementById('modeStandard');
        const customerSec = document.getElementById('customerSection');
        const stdFooter = document.getElementById('standardFooter');
        const fab = document.getElementById('fabCheckout');

        if (this.isQuickMode) {
            qBtn.className = "px-4 py-2 rounded-md text-sm font-semibold transition-all bg-white shadow text-primary";
            sBtn.className = "px-4 py-2 rounded-md text-sm font-semibold text-gray-500 transition-all hover:text-primary";
            customerSec.classList.add('hidden');
            stdFooter.classList.add('hidden');
            fab.classList.add('visible');
        } else {
            sBtn.className = "px-4 py-2 rounded-md text-sm font-semibold transition-all bg-white shadow text-primary";
            qBtn.className = "px-4 py-2 rounded-md text-sm font-semibold text-gray-500 transition-all hover:text-primary";
            customerSec.classList.remove('hidden');
            stdFooter.classList.remove('hidden');
            fab.classList.remove('visible');
            // Auto-load history on entering standard mode if not already searching
            if(!document.getElementById('historySearch').value) this.handleHistorySearch('');
        }
    }

    // --- Search Logic ---

    async handleSearchInput(query) {
        if (query.length < 2) return this.hideSearchDropdown();
        try {
            const category = document.getElementById('searchCategory').value;
            const res = await this.apiCall('/api/dispense/search-medicines-with-dose', 'GET', { query, category });
            if (res.success) this.displaySearchResults(res.medicines);
        } catch (e) { console.error(e); }
    }

    displaySearchResults(medicines) {
        const dropdown = document.getElementById('searchResultsDropdown');
        dropdown.innerHTML = '';
        if (medicines.length === 0) {
            dropdown.innerHTML = '<div class="p-4 text-gray-500 text-center">No medicines found</div>';
        } else {
            medicines.forEach(med => {
                const div = document.createElement('div');
                div.className = 'p-4 border-b hover:bg-gray-50 cursor-pointer flex justify-between items-center';
                div.innerHTML = `
                    <div>
                        <div class="font-bold flex items-center">${med.item_name} 
                            <i class="fas fa-info-circle ml-2 text-blue-400 info-btn"></i>
                        </div>
                        <div class="text-xs text-gray-500">MRP: ₹${med.mrp} | Stock: ${med.quantity}</div>
                    </div>
                    <i class="fas fa-plus-circle text-primary text-xl"></i>
                `;
                div.querySelector('.info-btn').onclick = (e) => {
                    e.stopPropagation();
                    this.showInfoPopup(med.mrp, med.rate || med.mrp, parseInt(med.packing) || 1, 'strip');
                };
                div.onclick = () => {
                    if (this.isQuickMode) this.openQuickQuantitySheet(med);
                    else this.addMedicineToTable(med);
                    this.hideSearchDropdown();
                    document.getElementById('medicineSearch').value = '';
                };
                dropdown.appendChild(div);
            });
        }
        dropdown.classList.remove('hidden');
    }

    hideSearchDropdown() { document.getElementById('searchResultsDropdown').classList.add('hidden'); }

    // --- History & Modification ---

    async handleHistorySearch(query) {
        try {
            const res = await this.apiCall('/api/dispense/search-invoices', 'GET', { query });
            if(res.success) this.renderHistoryTable(res.transactions);
        } catch(e) { console.error(e); }
    }

    renderHistoryTable(transactions) {
        const tbody = document.getElementById('historyTableBody');
        tbody.innerHTML = '';
        if(!transactions || transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-gray-400">No transactions found</td></tr>';
            return;
        }
        transactions.forEach(t => {
            const row = document.createElement('tr');
            row.className = "border-b hover:bg-gray-50";
            row.innerHTML = `
                <td class="py-3 px-4 font-medium text-gray-900">${t.bill_number}</td>
                <td class="py-3 px-4">${t.customer_name || 'Walk-in'}<br><span class="text-[10px] opacity-50">${t.customer_mobile || ''}</span></td>
                <td class="py-3 px-4 text-right font-bold">₹${parseFloat(t.total_amount).toFixed(2)}</td>
                <td class="py-3 px-4 text-center">
                    <div class="flex justify-center gap-3">
                        <button onclick="window.open('/api/dispense/generate-pdf/${t.id}')" class="text-blue-500 hover:text-blue-700" title="View PDF"><i class="fas fa-file-pdf"></i></button>
                        <button onclick="window.dispense.enterEditMode('${t.id}')" class="text-quarterly hover:text-orange-700" title="Modify/Return"><i class="fas fa-edit"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    async enterEditMode(id) {
        try {
            this.showLoading('Loading Bill Details...');
            const res = await this.apiCall(`/api/dispense/transaction/${id}`, 'GET');
            if(res.success) {
                this.isEditMode = true;
                this.editingTransactionId = id;
                this.selectedItems = res.items.map(i => ({
                    ...i,
                    id: i.id, // Keep DB ID for matching if needed, though we replace all on save
                    mrp: parseFloat(i.mrp),
                    selling_price: parseFloat(i.selling_price),
                    total_price: parseFloat(i.total_price),
                    quantity: i.quantity,
                    is_loose: !!i.dose_dispensing
                }));

                // Populate Customer
                document.getElementById('customerName').value = res.transaction.customer_name || '';
                document.getElementById('customerMobile').value = res.transaction.customer_mobile || '';
                
                // Switch UI
                this.setMode('standard');
                document.getElementById('saveBill').textContent = "Update & Return";
                document.getElementById('cancelEdit').classList.remove('hidden');
                
                this.refreshTable();
                this.showToast("Modifying Bill #" + res.transaction.bill_number);
            }
        } catch(e) { this.showToast("Failed to load bill", "error"); }
        finally { this.hideLoading(); }
    }

    exitEditMode() {
        this.isEditMode = false;
        this.editingTransactionId = null;
        this.selectedItems = [];
        document.getElementById('saveBill').textContent = "Finalize & Print";
        document.getElementById('cancelEdit').classList.add('hidden');
        document.getElementById('customerName').value = '';
        document.getElementById('customerMobile').value = '';
        this.refreshTable();
    }

    // --- Info Popup ---

    showInfoPopup(mrp, rate, pkg, mode) {
        const popup = document.getElementById('infoPopup');
        const valEl = document.getElementById('infoValue');
        const typeEl = document.getElementById('infoType');
        const labelEl = document.getElementById('infoLabel');
        const isUnit = mode === 'unit';
        const displayMrp = isUnit ? (mrp / pkg) : mrp;
        const displayRate = isUnit ? (rate / pkg) : rate;

        valEl.innerHTML = `
            <div class="space-y-1 text-center">
                <div class="text-sm font-bold text-secondary">Rate: ₹${parseFloat(displayRate).toFixed(2)}</div>
                <div class="text-[11px] opacity-70">MRP: ₹${parseFloat(displayMrp).toFixed(2)}</div>
            </div>
        `;
        typeEl.textContent = isUnit ? `Single Unit (Pkg: ${pkg})` : `Full Strip (Pkg: ${pkg})`;
        labelEl.textContent = 'Price Details';
        popup.classList.add('active');
        if (this.infoTimeout) clearTimeout(this.infoTimeout);
        this.infoTimeout = setTimeout(() => popup.classList.remove('active'), 1200);
    }

    // --- Table & Cart Logic ---

    openQuickQuantitySheet(med) {
        this.quickModeItem = { ...med, tempQty: 1, unitType: 'pack', packSize: parseInt(med.packing) || 1 };
        document.getElementById('qtyItemName').textContent = med.item_name;
        document.getElementById('qtyStockDisplay').textContent = med.quantity;
        document.getElementById('qtyMrpDisplay').textContent = med.mrp;
        this.setQuickUnit('pack');
        this.updateNumpadDisplay();
        document.getElementById('qtyOverlay').classList.add('active');
        document.getElementById('qtyBottomSheet').classList.add('active');
    }

    closeBottomSheet() {
        document.getElementById('qtyOverlay').classList.remove('active');
        document.getElementById('qtyBottomSheet').classList.remove('active');
        this.quickModeItem = null;
    }

    setQuickUnit(type) {
        if (!this.quickModeItem) return;
        this.quickModeItem.unitType = type;
        const p = document.getElementById('unitStrip'), l = document.getElementById('unitLoose');
        if (type === 'pack') {
            p.className = "flex-1 py-2 rounded-md text-sm font-semibold bg-white shadow text-primary";
            l.className = "flex-1 py-2 rounded-md text-sm font-semibold text-gray-500";
        } else {
            l.className = "flex-1 py-2 rounded-md text-sm font-semibold bg-white shadow text-primary";
            p.className = "flex-1 py-2 rounded-md text-sm font-semibold text-gray-500";
        }
    }

    handleNumpad(btn) {
        if (!this.quickModeItem) return;
        if (btn.id === 'numpadClear') this.quickModeItem.tempQty = 1;
        else if (btn.id === 'numpadAdd') return this.addQuickItemToCart();
        else {
            let s = this.quickModeItem.tempQty.toString();
            s = (this.quickModeItem.tempQty === 1) ? btn.dataset.val : s + btn.dataset.val;
            this.quickModeItem.tempQty = parseInt(s);
        }
        this.updateNumpadDisplay();
    }

    updateNumpadDisplay() { document.getElementById('qtyInputDisplay').textContent = this.quickModeItem.tempQty; }

    addQuickItemToCart() {
        if (!this.quickModeItem) return;
        const isLoose = this.quickModeItem.unitType === 'loose';
        const price = isLoose ? (this.quickModeItem.mrp / this.quickModeItem.packSize) : parseFloat(this.quickModeItem.mrp);
        const item = {
            id: Date.now() + Math.random(),
            stock_detail_id: this.quickModeItem.id,
            item_name: this.quickModeItem.item_name + (isLoose ? ` (${this.quickModeItem.tempQty} Loose)` : ''),
            mrp: parseFloat(this.quickModeItem.mrp),
            packing: this.quickModeItem.packSize,
            rate: parseFloat(this.quickModeItem.rate) || parseFloat(this.quickModeItem.mrp),
            selling_price: price,
            quantity: this.quickModeItem.tempQty,
            total_price: price * this.quickModeItem.tempQty,
            is_loose: isLoose,
            is_manual: false
        };
        this.selectedItems.push(item);
        this.refreshTable();
        this.closeBottomSheet();
        this.showToast('Added to cart');
    }

    addMedicineToTable(med) {
        const item = {
            id: Date.now() + Math.random(),
            stock_detail_id: med.id,
            item_name: med.item_name,
            mrp: parseFloat(med.mrp),
            rate: parseFloat(med.rate) || parseFloat(med.mrp),
            packing: parseInt(med.packing) || 1,
            selling_price: parseFloat(med.mrp),
            quantity: 1,
            total_price: parseFloat(med.mrp),
            is_loose: false,
            is_manual: false
        };
        this.selectedItems.push(item);
        this.refreshTable();
    }

    addManualItem() {
        const item = {
            id: Date.now() + Math.random(),
            stock_detail_id: null,
            item_name: 'Manual Item',
            mrp: 0, rate: 0, packing: 1, selling_price: 0, quantity: 1, total_price: 0,
            is_loose: false, is_manual: true
        };
        this.selectedItems.push(item);
        this.refreshTable();
    }

    addTableRow(item) {
        const tbody = document.getElementById('selectedItemsTable');
        const row = document.createElement('tr');
        row.className = 'bg-white border-b';
        const nameHtml = item.is_manual ? 
            `<input type="text" value="${item.item_name}" class="w-full p-1 border rounded text-xs" oninput="window.dispense.updateItemName('${item.id}', this.value)">` :
            `<div class="font-bold text-gray-800 flex items-center leading-tight">
                ${item.item_name} <i class="fas fa-info-circle ml-1.5 text-blue-400 info-btn cursor-pointer text-xs"></i>
            </div>
            <div class="text-[10px] text-gray-400">MRP: ₹${item.mrp.toFixed(2)}</div>`;

        row.innerHTML = `
            <td class="py-3 px-4">${nameHtml}</td>
            <td class="py-2 px-1"><input type="number" value="${item.quantity}" class="w-12 p-1 border rounded text-center text-sm" onchange="window.dispense.updateQty('${item.id}', this.value)"></td>
            <td class="py-2 px-1"><input type="number" value="${item.selling_price.toFixed(2)}" class="w-16 p-1 border rounded text-right text-sm" onchange="window.dispense.updatePrice('${item.id}', this.value)"></td>
            <td class="py-2 px-4 text-right relative group">
                <div class="font-bold text-primary text-sm">₹${item.total_price.toFixed(2)}</div>
                <button class="absolute -right-1 top-1/2 -translate-y-1/2 text-red-400 p-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition" onclick="window.dispense.removeItem('${item.id}')"><i class="fas fa-times-circle"></i></button>
            </td>
        `;
        row.querySelector('.info-btn')?.addEventListener('click', () => {
            this.showInfoPopup(item.mrp, item.rate || item.mrp, parseInt(item.packing) || 1, item.is_loose ? 'unit' : 'strip');
        });
        tbody.appendChild(row);
    }

    updateItemName(id, val) { const i = this.selectedItems.find(x => x.id == id); if(i) i.item_name = val; }
    updateQty(id, val) { 
        const i = this.selectedItems.find(x => x.id == id); 
        if(i) { i.quantity = parseInt(val) || 1; i.total_price = i.quantity * i.selling_price; this.refreshTable(); }
    }
    updatePrice(id, val) {
        const i = this.selectedItems.find(x => x.id == id);
        if(i) { i.selling_price = parseFloat(val) || 0; i.total_price = i.quantity * i.selling_price; this.refreshTable(); }
    }
    removeItem(id) {
        this.selectedItems = this.selectedItems.filter(x => x.id != id);
        this.refreshTable();
    }

    refreshTable() {
        const tbody = document.getElementById('selectedItemsTable');
        tbody.innerHTML = '';
        if(this.selectedItems.length === 0) {
            tbody.innerHTML = '<tr class="no-items-row"><td colspan="4" class="text-center py-8 text-gray-400 text-xs uppercase tracking-widest">Cart is Empty</td></tr>';
        } else {
            this.selectedItems.forEach(item => this.addTableRow(item));
        }
        this.calculateBillSummary();
    }

    calculateBillSummary() {
        const sub = this.selectedItems.reduce((s, i) => s + i.total_price, 0);
        const disc = parseFloat(document.getElementById('discountAmount')?.value) || 0;
        const type = document.getElementById('discountType')?.value || 'fixed';
        const finalDisc = type === 'percentage' ? (sub * disc / 100) : disc;
        const total = Math.max(0, sub - finalDisc);
        
        document.getElementById('totalAmount').textContent = `₹${total.toFixed(2)}`;
        document.getElementById('fabTotal').textContent = total.toFixed(2);
        if(document.getElementById('subtotalAmount')) document.getElementById('subtotalAmount').textContent = `₹${sub.toFixed(2)}`;
        
        const saveBtn = document.getElementById('saveBill');
        if(saveBtn) saveBtn.disabled = this.selectedItems.length === 0;
        return { totalAmount: total, subtotal: sub, discountAmount: disc, discountType: type };
    }

    // --- Save Transaction ---

    async saveBill() {
        if(this.selectedItems.length === 0) return this.showToast('Cart is empty', 'error');
        
        const payload = {
            transactionId: this.editingTransactionId, // Included only if in Edit Mode
            customer: this.isQuickMode ? { name: "Walk-in Customer", mobile: "0000000000" } : {
                name: document.getElementById('customerName').value || "Walk-in Customer",
                mobile: document.getElementById('customerMobile').value || "0000000000",
                email: document.getElementById('customerEmail').value
            },
            items: this.selectedItems,
            summary: this.calculateBillSummary(),
            paymentMethod: this.isQuickMode ? 'cash' : (document.querySelector('input[name="paymentMethod"]:checked')?.value || 'cash')
        };

        try {
            this.showLoading(this.isQuickMode ? 'Saving...' : 'Finalizing...');
            const endpoint = this.isEditMode ? '/api/dispense/update-transaction' : '/api/dispense/save-transaction';
            const res = await this.apiCall(endpoint, 'POST', payload);
            if (res.success) {
                if(this.isQuickMode) {
                    this.showExpressPopup(res.billNumber);
                    this.selectedItems = [];
                    this.refreshTable();
                } else {
                    this.showToast(this.isEditMode ? 'Updated Successfully' : 'Bill Saved!', 'success');
                    if(this.isEditMode) this.exitEditMode();
                    else {
                        this.selectedItems = [];
                        this.refreshTable();
                    }
                    window.location.href = `/api/dispense/generate-pdf/${res.transactionId}`;
                }
            } else this.showToast(res.error || 'Failed', 'error');
        } catch (e) { this.showToast('Failed', 'error'); }
        finally { this.hideLoading(); }
    }

    showExpressPopup(billNo) {
        const p = document.getElementById('billIdPopup'), f = document.getElementById('successFlash');
        document.getElementById('popupBillNo').textContent = `#${billNo}`;
        f.classList.add('active'); setTimeout(() => f.classList.remove('active'), 800);
        p.classList.remove('hidden'); setTimeout(() => p.classList.add('active'), 10);
        setTimeout(() => { p.classList.remove('active'); setTimeout(() => p.classList.add('hidden'), 400); }, 2000);
    }

    showToast(m, t='info') {
        let c = document.getElementById('toast-container');
        if(!c) { c = document.createElement('div'); c.id = 'toast-container'; c.style.cssText = "position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 2000;"; document.body.appendChild(c); }
        const d = document.createElement('div'); d.className = `px-6 py-3 rounded-full text-white mb-2 shadow-lg ${t==='error'?'bg-red-600':'bg-gray-800'}`;
        d.textContent = m; c.appendChild(d); setTimeout(() => d.remove(), 2000);
    }

    showLoading(msg) { document.getElementById('loading-overlay').classList.remove('hidden'); }
    hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

    async apiCall(u, m, d) {
        const o = { method: m, headers: { 'Content-Type': 'application/json' } };
        if(m==='GET' && d) u += '?' + new URLSearchParams(d).toString();
        else if(d) o.body = JSON.stringify(d);
        const r = await fetch(u, o); return await r.json();
    }
}

document.addEventListener('DOMContentLoaded', () => { window.dispense = new MedicineDispensing(); });
