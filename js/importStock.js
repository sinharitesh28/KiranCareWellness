// Global State Variables
let templates = [];
let distributorConfigs = [];
let selectedTemplate = null;
let importedData = []; // Full data from the file
let stockDetailsWithLocation = []; // Final data structure ready for import

// --- Utility Functions ---

function extractPackingValue(packingString) {
    if (!packingString) return 1;
    const str = String(packingString).trim();
    if (str === '') return 1;
    const numberMatch = str.match(/\d+/);
    if (numberMatch) return parseInt(numberMatch[0], 10) || 1;
    
    const patterns = {
        'strip of': (s) => parseInt(s.match(/\d+/)?.[0]) || 1,
        'tablets': (s) => parseInt(s.match(/\d+/)?.[0]) || 1,
        'capsules': (s) => parseInt(s.match(/\d+/)?.[0]) || 1,
        'bottle of': (s) => parseInt(s.match(/\d+/)?.[0]) || 1,
        'pack of': (s) => parseInt(s.match(/\d+/)?.[0]) || 1,
        'box of': (s) => parseInt(s.match(/\d+/)?.[0]) || 1
    };
    for (const [pattern, extractor] of Object.entries(patterns)) {
        if (str.toLowerCase().includes(pattern)) {
            const value = extractor(str);
            if (value > 0) return value;
        }
    }
    return 1;
}

function showMessage(title, body, type = 'info') {
    const modal = document.getElementById('message-modal');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    titleEl.className = 'text-lg font-bold mb-3';
    if (type === 'success') titleEl.classList.add('text-primary');
    else if (type === 'error') titleEl.classList.add('text-red-600');
    else titleEl.classList.add('text-gray-800');
    titleEl.textContent = title;
    bodyEl.innerHTML = body;
    modal.classList.remove('hidden');
}

function showLoading(show, text = 'Processing...') {
    const overlay = document.getElementById('loading-overlay');
    document.getElementById('loading-text').textContent = text;
    if(show) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
}

function parseDate(dateString, format) {
    if (!dateString || !format) return null;
    try {
        dateString = String(dateString).trim();
        if (!dateString || dateString === 'N/A' || dateString === '') return null;
        const formatMap = {
            '%d/%m/%Y': (str) => { const parts = str.split('/'); return parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}` : null; },
            '%m/%d/%Y': (str) => { const parts = str.split('/'); return parts.length === 3 ? `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}` : null; },
            '%Y-%m-%d': (str) => str,
            '%d-%m-%Y': (str) => { const parts = str.split('-'); return parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}` : null; }
        };
        const parser = formatMap[format];
        if (parser) return parser(dateString);
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
    } catch (error) { return null; }
}

// --- API Calls ---

async function fetchTemplates() {
    try {
        const response = await fetch('/api/template/get-templates');
        if (response.status === 401) { window.location.href = '/'; return; }
        const result = await response.json();
        if (result.success) {
            templates = result.templates;
        } else showMessage('Error', result.error || 'Could not load templates.', 'error');
    } catch (error) { showMessage('Error', 'Network error fetching templates.', 'error'); }
}

async function fetchDistributorConfigs() {
    try {
        const response = await fetch('/api/stock/distributor-config');
        if (response.status === 401) { window.location.href = '/'; return; }
        const result = await response.json();
        if (result.success) {
            distributorConfigs = result.configs;
            populateDistributorFilter(distributorConfigs);
        }
    } catch(err) { console.error('Error fetching configs', err); }
}

async function fetchLastLocations(itemNames) {
    try {
        const response = await fetch('/api/stock/get-last-locations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemNames })
        });
        if (response.status === 401) { window.location.href = '/'; return {}; }
        const result = await response.json();
        return result.success ? result.locations : {};
    } catch (error) { return {}; }
}

