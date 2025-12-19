// js/barcodePrinting.js
let selectedItems = new Set();
let currentStockItems = [];
let currentMasterId = null;

// Utility Functions
function showMessage(title, body, type = 'info') {
    const modal = document.getElementById('message-modal');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');

    titleEl.className = 'text-lg font-bold mb-3';
    if (type === 'success') {
        titleEl.classList.add('text-primary');
    } else if (type === 'error') {
        titleEl.classList.add('text-red-600');
    } else {
        titleEl.classList.add('text-gray-800');
    }

    titleEl.textContent = title;
    bodyEl.textContent = body;
    modal.classList.remove('hidden');
}

function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = show ? 'flex' : 'none';
}

// Format date for display
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN');
}

// API Functions
async function loadLastImports() {
    showLoading(true);

    try {
        const response = await fetch('/api/barcode/last-imports');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Last imports API response:', result); // Debug log

        if (result.success) {
            const select = document.getElementById('last-imports-select');
            if (!select) {
                console.error('last-imports-select element not found in DOM');
                return;
            }
            
            select.innerHTML = '<option value="">-- Select a recent import --</option>';
            
            if (result.imports && result.imports.length > 0) {
                result.imports.forEach(importSession => {
                    const option = document.createElement('option');
                    option.value = importSession.id;
                    option.textContent = `${importSession.vendor_name} - ${importSession.invoice_no} (${importSession.item_count} items) - ${formatDate(importSession.import_date)}`;
                    option.dataset.importData = JSON.stringify(importSession);
                    select.appendChild(option);
                });
                console.log(`Loaded ${result.imports.length} imports into dropdown`);
            } else {
                console.log('No imports found in API response');
            }
        } else {
            console.error('API returned error:', result.error);
            showMessage('Error', result.error || 'Failed to load last imports.', 'error');
        }
    } catch (error) {
        console.error('Error loading last imports:', error);
        showMessage('Error', `Network error while loading last imports: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function searchStockItems() {
    const search = document.getElementById('search-input').value;
    const batch = document.getElementById('batch-input').value;
    const location = document.getElementById('location-input').value;
    const printed = document.getElementById('printed-filter').value;

    showLoading(true);

    try {
        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (batch) params.append('batch', batch);
        if (location) params.append('location', location);
        if (printed) params.append('printed', printed);
        if (currentMasterId) params.append('masterId', currentMasterId);

        const response = await fetch(`/api/barcode/stock-items?${params}`);
        const result = await response.json();

        if (result.success) {
            currentStockItems = result.items;
            renderStockItems(currentStockItems);
        } else {
            showMessage('Error', result.error || 'Failed to search stock items.', 'error');
        }
    } catch (error) {
        console.error('Search error:', error);
        showMessage('Error', 'Network error while searching stock items.', 'error');
    } finally {
        showLoading(false);
    }
}

async function generateBarcodeForStock(stockDetailId) {
    showLoading(true);

    try {
        const response = await fetch('/api/barcode/generate-for-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stockDetailId })
        });

        const result = await response.json();

        if (result.success) {
            showMessage('Success', 'Barcode generated successfully!', 'success');
            // Refresh the search to show updated barcode
            searchStockItems();
        } else {
            showMessage('Error', result.error || 'Failed to generate barcode.', 'error');
        }
    } catch (error) {
        console.error('Barcode generation error:', error);
        showMessage('Error', 'Network error while generating barcode.', 'error');
    } finally {
        showLoading(false);
    }
}

async function printBarcodes() {
    if (selectedItems.size === 0) {
        showMessage('Warning', 'Please select at least one item to print.', 'error');
        return;
    }

    showLoading(true);

    try {
        const response = await fetch('/api/barcode/log-print', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stockDetailIds: Array.from(selectedItems),
                printReason: 'reprint'
            })
        });

        const result = await response.json();

        if (result.success) {
            showMessage('Success', `Print logged for ${selectedItems.size} items. You can now print the labels.`, 'success');
            generateBarcodePreview();
        } else {
            showMessage('Error', result.error || 'Failed to log print.', 'error');
        }
    } catch (error) {
        console.error('Print logging error:', error);
        showMessage('Error', 'Network error while logging print.', 'error');
    } finally {
        showLoading(false);
    }
}

// Rendering Functions
function renderStockItems(items) {
    const container = document.getElementById('stock-items-container');
    
    if (items.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-8">No stock items found matching your criteria.</p>';
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="stock-item p-4 border-b border-gray-200 hover:bg-gray-50 flex items-center justify-between">
            <div class="flex items-center space-x-4 flex-grow">
                <input type="checkbox" value="${item.id}" 
                       class="item-checkbox h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" 
                       ${selectedItems.has(item.id) ? 'checked' : ''}>
                <div class="flex-grow">
                    <div class="flex justify-between items-start">
                        <div class="flex-grow">
                            <p class="font-semibold text-gray-800">${item.item_name}</p>
                            ${item.item_desc ? `<p class="text-sm text-gray-600">${item.item_desc}</p>` : ''}
                            <p class="text-sm text-gray-600 mt-1">
                                Batch: ${item.batch_number || 'N/A'} | 
                                Qty: ${item.quantity} | 
                                Location: ${item.location}
                            </p>
                            <p class="text-sm text-gray-500">
                                ${item.manufacturer ? `Mfg: ${item.manufacturer} | ` : ''}
                                Expiry: ${formatDate(item.expiry_date)} |
                                ${item.hsn_code ? `HSN: ${item.hsn_code}` : ''}
                            </p>
                        </div>
                        <div class="text-right ml-4">
                            <p class="text-sm font-mono ${item.barcode ? 'text-green-600' : 'text-red-600'}">
                                ${item.barcode || 'No Barcode'}
                            </p>
                            <p class="text-xs ${item.barcode_printed ? 'text-blue-600' : 'text-orange-600'}">
                                ${item.barcode_printed ? 'Printed' : 'Not Printed'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            ${!item.barcode ? `
                <button onclick="generateBarcodeForStock(${item.id})" 
                        class="ml-4 bg-quarterly text-white px-3 py-1 rounded text-sm hover:bg-orange-600 transition duration-200">
                    Generate
                </button>
            ` : ''}
        </div>
    `).join('');

    // Add event listeners to checkboxes
    container.querySelectorAll('.item-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const itemId = parseInt(e.target.value);
            if (e.target.checked) {
                selectedItems.add(itemId);
            } else {
                selectedItems.delete(itemId);
            }
            updateSelectedCount();
            updatePrintButton();
        });
    });
}

