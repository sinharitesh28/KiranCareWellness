// drugDispensing.js - Updated with Dose Dispensing Feature
class MedicineDispensing {
    constructor() {
        this.selectedItems = [];
        this.currentCustomer = null;
        this.isManualAdd = false;
        this.barcodeScanner = null;
        this.currentStream = null;
        this.currentFacingMode = 'environment';
        this.codeReader = null;
        this.qrCodeObj = null; // Store QR code instance
        this.telegramQr = null; // Store Telegram QR instance
        this.botUsername = null; // Store Bot Username
        this.doseDispensingSearchMode = false; // Search filter for dose medicines
        this.handlePaymentMethodSelection();
        this.init();
    }

    // Add this method to handle payment method selection styling
    handlePaymentMethodSelection() {
        document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
            const label = radio.closest('.payment-option');

            // Set initial state
            if (radio.checked) {
                label.classList.add('selected');
                label.style.backgroundColor = '#00712D';
                label.style.color = 'white';
                label.style.borderColor = '#00712D';
            } else {
                label.classList.remove('selected');
                label.style.backgroundColor = '';
                label.style.color = '';
                label.style.borderColor = '#D1D5DB';
            }

            // Add click event to update styling
            radio.addEventListener('change', (e) => {
                document.querySelectorAll('.payment-option').forEach(lbl => {
                    lbl.classList.remove('selected');
                    lbl.style.backgroundColor = '';
                    lbl.style.color = '';
                    lbl.style.borderColor = '#D1D5DB';
                });

                if (e.target.checked) {
                    const selectedLabel = e.target.closest('.payment-option');
                    selectedLabel.classList.add('selected');
                    selectedLabel.style.backgroundColor = '#00712D';
                    selectedLabel.style.color = 'white';
                    selectedLabel.style.borderColor = '#00712D';
                }
            });
        });
    }

    init() {
        this.bindEvents();
        this.loadUserInfo();
        this.initBarcodeScanner();
        this.initZXing();
        this.handlePaymentMethodSelection();
        this.initDoseDispensing();
        this.fetchBotInfo();
    }

    // Initialize dose dispensing functionality
    initDoseDispensing() {
        // Dose dispensing checkbox event - this just filters search results
        document.getElementById('doseDispensingCheckbox').addEventListener('change', (e) => {
            this.doseDispensingSearchMode = e.target.checked;
            this.updateSearchPlaceholder();
            
            // If there's text in search, perform search with new mode
            const searchInput = document.getElementById('medicineSearch');
            if (searchInput.value.trim().length >= 2) {
                this.performSearch(searchInput.value.trim());
            }
        });
    }

    updateSearchPlaceholder() {
        const searchInput = document.getElementById('medicineSearch');
        if (this.doseDispensingSearchMode) {
            searchInput.placeholder = 'Search dose dispensing medicines...';
        } else {
            searchInput.placeholder = 'Search by drug name, code, or location...';
        }
    }

    initZXing() {
        // Check if ZXing is available
        if (!window.ZXing) {
            console.error('ZXing library not loaded. Please check the script tag.');
            this.showMessage(
                'Barcode scanner library not loaded. Some features may not work properly.',
                'warning'
            );
            return;
        }

        try {
            const { BrowserMultiFormatReader } = window.ZXing;
            this.codeReader = new BrowserMultiFormatReader();

            console.log('ZXing initialized successfully');

            // Test if we can list devices (this will help debug camera issues)
            this.listCameras().then(devices => {
                console.log('Available cameras:', devices.length);
            }).catch(err => {
                console.warn('Cannot list cameras:', err);
            });

        } catch (error) {
            console.error('Failed to initialize ZXing:', error);
            this.showMessage(
                'Barcode scanner initialization failed. You can still use manual barcode entry.',
                'warning'
            );
        }
    }

    // Helper method to list available cameras
    async listCameras() {
        if (!this.codeReader) {
            throw new Error('ZXing not initialized');
        }

        try {
            const devices = await this.codeReader.listVideoInputDevices();
            return devices;
        } catch (error) {
            console.error('Error listing cameras:', error);
            throw error;
        }
    }

    bindEvents() {
        // Customer events
        document.getElementById('customerMobile').addEventListener('blur', (e) => this.handleCustomerMobileBlur(e));
        document.getElementById('customerName').addEventListener('input', (e) => this.handleCustomerNameInput(e));
        document.getElementById('customerEmail').addEventListener('input', (e) => this.handleCustomerEmailInput(e));
        document.getElementById('connectTelegramBtn').addEventListener('click', () => this.openTelegramModal());
        document.getElementById('closeTelegramModal').addEventListener('click', () => this.closeTelegramModal());
        // Search events
        document.getElementById('medicineSearch').addEventListener('input', (e) => this.handleSearchInput(e));
        document.getElementById('searchCategory').addEventListener('change', () => this.handleSearch());
        document.getElementById('clearSearch').addEventListener('click', () => this.clearSearch());
        document.getElementById('scanBarcode').addEventListener('click', () => this.openBarcodeScanner());

        // Barcode scanner events
        document.getElementById('startScanner').addEventListener('click', () => this.startBarcodeScanner());
        document.getElementById('stopScanner').addEventListener('click', () => this.stopBarcodeScanner());
        document.getElementById('switchCamera').addEventListener('click', () => this.switchCamera());
        document.getElementById('searchBarcode').addEventListener('click', () => this.searchManualBarcode());
        document.getElementById('cancelBarcode').addEventListener('click', () => this.closeBarcodeScanner());
        document.getElementById('closeBarcodeModal').addEventListener('click', () => this.closeBarcodeScanner());

        // Manual barcode enter on press
        document.getElementById('manualBarcode').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchManualBarcode();
            }
        });

        // Action events
        document.getElementById('saveBill').addEventListener('click', () => this.saveBill());
        document.getElementById('emailBill').addEventListener('click', () => this.sendEmailBill());
        document.getElementById('printBill').addEventListener('click', () => this.printBill());
        document.getElementById('newTransaction').addEventListener('click', () => this.newTransaction());
        document.getElementById('saveDraft').addEventListener('click', () => this.saveDraft());

        // Discount calculation
        document.getElementById('discountAmount').addEventListener('input', () => this.calculateBillSummary());
        document.getElementById('discountType').addEventListener('change', () => this.calculateBillSummary());

        // Payment method change
        document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.handlePaymentMethodChange(e));
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => this.handleClickOutside(e));

        // Manual item addition
        document.getElementById('addManualItem').addEventListener('click', () => this.addManualItem());
    }

    initBarcodeScanner() {
        // Initialize barcode scanner modal events
        const modal = document.getElementById('barcodeModal');
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeBarcodeScanner();
            }
        });
    }

    async handleCustomerMobileBlur(event) {
        const mobile = event.target.value.trim();

        if (mobile.length > 0) {
            try {
                this.showLoading('Searching customer...');
                const response = await this.apiCall('/api/dispense/search-customer', 'GET', { mobile });

                if (response.success) {
                    if (response.exists) {
                        // Auto-fill customer name and email if available
                        if (response.customer.name) {
                            document.getElementById('customerName').value = response.customer.name;
                        }
                        if (response.customer.email) {
                            document.getElementById('customerEmail').value = response.customer.email;
                        }
                        this.currentCustomer = response.customer;
                        
                        const telegramBtn = document.getElementById('connectTelegramBtn');
                        telegramBtn.classList.remove('hidden');

                        // Check if already linked
                        if (this.currentCustomer.telegram_chat_id) {
                            telegramBtn.classList.remove('bg-blue-500', 'hover:bg-blue-600');
                            telegramBtn.classList.add('bg-green-500', 'hover:bg-green-600');
                            telegramBtn.innerHTML = '<i class="fas fa-check-circle text-xl mr-2"></i> Linked';
                            telegramBtn.disabled = true;
                            telegramBtn.title = "Customer already linked to Telegram";
                        } else {
                            telegramBtn.classList.add('bg-blue-500', 'hover:bg-blue-600');
                            telegramBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
                            telegramBtn.innerHTML = '<i class="fab fa-telegram-plane text-xl"></i>';
                            telegramBtn.disabled = false;
                            telegramBtn.title = "Connect Telegram Bot";
                        }

                        this.showMessage('Customer found!', 'success');
                    } else {
                        this.currentCustomer = null;
                        document.getElementById('connectTelegramBtn').classList.add('hidden');
                        // Clear email field for new customers
                        document.getElementById('customerEmail').value = '';
                        this.showMessage('New customer. You can enter details if needed.', 'info');
                    }
                }
            } catch (error) {
                console.error('Error searching customer:', error);
            } finally {
                this.hideLoading();
            }
        }
    }

    handleCustomerNameInput(event) {
        const name = event.target.value.trim();
        const mobile = document.getElementById('customerMobile').value.trim();
        const email = document.getElementById('customerEmail').value.trim();

        // Set current customer only if at least one field has value
        if (name || mobile || email) {
            this.currentCustomer = {
                mobile_no: mobile || null,
                name: name || null,
                email: email || null
            };
        } else {
            this.currentCustomer = null;
        }
    }

    handleCustomerEmailInput(event) {
        const email = event.target.value.trim();
        const mobile = document.getElementById('customerMobile').value.trim();
        const name = document.getElementById('customerName').value.trim();

        if (email || mobile || name) {
            this.currentCustomer = {
                mobile_no: mobile || null,
                name: name || null,
                email: email || null
            };
        } else {
            this.currentCustomer = null;
        }
    }

    handlePaymentMethodChange(event) {
        // No special validation needed for pay_later
        this.updateActionButtons();

        const method = event.target.value;
        const qrContainer = document.getElementById('upiQrContainer');

        if (method === 'upi') {
            qrContainer.classList.remove('hidden');
            this.generateUPIQRCode();
        } else {
            qrContainer.classList.add('hidden');
        }
    }

    async handleSearchInput(event) {
        const query = event.target.value.trim();

        if (query.length >= 2) {
            await this.performSearch(query);
        } else {
            this.hideSearchDropdown();
        }
    }

    async performSearch(query) {
        const category = document.getElementById('searchCategory').value;
        const doseDispensing = this.doseDispensingSearchMode;

        try {
            const response = await this.apiCall('/api/dispense/search-medicines-with-dose', 'GET', {
                query,
                category,
                doseDispensing: doseDispensing.toString()
            });

            if (response.success) {
                this.displaySearchResults(response.medicines);
            }
        } catch (error) {
            console.error('Search error:', error);
            this.showMessage('Search failed. Please try again.', 'error');
        }
    }

    displaySearchResults(medicines) {
        const dropdown = document.getElementById('searchResultsDropdown');

        if (medicines.length === 0) {
            dropdown.innerHTML = '<div class="p-3 text-sm text-gray-500">No medicines found</div>';
            dropdown.classList.remove('hidden');
            return;
        }

        let dropdownHTML = '';

        medicines.forEach(medicine => {
            const isDoseStock = medicine.stock_type === 'dose';
            const stockInfo = isDoseStock 
                ? `Doses: ${medicine.remaining_doses}/${medicine.total_doses}`
                : `Stock: ${medicine.quantity} (Packing: ${medicine.packing || 'N/A'})`;
            
            const stockClass = isDoseStock ? 'bg-blue-50 hover:bg-blue-100' : 'bg-white hover:bg-secondary/50';
            const stockBadge = isDoseStock 
                ? '<span class="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">Dose Stock</span>'
                : '';

            dropdownHTML += `
                <div class="p-3 text-sm text-gray-600 ${stockClass} cursor-pointer border-b transition duration-150 search-result-item"
                     data-medicine='${JSON.stringify(medicine).replace(/'/g, "\\'")}'
                     data-is-dose="${isDoseStock}"
                     title="${isDoseStock ? 'Dose MRP: ₹' + medicine.mrp : 'MRP: ₹' + medicine.mrp} | ${stockInfo}">
                    <div class="font-medium text-gray-800">
                        ${medicine.item_name}
                        ${stockBadge}
                    </div>
                    <div class="text-xs text-gray-500 mt-1">${medicine.item_desc || 'No description'}</div>
                    <div class="flex justify-between items-center mt-2 text-xs">
                        <span class="text-quarterly font-semibold">${isDoseStock ? 'Dose MRP' : 'MRP'}: ₹${medicine.mrp}</span>
                        <span class="text-primary font-semibold">${stockInfo}</span>
                    </div>
                </div>
            `;
        });

        dropdown.innerHTML = dropdownHTML;

        // Add click handlers - Dose dispensing decision is based on search result type
        dropdown.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const medicine = JSON.parse(e.currentTarget.getAttribute('data-medicine'));
                const isDoseStock = e.currentTarget.getAttribute('data-is-dose') === 'true';
                
                // If it's dose stock, add as dose item regardless of search mode
                if (isDoseStock) {
                    this.addDoseMedicineToTable(medicine);
                } else {
                    // If it's normal stock but we're in dose dispensing search mode, convert it
                    if (this.doseDispensingSearchMode) {
                        this.handleDoseMedicineSelection(medicine, false);
                    } else {
                        // Normal stock in normal mode - add as regular item
                        this.addMedicineToTable(medicine);
                    }
                }
                
                this.hideSearchDropdown();
                document.getElementById('medicineSearch').value = '';
            });
        });

        dropdown.classList.remove('hidden');
    }

    // Add regular medicine to table (for normal items)
    addMedicineToTable(medicine, isManual = false) {
        const existingItem = this.selectedItems.find(item =>
            item.stock_detail_id === medicine.id && !item.is_manual && !item.dose_dispensing
        );

        if (existingItem && !isManual) {
            existingItem.quantity += 1;
            existingItem.total_price = existingItem.selling_price * existingItem.quantity;
            this.updateTableRow(existingItem);
        } else {
            const initialSellingPrice = parseFloat(medicine.selling_price) || parseFloat(medicine.mrp) || 0;
            const newItem = {
                id: Date.now() + Math.random(),
                stock_detail_id: medicine.id,
                item_name: isManual ? 'Other' : medicine.item_name,
                item_description: medicine.item_desc || '',
                mrp: parseFloat(medicine.mrp) || 0,
                rate: parseFloat(medicine.rate) || parseFloat(medicine.mrp) || 0,
                selling_price: initialSellingPrice,
                quantity: 1,
                total_price: initialSellingPrice,
                location: medicine.location || '',
                dose_dispensing: false, // Explicitly false for normal items
                is_manual: isManual
            };

            this.selectedItems.push(newItem);
            this.addTableRow(newItem);
        }

        this.calculateBillSummary();
        this.updateActionButtons();
    }

    // Handle dose medicine selection (conversion if needed)
    async handleDoseMedicineSelection(medicine, isDoseStock) {
        if (isDoseStock) {
            // Medicine already in dose stock - add directly
            this.addDoseMedicineToTable(medicine);
        } else {
            // Need to convert normal stock to dose stock
            try {
                this.showLoading('Converting to dose dispensing stock...');
                
                const response = await this.apiCall('/api/dispense/convert-to-dose-stock', 'POST', {
                    stockDetailId: medicine.id
                });

                if (response.success) {
                    // Get the converted dose stock
                    const packing = response.packing;
                    const doseMrp = parseFloat((medicine.mrp / packing).toFixed(2));
                    const doseRate = medicine.rate ? parseFloat((medicine.rate / packing).toFixed(2)) : doseMrp;
                    // For dose, also default to MRP-based price
                    const doseSellingPrice = doseMrp;

                    const doseMedicine = {
                        ...medicine,
                        stock_type: 'dose',
                        dose_stock_id: response.doseStockId,
                        remaining_doses: packing,
                        total_doses: packing,
                        mrp: doseMrp,
                        rate: doseRate,
                        selling_price: doseSellingPrice
                    };
                    
                    this.addDoseMedicineToTable(doseMedicine);
                    this.showMessage(`Medicine converted to dose dispensing stock! (Packing: ${packing} doses)`, 'success');
                }
            } catch (error) {
                console.error('Dose conversion error:', error);
                this.showMessage('Failed to convert to dose dispensing: ' + error.message, 'error');
            } finally {
                this.hideLoading();
            }
        }
    }

    // Add dose medicine to table with auto-conversion
    async addDoseMedicineToTable(medicine) {
        const requiredDoses = 1; // Default quantity when adding
        
        try {
            // Ensure sufficient doses are available
            const ensureResponse = await this.apiCall('/api/dispense/ensure-dose-stock', 'POST', {
                stockDetailId: medicine.id,
                requiredDoses: requiredDoses
            });

            if (ensureResponse.success && ensureResponse.convertedUnits > 0) {
                this.showMessage(
                    `Automatically converted ${ensureResponse.convertedUnits} unit(s) to meet dose requirement.`, 
                    'info'
                );
            }

            // Add the medicine to table
            const existingItem = this.selectedItems.find(item => 
                item.dose_stock_id === medicine.dose_stock_id && item.dose_dispensing
            );

            if (existingItem) {
                existingItem.dose_quantity += 1;
                existingItem.quantity = existingItem.dose_quantity;
                existingItem.total_price = existingItem.dose_unit_price * existingItem.dose_quantity;
                this.updateTableRow(existingItem);
            } else {
                const doseSellingPrice = parseFloat(medicine.selling_price) || parseFloat(medicine.mrp) || 0;
                const newItem = {
                    id: Date.now() + Math.random(),
                    stock_detail_id: medicine.id,
                    dose_stock_id: medicine.dose_stock_id || medicine.id,
                    item_name: medicine.item_name + ' (Dose)',
                    item_description: medicine.item_desc || '',
                    mrp: parseFloat(medicine.mrp) || 0,
                    rate: parseFloat(medicine.rate) || parseFloat(medicine.mrp) || 0,
                    selling_price: doseSellingPrice,
                    quantity: 1,
                    dose_quantity: 1,
                    dose_unit_price: doseSellingPrice,
                    total_price: doseSellingPrice,
                    location: medicine.location || '',
                    dose_dispensing: true, // Explicitly true for dose items
                    is_manual: false
                };

                this.selectedItems.push(newItem);
                this.addTableRow(newItem);
            }

            this.calculateBillSummary();
            this.updateActionButtons();

        } catch (error) {
            console.error('Dose stock ensure error:', error);
            this.showMessage(
                `Cannot add dose medicine: ${error.error || error.message}`, 
                'error'
            );
        }
    }

    addTableRow(item) {
        const tbody = document.getElementById('selectedItemsTable');
        const noItemsRow = tbody.querySelector('.no-items-row');

        if (noItemsRow) {
            noItemsRow.remove();
        }

        const row = document.createElement('tr');
        row.className = 'bg-white border-b hover:bg-gray-50 transition duration-150';
        
        // Initialize dosage_days if not set
        if (!item.dosage_days) item.dosage_days = 1;

        if (item.dose_dispensing) {
            row.classList.add('dose-item-row');
            const title = `Dose MRP: ₹${item.mrp.toFixed(2)} | Dose Rate: ₹${item.rate.toFixed(2)}`;
            row.innerHTML = `
                <td class="py-3 px-3 font-medium text-gray-900 whitespace-nowrap">
                    <div class="flex items-center">
                        <span class="medicine-name-span cursor-help" title="${title}" data-title="${title}">
                            ${item.item_name}
                        </span>
                        <span class="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">Dose</span>
                    </div>
                    ${item.item_description ? `<div class="text-xs text-gray-500">${item.item_description}</div>` : ''}
                </td>
                <td class="py-3 px-3 text-right">
                    <input type="number" value="${item.selling_price}" min="0" step="0.01" 
                           class="w-20 text-right border rounded p-1 text-xs focus:ring-primary focus:border-primary selling-price"
                           data-id="${item.id}">
                </td>
                <td class="py-3 px-3 text-center">
                    <div class="flex items-center justify-center space-x-1">
                        <button class="w-6 h-6 flex items-center justify-center bg-gray-200 rounded quantity-decrease" 
                                data-id="${item.id}" type="button">-</button>
                        <input type="number" value="${item.dose_quantity}" min="1" 
                               class="w-12 text-center border rounded p-1 text-xs focus:ring-primary focus:border-primary dose-quantity"
                               data-id="${item.id}" title="Number of doses">
                        <button class="w-6 h-6 flex items-center justify-center bg-gray-200 rounded quantity-increase" 
                                data-id="${item.id}" type="button">+</button>
                    </div>
                    <div class="text-xs text-gray-500 mt-1">doses</div>
                </td>
                <td class="py-3 px-3 text-right font-semibold total-price" data-id="${item.id}">
                    ₹${item.total_price.toFixed(2)}
                </td>
                <td class="py-3 px-3 text-center">
                    <input type="text" class="w-24 text-center border rounded p-1 text-xs focus:ring-primary focus:border-primary dosage-schedule"
                           data-id="${item.id}" placeholder="09:00, 21:00" title="Enter times (HH:MM) separated by comma. e.g. 09:00, 14:00, 20:00">
                </td>
                <td class="py-3 px-3 text-center">
                    <button class="text-red-500 hover:text-red-700 remove-item" data-id="${item.id}" title="Remove item">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
        } else {
            const title = `MRP: ₹${item.mrp.toFixed(2)} | Rate: ₹${item.rate.toFixed(2)}`;
            row.innerHTML = `
                <td class="py-3 px-3 font-medium text-gray-900 whitespace-nowrap">
                    ${item.is_manual ?
                    `<input type="text" value="${item.item_name}" 
                               class="w-full p-1 border border-gray-300 rounded text-sm focus:ring-primary focus:border-primary item-name-input"
                               data-id="${item.id}" placeholder="Enter item name">` :
                    `<span class="medicine-name-span cursor-help" title="${title}" data-title="${title}">${item.item_name}</span>`
                }
                    ${item.item_description ? `<div class="text-xs text-gray-500">${item.item_description}</div>` : ''}
                </td>
                <td class="py-3 px-3 text-right">
                    <input type="number" value="${item.selling_price}" min="0" step="0.01" 
                           class="w-20 text-right border rounded p-1 text-xs focus:ring-primary focus:border-primary selling-price"
                           data-id="${item.id}">
                </td>
                <td class="py-3 px-3 text-center">
                    <div class="flex items-center justify-center space-x-1">
                        <button class="w-6 h-6 flex items-center justify-center bg-gray-200 rounded quantity-decrease" 
                                data-id="${item.id}" type="button">-</button>
                        <input type="number" value="${item.quantity}" min="1" 
                               class="w-12 text-center border rounded p-1 text-xs focus:ring-primary focus:border-primary quantity"
                               data-id="${item.id}">
                        <button class="w-6 h-6 flex items-center justify-center bg-gray-200 rounded quantity-increase" 
                                data-id="${item.id}" type="button">+</button>
                    </div>
                    <div class="text-xs text-gray-500 mt-1">units</div>
                </td>
                <td class="py-3 px-3 text-right font-semibold total-price" data-id="${item.id}">
                    ₹${item.total_price.toFixed(2)}
                </td>
                <td class="py-3 px-3 text-center">
                    <input type="text" class="w-24 text-center border rounded p-1 text-xs focus:ring-primary focus:border-primary dosage-schedule"
                           data-id="${item.id}" placeholder="09:00, 21:00" title="Enter times (HH:MM) separated by comma">
                </td>
                <td class="py-3 px-3 text-center">
                    <button class="text-red-500 hover:text-red-700 remove-item" data-id="${item.id}" title="Remove item">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
        }

        tbody.appendChild(row);

        // Add long-press support for mobile
        this.addLongPressListener(row.querySelector('.medicine-name-span'));

        // Add event listeners
        if (item.is_manual) {
            row.querySelector('.item-name-input').addEventListener('input', (e) => this.updateItemName(e));
        }
        
        row.querySelector('.selling-price').addEventListener('input', (e) => this.updateItemPrice(e));
        row.querySelector('.dosage-schedule').addEventListener('input', (e) => this.updateItemDosage(e));
        
        if (item.dose_dispensing) {
            row.querySelector('.quantity-decrease').addEventListener('click', (e) => this.decreaseQuantity(e));
            row.querySelector('.quantity-increase').addEventListener('click', (e) => this.increaseQuantity(e));
            row.querySelector('.dose-quantity').addEventListener('input', (e) => this.updateDoseQuantity(e));
            row.querySelector('.dose-quantity').addEventListener('focus', (e) => {
                e.target.select();
            });
        } else {
            row.querySelector('.quantity-decrease').addEventListener('click', (e) => this.decreaseQuantity(e));
            row.querySelector('.quantity-increase').addEventListener('click', (e) => this.increaseQuantity(e));
            row.querySelector('.quantity').addEventListener('input', (e) => this.updateItemQuantity(e));
            row.querySelector('.quantity').addEventListener('focus', (e) => {
                e.target.select();
            });
        }
        
        row.querySelector('.remove-item').addEventListener('click', (e) => this.removeItem(e));
    }

    addLongPressListener(element) {
        if (!element) return;

        let pressTimer;

        const start = (e) => {
            if (e.type === 'click' && e.button !== 0) return;
            pressTimer = window.setTimeout(() => {
                const title = element.getAttribute('data-title');
                this.showMessage(title, 'info');
            }, 800);
        };

        const cancel = (e) => {
            if (pressTimer !== null) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };

        element.addEventListener('mousedown', start);
        element.addEventListener('touchstart', start);
        element.addEventListener('click', cancel);
        element.addEventListener('mouseout', cancel);
        element.addEventListener('touchend', cancel);
        element.addEventListener('touchleave', cancel);
        element.addEventListener('touchcancel', cancel);
    }

    updateItemName(event) {
        const itemId = event.target.getAttribute('data-id');
        const newName = event.target.value.trim() || 'Other';
        const item = this.selectedItems.find(i => i.id == itemId);

        if (item) {
            item.item_name = newName;
        }
    }

    updateTableRow(item) {
        const row = document.querySelector(`tr:has(.selling-price[data-id="${item.id}"])`);
        if (row) {
            const nameElement = row.querySelector('.medicine-name-span');
            if (nameElement) {
                let title = '';
                if (item.dose_dispensing) {
                    title = `Dose MRP: ₹${item.mrp.toFixed(2)} | Dose Rate: ₹${item.rate.toFixed(2)}`;
                } else {
                    title = `MRP: ₹${item.mrp.toFixed(2)} | Rate: ₹${item.rate.toFixed(2)}`;
                }
                nameElement.setAttribute('title', title);
                nameElement.setAttribute('data-title', title);
            }

            if (item.dose_dispensing) {
                row.querySelector('.selling-price').value = item.selling_price;
                row.querySelector('.dose-quantity').value = item.dose_quantity;
                row.querySelector('.total-price').textContent = `₹${item.total_price.toFixed(2)}`;
            } else {
                row.querySelector('.selling-price').value = item.selling_price;
                row.querySelector('.quantity').value = item.quantity;
                row.querySelector('.total-price').textContent = `₹${item.total_price.toFixed(2)}`;
            }
        }
    }

    updateItemPrice(event) {
        const itemId = event.target.getAttribute('data-id');
        const newPrice = parseFloat(event.target.value) || 0;
        const item = this.selectedItems.find(i => i.id == itemId);

        if (item) {
            item.selling_price = newPrice;
            if (item.dose_dispensing) {
                item.dose_unit_price = newPrice;
                item.total_price = newPrice * item.dose_quantity;
            } else {
                item.total_price = newPrice * item.quantity;
            }
            this.updateTableRow(item);
            this.calculateBillSummary();
        }
    }

    updateItemDosage(event) {
        const itemId = event.target.getAttribute('data-id');
        const schedule = event.target.value.trim();
        const item = this.selectedItems.find(i => i.id == itemId);

        if (item) {
            item.dosage_schedule = schedule;
            this.calculateDosageDays(item);
        }
    }

    calculateDosageDays(item) {
        // Only calculate for items with dosage schedule
        if (!item.dosage_schedule) {
            item.dosage_days = 1;
            return;
        }

        // Count number of times per day (comma separated)
        const times = item.dosage_schedule.split(',').filter(t => t.trim().length > 0);
        const frequencyPerDay = times.length || 1;
        
        // Total units given
        const totalUnits = item.dose_dispensing ? item.dose_quantity : item.quantity;
        
        // Assume 1 unit per dose unless specified (could be an enhancement later)
        const unitsPerDose = 1; 
        
        // Calculate days: Total / (Frequency * UnitPerDose)
        const days = totalUnits / (frequencyPerDay * unitsPerDose);
        
        item.dosage_days = Math.max(1, Math.ceil(days));
        
        console.log(`Calculated days for ${item.item_name}: ${days} -> ${item.dosage_days} days (Freq: ${frequencyPerDay}, Total: ${totalUnits})`);
        
        // Optional: Update UI to show calculated days if we add a field for it
        // For now, maybe update the tooltip of the dosage input
        const input = document.querySelector(`.dosage-schedule[data-id="${item.id}"]`);
        if (input) {
            input.title = `Schedule: ${item.dosage_schedule} | Est. Duration: ${item.dosage_days} Days`;
        }
    }

    updateItemQuantity(event) {
        const itemId = event.target.getAttribute('data-id');
        const newQuantity = parseInt(event.target.value) || 1;
        const item = this.selectedItems.find(i => i.id == itemId);

        if (item && !item.dose_dispensing) {
            item.quantity = Math.max(1, newQuantity);
            item.total_price = item.selling_price * item.quantity;
            this.updateTableRow(item);
            this.calculateBillSummary();
        }
    }

    // Update dose quantity with auto-conversion
    async updateDoseQuantity(event) {
        const itemId = event.target.getAttribute('data-id');
        const newDoseQuantity = parseInt(event.target.value) || 1;
        const item = this.selectedItems.find(i => i.id == itemId);

        if (item && item.dose_dispensing) {
            try {
                const ensureResponse = await this.apiCall('/api/dispense/ensure-dose-stock', 'POST', {
                    stockDetailId: item.stock_detail_id,
                    requiredDoses: newDoseQuantity
                });

                if (ensureResponse.success) {
                    if (ensureResponse.convertedUnits > 0) {
                        this.showMessage(
                            `Automatically converted ${ensureResponse.convertedUnits} unit(s) to meet dose requirement.`, 
                            'info'
                        );
                    }

                    item.dose_quantity = Math.max(1, newDoseQuantity);
                    item.quantity = item.dose_quantity;
                    item.total_price = item.dose_unit_price * item.dose_quantity;
                    this.calculateDosageDays(item); // Recalculate days
                    this.updateTableRow(item);
                    this.calculateBillSummary();
                }
            } catch (error) {
                console.error('Dose quantity update error:', error);
                this.showMessage(
                    `Cannot update quantity: ${error.error || error.message}`, 
                    'error'
                );
                event.target.value = item.dose_quantity;
            }
        }
    }

    decreaseQuantity(event) {
        const itemId = event.target.closest('.quantity-decrease').getAttribute('data-id');
        const item = this.selectedItems.find(i => i.id == itemId);
        
        if (item) {
            if (item.dose_dispensing) {
                if (item.dose_quantity > 1) {
                    item.dose_quantity -= 1;
                    item.quantity = item.dose_quantity;
                    item.total_price = item.dose_unit_price * item.dose_quantity;
                    this.calculateDosageDays(item); // Recalculate days
                    this.updateTableRow(item);
                    this.calculateBillSummary();
                }
            } else {
                if (item.quantity > 1) {
                    item.quantity -= 1;
                    item.total_price = item.selling_price * item.quantity;
                    this.calculateDosageDays(item); // Recalculate days (if applied to regular items)
                    this.updateTableRow(item);
                    this.calculateBillSummary();
                }
            }
        }
    }

    // Increase quantity with dose support and auto-conversion
    async increaseQuantity(event) {
        const itemId = event.target.closest('.quantity-increase').getAttribute('data-id');
        const item = this.selectedItems.find(i => i.id == itemId);
        
        if (item) {
            if (item.dose_dispensing) {
                const newDoseQuantity = item.dose_quantity + 1;
                
                try {
                    const ensureResponse = await this.apiCall('/api/dispense/ensure-dose-stock', 'POST', {
                        stockDetailId: item.stock_detail_id,
                        requiredDoses: newDoseQuantity
                    });

                    if (ensureResponse.success) {
                        if (ensureResponse.convertedUnits > 0) {
                            this.showMessage(
                                `Automatically converted ${ensureResponse.convertedUnits} unit(s) to meet dose requirement.`, 
                                'info'
                            );
                        }

                        item.dose_quantity = newDoseQuantity;
                        item.quantity = item.dose_quantity;
                        item.total_price = item.dose_unit_price * item.dose_quantity;
                        this.calculateDosageDays(item); // Recalculate days
                        this.updateTableRow(item);
                        this.calculateBillSummary();
                    }
                } catch (error) {
                    console.error('Dose quantity increase error:', error);
                    this.showMessage(
                        `Cannot increase quantity: ${error.error || error.message}`, 
                        'error'
                    );
                }
            } else {
                item.quantity += 1;
                item.total_price = item.selling_price * item.quantity;
                this.calculateDosageDays(item); // Recalculate days
                this.updateTableRow(item);
                this.calculateBillSummary();
            }
        }
    }

    removeItem(event) {
        const itemId = event.target.closest('.remove-item').getAttribute('data-id');
        this.selectedItems = this.selectedItems.filter(item => item.id != itemId);

        const row = document.querySelector(`tr:has(.remove-item[data-id="${itemId}"])`);
        if (row) {
            row.remove();
        }

        if (this.selectedItems.length === 0) {
            this.showNoItemsMessage();
        }

        this.calculateBillSummary();
        this.updateActionButtons();
    }

    calculateBillSummary() {
        const subtotal = this.selectedItems.reduce((sum, item) => sum + item.total_price, 0);
        const discountInput = document.getElementById('discountAmount').value;
        const discountType = document.getElementById('discountType').value;

        let discount = 0;
        if (discountInput) {
            discount = discountType === 'percentage'
                ? (subtotal * parseFloat(discountInput)) / 100
                : parseFloat(discountInput);
        }

        const total = Math.max(0, subtotal - discount);

        // Update UI
        document.getElementById('subtotalAmount').textContent = `₹${subtotal.toFixed(2)}`;
        document.getElementById('totalAmount').textContent = `₹${total.toFixed(2)}`;

        // Update QR code if visible
        if (document.querySelector('input[name="paymentMethod"][value="upi"]').checked) {
            this.generateUPIQRCode();
        }
    }

    updateActionButtons() {
        const hasItems = this.selectedItems.length > 0;

        // Enable print button whenever items exist
        document.getElementById('printBill').disabled = !hasItems;
        
        // Only require items for save and Email
        const canProceed = hasItems;

        document.getElementById('saveBill').disabled = !canProceed;
        document.getElementById('emailBill').disabled = !canProceed;

        // Update print button visual state
        const printBtn = document.getElementById('printBill');
        if (hasItems) {
            printBtn.classList.remove('btn-secondary-custom');
            printBtn.classList.add('btn-primary-custom');
        } else {
            printBtn.classList.remove('btn-primary-custom');
            printBtn.classList.add('btn-secondary-custom');
        }
    }

    async saveBill() {
        const customer = {
            mobile: document.getElementById('customerMobile').value.trim(),
            name: document.getElementById('customerName').value.trim(),
            email: document.getElementById('customerEmail').value.trim()
        };

        const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
        const discountAmount = document.getElementById('discountAmount').value || 0;
        const discountType = document.getElementById('discountType').value;

        const summary = {
            subtotal: this.selectedItems.reduce((sum, item) => sum + item.total_price, 0),
            discountAmount: discountType === 'percentage' 
                ? (this.selectedItems.reduce((sum, item) => sum + item.total_price, 0) * parseFloat(discountAmount)) / 100
                : parseFloat(discountAmount),
            discountType: discountType,
            totalAmount: parseFloat(document.getElementById('totalAmount').textContent.replace('₹', ''))
        };

        // REMOVED CUSTOMER VALIDATION - only require items
        if (this.selectedItems.length === 0) {
            this.showMessage('Please add at least one medicine to the bill', 'error');
            return;
        }

        try {
            this.showLoading('Saving transaction and generating bill...');
            
            const response = await this.apiCall('/api/dispense/save-transaction', 'POST', {
                customer,
                items: this.selectedItems,
                summary,
                paymentMethod
            });

            if (response.success) {
                this.showMessage(`Bill saved successfully! Bill Number: ${response.billNumber}`, 'success');
                
                this.currentTransactionId = response.transactionId;
                this.currentBillNumber = response.billNumber;
                
                document.getElementById('emailBill').disabled = false;
                document.getElementById('printBill').disabled = false;
            }
        } catch (error) {
            console.error('Save bill error:', error);
            this.showMessage('Failed to save bill. Please try again.', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async sendEmailBill() {
        try {
            this.showLoading('Sending email bill...');

            const customer = {
                mobile: document.getElementById('customerMobile').value.trim(),
                name: document.getElementById('customerName').value.trim(),
                email: document.getElementById('customerEmail').value.trim()
            };

            // Check if email is provided
            if (!customer.email) {
                this.showMessage('Please enter customer email address to send digital bill', 'error');
                return;
            }

            const summary = {
                totalAmount: parseFloat(document.getElementById('totalAmount').textContent.replace('₹', ''))
            };

            // Call email endpoint
            const response = await this.apiCall('/api/dispense/send-email-bill', 'POST', {
                customer,
                items: this.selectedItems,
                summary,
                transactionId: this.currentTransactionId
            });

            if (response.success) {
                this.showMessage('Email bill sent successfully!', 'success');
            } else {
                this.showMessage('Failed to send email bill: ' + (response.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            console.error('Email bill error:', error);
            this.showMessage('Failed to send email bill. Please try again.', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async printBill() {
        if (this.selectedItems.length === 0) {
            this.showMessage('Please add at least one medicine to generate bill', 'error');
            return;
        }

        try {
            this.showLoading('Generating professional PDF bill...');
            
            const customer = {
                mobile: document.getElementById('customerMobile').value.trim(),
                name: document.getElementById('customerName').value.trim()
            };

            const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked').value;
            const discountAmount = document.getElementById('discountAmount').value || 0;
            const discountType = document.getElementById('discountType').value;

            const summary = {
                subtotal: this.selectedItems.reduce((sum, item) => sum + item.total_price, 0),
                discountAmount: discountType === 'percentage' 
                    ? (this.selectedItems.reduce((sum, item) => sum + item.total_price, 0) * parseFloat(discountAmount)) / 100
                    : parseFloat(discountAmount),
                discountType: discountType,
                totalAmount: parseFloat(document.getElementById('totalAmount').textContent.replace('₹', ''))
            };

            let url;
            let filename;

            if (this.currentTransactionId) {
                // Use saved transaction
                url = `/api/dispense/generate-pdf/${this.currentTransactionId}`;
                filename = `bill-${this.currentBillNumber}.pdf`;
            } else {
                // Use current data
                url = '/api/dispense/generate-pdf-from-data';
                filename = `bill-temp-${Date.now()}.pdf`;
            }

            const options = {
                method: this.currentTransactionId ? 'GET' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            };

            if (!this.currentTransactionId) {
                options.body = JSON.stringify({
                    customer,
                    items: this.selectedItems,
                    summary,
                    paymentMethod
                });
            }

            const response = await fetch(url, options);

            if (!response.ok) {
                throw new Error('Failed to generate PDF');
            }

            // Create blob and download
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            document.body.removeChild(a);

            this.showMessage('Professional PDF bill generated successfully!', 'success');
            
        } catch (error) {
            console.error('Print bill error:', error);
            this.showMessage('Failed to generate PDF bill. Please try again.', 'error');
        } finally {
            this.hideLoading();
        }
    }

    newTransaction() {
        // Reset form including email
        document.getElementById('customerForm').reset();
        document.getElementById('medicineSearch').value = '';
        document.getElementById('discountAmount').value = '';
        this.selectedItems = [];
        this.currentCustomer = null;
        this.doseDispensingSearchMode = false; // Reset dose search mode

        // Reset payment method to cash
        document.querySelector('input[name="paymentMethod"][value="cash"]').checked = true;

        // Reset dose dispensing checkbox
        document.getElementById('doseDispensingCheckbox').checked = false;

        document.getElementById('selectedItemsTable').innerHTML = `
            <tr class="no-items-row">
                <td colspan="5">
                    <div class="text-center py-8 text-gray-400">
                        <i class="fas fa-clipboard-list text-4xl mb-2"></i>
                        <p>No medicines added yet. Start searching above.</p>
                    </div>
                </td>
            </tr>
        `;
        this.calculateBillSummary();
        this.updateActionButtons();
        this.hideSearchDropdown();
        this.updateSearchPlaceholder(); // Reset search placeholder
    }

    saveDraft() {
        // Save current state to localStorage
        const draft = {
            customer: {
                mobile: document.getElementById('customerMobile').value,
                name: document.getElementById('customerName').value
            },
            items: this.selectedItems,
            discount: {
                amount: document.getElementById('discountAmount').value,
                type: document.getElementById('discountType').value
            },
            paymentMethod: document.querySelector('input[name="paymentMethod"]:checked').value,
            timestamp: new Date().toISOString()
        };

        localStorage.setItem('medicineDispensingDraft', JSON.stringify(draft));
        this.showMessage('Draft saved successfully!', 'success');
    }

    loadDraft() {
        const draft = localStorage.getItem('medicineDispensingDraft');
        if (draft) {
            // Implement draft loading logic
            this.showMessage('Draft found! Click load draft to restore.', 'info');
        }
    }

    // Barcode Scanner Methods
    openBarcodeScanner() {
        const isLocalhost = window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1';
        const isSecure = window.location.protocol === 'https:';

        if (!isSecure && !isLocalhost) {
            this.showMessage(
                'Camera access works best on HTTPS or localhost. ' +
                'You can still use manual barcode entry below.',
                'warning'
            );
        }

        document.getElementById('barcodeModal').classList.remove('hidden');
        document.getElementById('manualBarcode').focus();
    }

    closeBarcodeScanner() {
        this.stopBarcodeScanner();
        document.getElementById('barcodeModal').classList.add('hidden');
        document.getElementById('scannerStatus').textContent = '';
    }

    async startBarcodeScanner() {
        try {
            document.getElementById('scannerPlaceholder').classList.add('hidden');
            document.getElementById('barcodeVideo').classList.remove('hidden');
            document.getElementById('startScanner').classList.add('hidden');
            document.getElementById('stopScanner').classList.remove('hidden');
            document.getElementById('switchCamera').classList.remove('hidden');

            // Check camera permissions and context
            const isLocalhost = window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';
            const isSecure = window.location.protocol === 'https:';

            if (!isSecure && !isLocalhost) {
                this.showMessage(
                    'Camera may not work properly on HTTP. ' +
                    'For full functionality, use HTTPS or localhost.',
                    'warning'
                );
            }

            document.getElementById('scannerStatus').textContent = 'Initializing scanner...';

            // Start ZXing barcode scanner
            await this.startZXingScanner();

        } catch (error) {
            console.error('Error starting camera:', error);

            let errorMessage = error.message;
            if (errorMessage.includes('permission') || errorMessage.includes('NotAllowedError')) {
                errorMessage += '\n\nPlease check:\n1. Camera permissions are allowed\n2. You are using HTTPS or localhost\n3. No other app is using the camera';
            }

            document.getElementById('scannerStatus').textContent = 'Camera Error: ' + errorMessage;
            this.showMessage(errorMessage, 'error');
            this.stopBarcodeScanner();
        }
    }

    async startZXingScanner() {
        try {
            const video = document.getElementById('barcodeVideo');

            // List available cameras first
            const videoInputDevices = await this.listCameras();

            if (videoInputDevices.length === 0) {
                throw new Error('No cameras found on this device');
            }

            let selectedDeviceId;

            // Try to find back camera first, then use first available
            const backCamera = videoInputDevices.find(device =>
                device.label.toLowerCase().includes('back') ||
                device.label.toLowerCase().includes('rear')
            );

            selectedDeviceId = backCamera ? backCamera.deviceId : videoInputDevices[0].deviceId;

            console.log('Using camera:', backCamera ? 'Back camera' : 'First available camera');

            // Start decoding with error handling
            await this.codeReader.decodeFromVideoDevice(
                selectedDeviceId,
                video,
                (result, error) => {
                    if (result) {
                        console.log('ZXing barcode detected:', result.getText());
                        this.handleBarcodeDetected(result.getText());
                    }

                    if (error && !error.message.includes('NotFoundError')) {
                        console.log('ZXing scanning error:', error);
                    }
                }
            );

            document.getElementById('scannerStatus').textContent = 'Scanner active - Point camera at barcode';

        } catch (error) {
            console.error('ZXing scanner error:', error);

            let errorMessage = 'Failed to start barcode scanner: ';
            if (error.message.includes('No cameras found')) {
                errorMessage += 'No cameras found on this device.';
            } else if (error.message.includes('Permission')) {
                errorMessage += 'Camera permission denied. Please allow camera access.';
            } else {
                errorMessage += error.message;
            }

            throw new Error(errorMessage);
        }
    }

    stopBarcodeScanner() {
        // Stop ZXing scanner
        if (this.codeReader) {
            this.codeReader.reset();
        }

        // Stop camera stream
        if (this.currentStream) {
            this.currentStream.getTracks().forEach(track => {
                track.stop();
            });
            this.currentStream = null;
        }

        document.getElementById('scannerPlaceholder').classList.remove('hidden');
        document.getElementById('barcodeVideo').classList.add('hidden');
        document.getElementById('startScanner').classList.remove('hidden');
        document.getElementById('stopScanner').classList.add('hidden');
        document.getElementById('switchCamera').classList.add('hidden');
        document.getElementById('scannerStatus').textContent = 'Scanner stopped';
    }

    async switchCamera() {
        this.stopBarcodeScanner();
        await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay
        await this.startBarcodeScanner();
    }

    async handleBarcodeDetected(barcode) {
        // Validate barcode
        if (!barcode || barcode.trim().length === 0) {
            document.getElementById('scannerStatus').textContent = 'Invalid barcode detected';
            return;
        }

        const cleanBarcode = barcode.trim();
        document.getElementById('scannerStatus').textContent = `Barcode detected: ${cleanBarcode}`;
        this.stopBarcodeScanner();

        try {
            this.showLoading('Searching barcode...');
            const response = await this.apiCall('/api/dispense/search-by-barcode', 'GET', { barcode: cleanBarcode });

            if (response.success && response.medicine) {
                // Use current dose dispensing mode to determine how to add the medicine
                if (this.doseDispensingSearchMode) {
                    this.handleDoseMedicineSelection(response.medicine, false);
                } else {
                    this.addMedicineToTable(response.medicine);
                }
                this.closeBarcodeScanner();
                this.showMessage('Medicine added successfully!', 'success');
            } else {
                this.showMessage(response.message || 'Medicine not found for this barcode', 'info');
                document.getElementById('manualBarcode').value = cleanBarcode;
                document.getElementById('manualBarcode').focus();
            }
        } catch (error) {
            console.error('Barcode search error:', error);

            if (error.message.includes('400') || error.message.includes('Bad Request')) {
                this.showMessage('Invalid barcode format. Please try again.', 'error');
            } else {
                this.showMessage('Error searching barcode: ' + error.message, 'error');
            }

            document.getElementById('manualBarcode').value = cleanBarcode;
            document.getElementById('manualBarcode').focus();
        } finally {
            this.hideLoading();
        }
    }

    async searchManualBarcode() {
        const barcode = document.getElementById('manualBarcode').value.trim();

        if (!barcode) {
            this.showMessage('Please enter a barcode', 'error');
            return;
        }

        try {
            this.showLoading('Searching barcode...');
            const response = await this.apiCall('/api/dispense/search-by-barcode', 'GET', { barcode });

            if (response.success && response.medicine) {
                // Use current dose dispensing mode to determine how to add the medicine
                if (this.doseDispensingSearchMode) {
                    this.handleDoseMedicineSelection(response.medicine, false);
                } else {
                    this.addMedicineToTable(response.medicine);
                }
                this.closeBarcodeScanner();
                this.showMessage('Medicine added successfully!', 'success');
            } else {
                this.showMessage(response.message || 'Medicine not found for this barcode', 'error');
            }
        } catch (error) {
            console.error('Manual barcode search error:', error);

            // Check if it's a JSON parse error (HTML response)
            if (error.message.includes('Unexpected token') || error.message.includes('JSON')) {
                this.showMessage('Server error: API endpoint not available. Please check the server configuration.', 'error');
            } else {
                this.showMessage('Error searching barcode: ' + error.message, 'error');
            }
        } finally {
            this.hideLoading();
        }
    }

    addManualItem() {
        const manualItem = {
            id: Date.now() + Math.random(),
            stock_detail_id: null,
            item_name: 'Other',
            item_description: '',
            mrp: 0,
            selling_price: 0,
            quantity: 1,
            total_price: 0,
            location: 'MANUAL',
            dose_dispensing: false,
            is_manual: true
        };

        this.selectedItems.push(manualItem);
        this.addTableRow(manualItem);
        this.calculateBillSummary();
        this.updateActionButtons();
    }

    // Utility methods
    async apiCall(endpoint, method = 'GET', data = null) {
        try {
            const options = {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'same-origin'
            };

            if (data) {
                if (method === 'GET') {
                    const params = new URLSearchParams();
                    for (const key in data) {
                        if (data[key] !== null && data[key] !== undefined && data[key] !== '') {
                            params.append(key, data[key]);
                        }
                    }
                    endpoint += '?' + params.toString();
                } else {
                    options.body = JSON.stringify(data);
                }
            }

            console.log('API Call:', endpoint);
            const response = await fetch(endpoint, options);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error('Server returned non-JSON response');
            }

            return await response.json();
        } catch (error) {
            console.error('API call failed:', error);
            throw error;
        }
    }

    showMessage(message, type = 'info') {
        const modal = document.getElementById('message-modal');
        const title = modal.querySelector('#modal-title');
        const body = modal.querySelector('#modal-body');

        title.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        body.textContent = message;

        // Set color based on type
        if (type === 'error') title.className = 'text-xl font-bold mb-3 text-red-600';
        else if (type === 'success') title.className = 'text-xl font-bold mb-3 text-green-600';
        else title.className = 'text-xl font-bold mb-3 text-primary';

        modal.classList.remove('hidden');
    }

    showLoading(message = 'Processing...') {
        const overlay = document.getElementById('loading-overlay');
        overlay.querySelector('p').textContent = message;
        overlay.classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loading-overlay').classList.add('hidden');
    }

    hideSearchDropdown() {
        document.getElementById('searchResultsDropdown').classList.add('hidden');
    }

    showNoItemsMessage() {
        const tbody = document.getElementById('selectedItemsTable');
        tbody.innerHTML = `
            <tr class="no-items-row">
                <td colspan="5">
                    <div class="text-center py-8 text-gray-400">
                        <i class="fas fa-clipboard-list text-4xl mb-2"></i>
                        <p>No medicines added yet. Start searching above.</p>
                    </div>
                </td>
            </tr>
        `;
    }

    handleClickOutside(event) {
        const dropdown = document.getElementById('searchResultsDropdown');
        const searchInput = document.getElementById('medicineSearch');

        if (dropdown && !dropdown.contains(event.target) && !searchInput.contains(event.target)) {
            this.hideSearchDropdown();
        }
    }

    async fetchBotInfo() {
        try {
            const response = await fetch('/api/customers/bot-info');
            const data = await response.json();
            if (data.success) {
                this.botUsername = data.username;
            }
        } catch (error) {
            console.error('Error fetching bot info:', error);
        }
    }

    openTelegramModal() {
        if (!this.currentCustomer || !this.currentCustomer.id) {
            this.showMessage('Please save/select a customer first.', 'warning');
            return;
        }

        if (!this.botUsername) {
            this.showMessage('Bot information not available. Check internet or server.', 'error');
            return;
        }

        const modal = document.getElementById('telegramModal');
        const qrContainer = document.getElementById('telegramQrCode');
        const usernameDisplay = document.getElementById('botUsernameDisplay');
        
        modal.classList.remove('hidden');
        usernameDisplay.textContent = `@${this.botUsername}`;

        // Deep Link: https://t.me/BotName?start=CustomerID
        const deepLink = `https://t.me/${this.botUsername}?start=${this.currentCustomer.id}`;
        
        qrContainer.innerHTML = '';
        this.telegramQr = new QRCode(qrContainer, {
            text: deepLink,
            width: 200,
            height: 200,
            colorDark : "#0088cc", // Telegram Blue
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    }

    closeTelegramModal() {
        document.getElementById('telegramModal').classList.add('hidden');
        if (this.telegramQr) {
            document.getElementById('telegramQrCode').innerHTML = ''; // clear
            this.telegramQr = null;
        }
    }

    loadUserInfo() {
        // Load user info from auth
        fetch('/auth/user-data')
            .then(response => response.json())
            .then(data => {
                if (data.name) {
                    document.getElementById('user-id').textContent = `User: ${data.name}`;
                }
            })
            .catch(error => {
                console.error('Error loading user info:', error);
                document.getElementById('user-id').textContent = 'User: PHARM-1001';
            });
    }

    clearSearch() {
        document.getElementById('medicineSearch').value = '';
        document.getElementById('searchCategory').value = 'all';
        this.hideSearchDropdown();
    }

    handleSearch() {
        const query = document.getElementById('medicineSearch').value.trim();
        if (query.length >= 2) {
            this.performSearch(query);
        }
    }

    generateUPIQRCode() {
        const totalText = document.getElementById('totalAmount').textContent.replace('₹', '');
        const amount = parseFloat(totalText) || 0;
        const qrContainer = document.getElementById('qrcode');
        const amountDisplay = document.getElementById('qrAmountDisplay');

        if (amount <= 0) {
            qrContainer.innerHTML = '<p class="text-xs text-red-500">Add items to generate QR</p>';
            amountDisplay.textContent = '₹0.00';
            this.qrCodeObj = null; // Reset since DOM is cleared
            return;
        }

        amountDisplay.textContent = `₹${amount.toFixed(2)}`;

        // UPI URL Format: upi://pay?pa=<UPI_ID>&pn=<NAME>&am=<AMOUNT>&cu=INR
        const upiUrl = `upi://pay?pa=Q623297548@ybl&pn=KiranCareWellness&am=${amount.toFixed(2)}&cu=INR`;

        try {
            // Check if we have a valid QR object and the container isn't displaying text
            if (this.qrCodeObj && qrContainer.querySelector('canvas, img')) {
                this.qrCodeObj.clear();
                this.qrCodeObj.makeCode(upiUrl);
            } else {
                qrContainer.innerHTML = ''; // Clear text/placeholder
                this.qrCodeObj = new QRCode(qrContainer, {
                    text: upiUrl,
                    width: 128,
                    height: 128,
                    colorDark : "#000000",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                });
            }
        } catch (e) {
            console.error('QR Code generation failed:', e);
            qrContainer.innerHTML = '<p class="text-xs text-red-500">Error</p>';
            this.qrCodeObj = null;
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new MedicineDispensing();
});