async function importStocks() {
    if (stockDetailsWithLocation.length === 0) { showMessage('Import Error', 'No stock items to import.', 'error'); return; }
    if (stockDetailsWithLocation.some(item => !item.location || item.location.trim() === '')) {
        showMessage('Validation Required', 'Please ensure a location is specified for ALL items.', 'error'); return;
    }

    const payload = {
        templateId: selectedTemplate.id,
        masterData: getMasterDataFromImported(importedData[0] || {}),
        stockDetails: stockDetailsWithLocation,
    };

    document.getElementById('import-stocks-btn').disabled = true;
    try {
        showLoading(true, 'Importing to Database...');
        const response = await fetch('/api/stock/import-stocks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (response.status === 401) { window.location.href = '/'; return; }
        const result = await response.json();
        showLoading(false);

        if (result.success) {
            let msg = result.message;
            if (result.skippedCount > 0) msg += `<br><br>Skipped ${result.skippedCount} duplicates.`;
            msg += `<br><br>Barcodes generated.`;
            showMessage('Success', `${msg}<br><div class="flex space-x-3 justify-center mt-4">
                <button onclick="location.href='/barcode-printing.html'" class="bg-quarterly text-white px-4 py-2 rounded">Print Barcodes</button>
                <button onclick="resetState()" class="bg-primary text-white px-4 py-2 rounded">New Import</button></div>`, 'success');
            resetState();
        } else {
            showMessage('Import Failed', result.error, 'error');
            document.getElementById('import-stocks-btn').disabled = false;
        }
    } catch (error) {
        showLoading(false);
        showMessage('Error', 'Network error during import.', 'error');
        document.getElementById('import-stocks-btn').disabled = false;
    }
}

// --- UI Helpers ---

function populateDistributorFilter(configs) {
    const dropdown = document.getElementById('filterDistributor');
    dropdown.innerHTML = '<option value="">-- Select Distributor --</option>';
    configs.forEach(c => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = c.distributor_name;
        dropdown.appendChild(option);
    });
}

function showStep(step) {
    // Hide Step 1 containers
    document.getElementById('step-1-container').classList.add('hidden');
    // Hide Step 2 container
    document.getElementById('step-2').classList.add('hidden');

    if (step === 1) {
        document.getElementById('step-1-container').classList.remove('hidden');
    } else if (step === 2) {
        document.getElementById('step-2').classList.remove('hidden');
    }
}

// --- Logic ---

function validateHeaders(fileHeaders) {
    if (!selectedTemplate) return 'Please select an import template first.';
    // vendor_detail_col removed from reqCols to allow fallback to Distributor Name
    const reqCols = ['item_name_col', 'quantity_col', 'rate_col', 'mrp_col'];
    let missing = [];
    for (const key of reqCols) {
        const expected = selectedTemplate[key] ? String(selectedTemplate[key]).trim().toLowerCase() : null;
        if (expected && !fileHeaders.map(h => h.toLowerCase()).includes(expected)) missing.push(selectedTemplate[key]);
    }
    return missing.length > 0 ? `Missing columns: ${missing.join(', ')}` : null;
}