function generateBarcodePreview() {
    const selectedItemsData = currentStockItems.filter(item => selectedItems.has(item.id));
    
    if (selectedItemsData.length === 0) {
        document.getElementById('barcode-preview').classList.add('hidden');
        return;
    }

    const container = document.getElementById('barcode-labels-container');
    container.innerHTML = '';

    selectedItemsData.forEach(item => {
        if (!item.barcode) return;

        const label = document.createElement('div');
        label.className = 'barcode-label bg-white';
        label.innerHTML = `
            <div class="text-center mb-1">
                <div class="font-bold text-xs" style="font-size: 6px;">KIRAN CARE WELLNESS</div>
            </div>
            <svg class="barcode" jsbarcode-format="CODE128" jsbarcode-value="${item.barcode}" jsbarcode-displayvalue="true" jsbarcode-height="20" jsbarcode-width="1"></svg>
            <div class="text-center mt-1" style="font-size: 6px;">
                <div><strong>${item.item_name.substring(0, 20)}</strong></div>
                <div>Batch: ${item.batch_number || 'N/A'}</div>
                <div>Exp: ${formatDate(item.expiry_date)}</div>
                <div class="font-mono">${item.barcode}</div>
            </div>
        `;
        container.appendChild(label);
    });

    // Generate barcodes using JsBarcode
    JsBarcode(".barcode").init();

    document.getElementById('barcode-preview').classList.remove('hidden');
}

function updateSelectedCount() {
    document.getElementById('selected-count').textContent = `${selectedItems.size} items selected`;
}

function updatePrintButton() {
    const printBtn = document.getElementById('print-barcode-btn');
    const generateBtn = document.getElementById('generate-barcode-btn');
    
    const hasSelection = selectedItems.size > 0;
    const hasItemsWithoutBarcode = Array.from(selectedItems).some(id => {
        const item = currentStockItems.find(i => i.id === id);
        return item && !item.barcode;
    });

    printBtn.disabled = !hasSelection;
    generateBtn.disabled = !hasItemsWithoutBarcode;
}