async function renderItemLocationInputs() {
    const container = document.getElementById('items-to-locate-container');
    container.innerHTML = '';
    stockDetailsWithLocation = [];

    const itemNameKey = cleanColumnName(selectedTemplate.item_name_col);
    const itemNames = importedData.map(row => row[itemNameKey]).filter(n => n);
    const lastLocations = itemNames.length > 0 ? await fetchLastLocations(itemNames) : {};

    // Internal helper to render the list
    const refreshItemsList = () => {
        container.innerHTML = '';
        stockDetailsWithLocation.forEach((detail, index) => {
            let displayExpiry = detail.expiry_date || '-';
            if (detail.expiry_date && dayjs(detail.expiry_date).isValid()) {
                displayExpiry = dayjs(detail.expiry_date).format('MMM-YYYY');
            }

            const card = document.createElement('div');
            card.className = 'item-card p-4 bg-white rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-center space-y-2 sm:space-y-0 border border-gray-100 hover:border-primary transition duration-150 relative group';
            card.innerHTML = `
                <div class="flex-grow w-full sm:w-auto pr-4">
                    <div class="flex justify-between items-start">
                        <p class="font-bold text-gray-800 text-sm">${detail.item_name}</p>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] font-bold text-gray-400 uppercase">Qty:</span>
                            <input type="number" value="${detail.quantity}" 
                                   class="qty-edit-input w-16 p-1 border border-gray-200 rounded text-xs font-bold text-primary focus:ring-1 focus:ring-primary outline-none"
                                   data-index="${index}">
                        </div>
                    </div>
                    <div class="flex flex-wrap text-xs text-gray-500 mt-1 gap-2">
                        <span>Batch: <span class="text-gray-700">${detail.batch_number || '-'}</span></span>
                        <span>Exp: <span class="text-gray-700">${displayExpiry}</span></span>
                        ${detail.packing > 1 ? `<span class="text-blue-600">Pack: ${detail.packing}</span>` : ''}
                    </div>
                    ${detail.lastLoc ? `<p class="text-xs text-green-600 mt-1 font-medium"><i class="fas fa-history mr-1"></i>Last: ${detail.lastLoc}</p>` : ''}
                </div>
                <div class="flex items-center gap-3 w-full sm:w-auto">
                    <div class="w-full sm:w-48">
                        <input type="text" placeholder="Enter Location" value="${detail.location}"
                               class="location-input w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-primary focus:border-primary transition duration-150 shadow-sm"
                               data-index="${index}">
                    </div>
                    <button class="remove-item-btn text-red-400 hover:text-red-600 p-2 transition" data-index="${index}" title="Remove Item">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            `;
            container.appendChild(card);
        });

        // Re-attach listeners
        container.querySelectorAll('.location-input').forEach(input => {
            input.addEventListener('input', (e) => {
                stockDetailsWithLocation[e.target.dataset.index].location = e.target.value.trim();
            });
        });

        container.querySelectorAll('.qty-edit-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const val = parseFloat(e.target.value) || 0;
                stockDetailsWithLocation[e.target.dataset.index].quantity = val;
            });
        });

        container.querySelectorAll('.remove-item-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                stockDetailsWithLocation.splice(idx, 1);
                refreshItemsList(); // Re-render to update indices
            });
        });
    };

    // Initial Mapping
    importedData.forEach((row, index) => {
        const itemName = row[itemNameKey] || `Item ${index + 1}`;
        const detail = mapImportRowToStockDetail(row);
        const lastLoc = lastLocations[itemName] || '';
        detail.location = lastLoc;
        detail.lastLoc = lastLoc; // Cache for display
        stockDetailsWithLocation.push(detail);
    });

    refreshItemsList();
    renderMasterDataReview(importedData[0]);
}

function cleanColumnName(name) {
    return name ? String(name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_') : '';
}

function mapImportRowToStockDetail(row) {
    const getValue = (key, type='string') => {
        if (!selectedTemplate || !selectedTemplate[key]) return null;
        const val = row[cleanColumnName(selectedTemplate[key])];
        if (val === undefined || val === null) return null;
        const str = String(val).trim();
        if (str === '') return null;
        if (type === 'number') return parseFloat(str) || null;
        if (type === 'date') return str.split('T')[0] || null;
        if (type === 'packing') return extractPackingValue(str);
        return str;
    };

    return {
        item_name: getValue('item_name_col'),
        item_desc: getValue('item_desc_col'),
        manufacturer: getValue('manufacturer_col'),
        hsn_code: getValue('hsn_code_col'),
        batch_number: getValue('batch_number_col'),
        expiry_date: getValue('expiry_date_col', 'date'),
        packing: getValue('packing_col', 'packing'),
        quantity: getValue('quantity_col', 'number'),
        free_quantity: getValue('free_col', 'number'),
        rate: getValue('rate_col', 'number'),
        mrp: getValue('mrp_col', 'number'),
        location: ''
    };
}

function getMasterDataFromImported(row) {
    if (!selectedTemplate) return { vendor_name: 'N/A', invoice_no: 'N/A', invoice_date: 'N/A' };
    const getVal = (key, isDate=false) => {
        if (!selectedTemplate[key]) {
            if (key === 'vendor_detail_col' && selectedTemplate.fallback_distributor_name) return selectedTemplate.fallback_distributor_name;
            return 'N/A';
        }
        
        const colName = cleanColumnName(selectedTemplate[key]);
        const val = row[colName];
        
        // Fallback for Vendor if column missing in file or empty
        if (key === 'vendor_detail_col' && (!val || String(val).trim() === '' || String(val).trim().toLowerCase() === 'n/a')) {
            if (selectedTemplate.fallback_distributor_name) return selectedTemplate.fallback_distributor_name;
        }

        const str = val ? String(val).trim() : 'N/A';
        if (isDate && selectedTemplate.invoice_date_format) {
            return parseDate(str, selectedTemplate.invoice_date_format) || str;
        }
        return str;
    };
    return {
        vendor_name: getVal('vendor_detail_col'),
        invoice_no: getVal('invoice_no_col'),
        invoice_date: getVal('invoice_date_col', true)
    };
}

function renderMasterDataReview(row) {
    const d = getMasterDataFromImported(row);
    // Format Invoice Date for Display (DD-MMM-YYYY)
    let displayDate = d.invoice_date;
    if (dayjs(d.invoice_date).isValid()) {
        displayDate = dayjs(d.invoice_date).format('DD-MMM-YYYY');
    }

    document.getElementById('master-data-review').innerHTML = `
        <div class="bg-white p-3 rounded shadow-sm"><p class="text-xs text-gray-500 uppercase tracking-wide">Vendor</p><p class="font-bold text-gray-800">${d.vendor_name}</p></div>
        <div class="bg-white p-3 rounded shadow-sm"><p class="text-xs text-gray-500 uppercase tracking-wide">Invoice No</p><p class="font-bold text-gray-800">${d.invoice_no}</p></div>
        <div class="bg-white p-3 rounded shadow-sm"><p class="text-xs text-gray-500 uppercase tracking-wide">Invoice Date</p><p class="font-bold text-gray-800">${displayDate}</p></div>
        <div class="bg-white p-3 rounded shadow-sm"><p class="text-xs text-gray-500 uppercase tracking-wide">Template</p><p class="font-bold text-primary">${selectedTemplate.template_name}</p></div>
    `;
}

// --- Gmail Logic ---

async function searchEmails() {
    const configId = document.getElementById('filterDistributor').value;
    const filterInvoice = document.getElementById('filterInvoice').value;
    const filterDate = document.getElementById('filterDate').value; // Specific extracted date
    const filterFromDate = document.getElementById('filterFromDate').value;
    const filterToDate = document.getElementById('filterToDate').value;
    
    // Mandatory Distributor Check
    const distError = document.getElementById('distributor-error');
    if (!configId) {
        distError.classList.remove('hidden');
        document.getElementById('filterDistributor').classList.add('border-red-500', 'ring-1', 'ring-red-500');
        return;
    } else {
        distError.classList.add('hidden');
        document.getElementById('filterDistributor').classList.remove('border-red-500', 'ring-1', 'ring-red-500');
    }

    const container = document.getElementById('emailResultsContainer');
    container.innerHTML = '<div class="flex flex-col items-center justify-center h-40 text-primary"><i class="fas fa-spinner fa-spin text-3xl mb-3"></i><p>Scanning Inbox...</p></div>';

    const params = new URLSearchParams();
    if (configId) params.append('configId', configId);
    if (filterInvoice) params.append('invoiceNo', filterInvoice);
    if (filterDate) params.append('specificDate', filterDate);
    if (filterFromDate) params.append('fromDate', filterFromDate);
    if (filterToDate) params.append('toDate', filterToDate);

    try {
        const response = await fetch(`/api/stock/gmail/scan?${params.toString()}`);
        if (response.status === 401) { window.location.href = '/'; return; }
        const result = await response.json();
        
        if (result.success && result.emails.length > 0) {
            container.innerHTML = '';
            result.emails.forEach(email => {
                const attachmentsHtml = email.attachments.map(filename => `
                    <div class="flex justify-between items-center bg-white border border-gray-200 rounded-lg p-3 mt-2 shadow-sm transition hover:shadow-md">
                        <span class="truncate max-w-[250px] text-gray-700 font-mono text-xs flex items-center" title="${filename}">
                            <i class="fas fa-file-csv text-green-600 mr-2 text-lg"></i> ${filename}
                        </span>
                        <button onclick="processGmailAttachment('${email.id}', '${filename}', '${configId}')" 
                                class="bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-900 border border-blue-200 px-4 py-1.5 rounded-md text-xs font-bold transition flex items-center">
                            <i class="fas fa-download mr-1"></i> Import
                        </button>
                    </div>
                `).join('');

                // Metadata Chips
                let metaHtml = '';
                if (email.extractedInvoice) {
                    const isMatch = filterInvoice && email.extractedInvoice.includes(filterInvoice);
                    metaHtml += `<span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium ${isMatch ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-gray-100 text-gray-800 border border-gray-200'} mr-2">
                        <i class="fas fa-file-invoice mr-1.5"></i> ${email.extractedInvoice}
                    </span>`;
                }
                if (email.extractedDate) {
                    const isMatch = filterDate && email.extractedDate.includes(filterDate);
                    metaHtml += `<span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium ${isMatch ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'bg-gray-100 text-gray-800 border border-gray-200'}">
                        <i class="fas fa-calendar-alt mr-1.5"></i> ${email.extractedDate}
                    </span>`;
                }

                const card = document.createElement('div');
                card.className = 'bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition duration-200 mb-4 border-l-4 border-l-primary';
                card.innerHTML = `
                    <div class="flex flex-col sm:flex-row justify-between items-start mb-3">
                        <div class="mb-2 sm:mb-0">
                            <h4 class="font-bold text-gray-800 text-base leading-tight">${email.subject}</h4>
                            <div class="flex flex-wrap items-center text-xs text-gray-500 mt-1 gap-2">
                                <span class="flex items-center"><i class="far fa-clock mr-1"></i> ${new Date(email.date).toLocaleDateString()}</span>
                                <span class="hidden sm:inline text-gray-300">|</span>
                                <span class="flex items-center"><i class="far fa-envelope mr-1"></i> <span class="truncate max-w-[200px]">${email.from}</span></span>
                            </div>
                            ${metaHtml ? `<div class="mt-2.5">${metaHtml}</div>` : ''}
                        </div>
                        <div class="text-right">
                             <!-- Right side actions if needed -->
                        </div>
                    </div>
                    <div class="mt-1">
                        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Attachments</p>
                        ${attachmentsHtml}
                    </div>
                `;
                container.appendChild(card);
            });
        } else {
            container.innerHTML = '<div class="flex flex-col items-center justify-center h-40 text-gray-400"><i class="fas fa-inbox text-5xl mb-4 opacity-20"></i><p class="font-medium text-lg">No matching emails found.</p><p class="text-sm">Try adjusting your date range or filters.</p></div>';
        }
    } catch (err) {
        console.error(err);
        container.innerHTML = '<div class="flex flex-col items-center justify-center h-40 text-red-500"><i class="fas fa-exclamation-circle text-4xl mb-3"></i><p>Error scanning inbox.</p></div>';
    }
}

async function processGmailAttachment(uid, filename, configId) {
    // 1. Determine Template
    if(configId) {
        const config = distributorConfigs.find(c => c.id == configId);
        if(config && config.template_id) {
            selectedTemplate = templates.find(t => t.id == config.template_id);
            // Set fallback vendor name from distributor config
            if (selectedTemplate) {
                selectedTemplate.fallback_distributor_name = config.distributor_name;
            }
        }
    }
    
    if(!selectedTemplate) {
        showMessage('Configuration Error', 'The selected distributor configuration does not have a linked Import Template. Please check the Distributor Configuration settings.', 'error');
        return;
    }

    // 2. Process
    showLoading(true, `Downloading ${filename}...`);
    try {
        const response = await fetch('/api/stock/gmail/process', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ uid, filename })
        });
        if (response.status === 401) { window.location.href = '/'; return; }
        const result = await response.json();
        showLoading(false);

        if(result.success) {
            importedData = result.data;
            const error = validateHeaders(result.headers);
            if(error) {
                showMessage('Validation Error', error, 'error');
            } else {
                renderItemLocationInputs();
                showStep(2);
            }
        } else {
            showMessage('Error', result.error, 'error');
        }
    } catch(err) {
        showLoading(false);
        showMessage('Error', 'Network error processing attachment.', 'error');
    }
}

// Expose functions
window.processGmailAttachment = processGmailAttachment;

function handleBackToStep1() {
    showStep(1);
    importedData = [];
    stockDetailsWithLocation = [];
    // Don't reset filters so user can pick another email
}

function resetState() {
    selectedTemplate = null;
    importedData = [];
    stockDetailsWithLocation = [];
    document.getElementById('items-to-locate-container').innerHTML = '<p class="text-gray-500 text-center py-4">Imported items will appear here...</p>';
    showStep(1);
}

document.addEventListener('DOMContentLoaded', () => {
    fetchTemplates();
    fetchDistributorConfigs(); // Auto fetch on load
    showStep(1);
    
    // Set default From Date to 30 days ago
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    document.getElementById('filterFromDate').valueAsDate = thirtyDaysAgo;

    document.getElementById('import-stocks-btn').addEventListener('click', importStocks);
    document.getElementById('back-to-step-1-btn').addEventListener('click', handleBackToStep1);
    
    // Email Search Button
    const btnSearch = document.getElementById('btnSearchEmails');
    if(btnSearch) btnSearch.addEventListener('click', searchEmails);
});