function showImportInfo(importData) {
    const container = document.getElementById('import-info');
    container.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
                <p class="font-semibold text-blue-700">Vendor</p>
                <p>${importData.vendor_name}</p>
            </div>
            <div>
                <p class="font-semibold text-blue-700">Invoice No</p>
                <p>${importData.invoice_no}</p>
            </div>
            <div>
                <p class="font-semibold text-blue-700">Import Date</p>
                <p>${formatDate(importData.import_date)}</p>
            </div>
            <div>
                <p class="font-semibold text-blue-700">Items Count</p>
                <p>${importData.item_count} items</p>
            </div>
        </div>
    `;
    container.classList.remove('hidden');
}

// Event Listeners
function initializeEventListeners() {
    // Safe event listener attachment with null checks
    const lastImportsSelect = document.getElementById('last-imports-select');
    const loadImportBtn = document.getElementById('load-import-btn');
    const searchBtn = document.getElementById('search-btn');
    const clearBtn = document.getElementById('clear-btn');
    const selectAllBtn = document.getElementById('select-all-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const generateBarcodeBtn = document.getElementById('generate-barcode-btn');
    const printBarcodeBtn = document.getElementById('print-barcode-btn');
    const printPreviewBtn = document.getElementById('print-preview-btn');
    const searchInput = document.getElementById('search-input');
    const selectAllBarcodesBtn = document.getElementById('select-all-barcodes-btn');

    // Last imports - only add listener if element exists
    if (lastImportsSelect) {
        lastImportsSelect.addEventListener('change', (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            if (selectedOption.value) {
                const importData = JSON.parse(selectedOption.dataset.importData);
                currentMasterId = selectedOption.value;
                showImportInfo(importData);
            } else {
                currentMasterId = null;
                const importInfo = document.getElementById('import-info');
                if (importInfo) importInfo.classList.add('hidden');
            }
        });
    } else {
        console.warn('last-imports-select element not found');
    }

    // Load import button
    if (loadImportBtn) {
        loadImportBtn.addEventListener('click', () => {
            if (currentMasterId) {
                searchStockItems();
            } else {
                showMessage('Info', 'Please select an import session first.', 'info');
            }
        });
    }

    // Search and filter buttons
    if (searchBtn) {
        searchBtn.addEventListener('click', searchStockItems);
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            document.getElementById('batch-input').value = '';
            document.getElementById('location-input').value = '';
            document.getElementById('printed-filter').value = '';
            if (lastImportsSelect) lastImportsSelect.value = '';
            currentMasterId = null;
            const importInfo = document.getElementById('import-info');
            if (importInfo) importInfo.classList.add('hidden');
            selectedItems.clear();
            currentStockItems = [];
            renderStockItems([]);
            updateSelectedCount();
            updatePrintButton();
        });
    }

    // Selection buttons
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            currentStockItems.forEach(item => selectedItems.add(item.id));
            renderStockItems(currentStockItems);
            updateSelectedCount();
            updatePrintButton();
        });
    }

    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            selectedItems.clear();
            renderStockItems(currentStockItems);
            updateSelectedCount();
            updatePrintButton();
        });
    }

    // Action buttons
    if (generateBarcodeBtn) {
        generateBarcodeBtn.addEventListener('click', () => {
            const itemsWithoutBarcode = Array.from(selectedItems).filter(id => {
                const item = currentStockItems.find(i => i.id === id);
                return item && !item.barcode;
            });

            if (itemsWithoutBarcode.length === 0) {
                showMessage('Info', 'All selected items already have barcodes.', 'info');
                return;
            }

            // Generate barcode for the first item without barcode
            generateBarcodeForStock(itemsWithoutBarcode[0]);
        });
    }

    if (printBarcodeBtn) {
        printBarcodeBtn.addEventListener('click', printBarcodes);
    }

    if (printPreviewBtn) {
        printPreviewBtn.addEventListener('click', () => {
            window.print();
        });
    }

    // Enter key for search
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchStockItems();
        });
    }

    // Select all barcodes
    if (selectAllBarcodesBtn) {
        selectAllBarcodesBtn.addEventListener('click', () => {
            currentStockItems.forEach(item => {
                if (item.barcode) {
                    selectedItems.add(item.id);
                }
            });
            renderStockItems(currentStockItems);
            updateSelectedCount();
            updatePrintButton();
        });
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    try {
        initializeEventListeners();
        loadLastImports();
        updateSelectedCount();
        updatePrintButton();
        console.log('Barcode printing module initialized successfully');
    } catch (error) {
        console.error('Error initializing barcode printing module:', error);
    }
});