// Global State Variables
let templates = [];
let selectedTemplate = null;
let importedData = []; // Full data from the file
let stockDetailsWithLocation = []; // Final data structure ready for import

// --- Utility Functions ---

/**
 * Extract numeric value from packing string (e.g., "10 tablets" -> 10)
 * @param {string} packingString - The packing string to extract numbers from
 * @returns {number} - Extracted numeric value, default 1 if no numbers found
 */
function extractPackingValue(packingString) {
    if (!packingString) return 1;
    
    const str = String(packingString).trim();
    if (str === '') return 1;
    
    // Method 1: Try to extract numbers using regex (matches first sequence of digits)
    const numberMatch = str.match(/\d+/);
    if (numberMatch) {
        return parseInt(numberMatch[0], 10) || 1;
    }
    
    // Method 2: Common packing patterns
    const patterns = {
        'strip of': (s) => parseInt(s.match(/\d+/)?.[0]) || 1,
        'tablets': (s) => parseInt(s.match(/\d+/)?.[0]) || 1,
        'capsules': (s) => parseInt(s.match(/\d+/)?.[0]) || 1,
        'bottle of': (s) => parseInt(s.match(/\d+/)?.[0]) || 1,
        'pack of': (s) => parseInt(s.match(/\d+/)?.[0]) || 1,
        'box of': (s) => parseInt(s.match(/\d+/)?.[0]) || 1
    };
    
    const lowerStr = str.toLowerCase();
    for (const [pattern, extractor] of Object.entries(patterns)) {
        if (lowerStr.includes(pattern)) {
            const value = extractor(str);
            if (value > 0) return value;
        }
    }
    
    // Default to 1 if no numbers found
    return 1;
}

/**
 * Custom function to display modal messages instead of alert().
 * @param {string} title - The title of the modal.
 * @param {string} body - The message body.
 * @param {string} type - 'success', 'error', or 'info'.
 */
function showMessage(title, body, type = 'info') {
    const modal = document.getElementById('message-modal');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');

    // Reset classes
    titleEl.className = 'text-lg font-bold mb-3';

    // Set type-specific colors
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

/**
 * Parse date string based on format
 * @param {string} dateString - The date string to parse
 * @param {string} format - The format string (e.g., '%d/%m/%Y')
 * @returns {string|null} - Parsed date in YYYY-MM-DD format or null
 */
function parseDate(dateString, format) {
    if (!dateString || !format) return null;

    try {
        dateString = String(dateString).trim();
        if (!dateString || dateString === 'N/A' || dateString === '') return null;

        // Common date format mappings
        const formatMap = {
            '%d/%m/%Y': (str) => {
                const parts = str.split('/');
                if (parts.length === 3) {
                    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                }
                return null;
            },
            '%m/%d/%Y': (str) => {
                const parts = str.split('/');
                if (parts.length === 3) {
                    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
                }
                return null;
            },
            '%Y-%m-%d': (str) => str,
            '%d-%m-%Y': (str) => {
                const parts = str.split('-');
                if (parts.length === 3) {
                    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                }
                return null;
            }
        };

        const parser = formatMap[format];
        if (parser) {
            return parser(dateString);
        }

        // Default: try to parse as ISO date
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
    } catch (error) {
        console.error('Error parsing date:', error);
        return null;
    }
}

// --- API Calls ---

/**
 * Fetches all available templates for the dropdown.
 */
async function fetchTemplates() {
    try {
        const response = await fetch('/api/template/get-templates');
        if (!response.ok) throw new Error('Failed to fetch templates');

        const result = await response.json();
        if (result.success) {
            templates = result.templates;
            populateTemplateDropdown(templates);
        } else {
            showMessage('Error', result.error || 'Could not load templates.', 'error');
        }
    } catch (error) {
        console.error('Error fetching templates:', error);
        showMessage('Error', 'An error occurred while fetching templates. Please check the network connection.', 'error');
    }
}

/**
 * Submits the file for server-side processing and data extraction.
 * @param {File} file - The file to upload.
 */
async function processFile(file) {
    const formData = new FormData();
    formData.append('importFile', file);

    try {
        showLoading(true);
        const response = await fetch('/api/stock/process-file', {
            method: 'POST',
            body: formData,
        });

        // Check if response is OK before parsing JSON
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server response not OK:', response.status, errorText);
            showLoading(false);
            return {
                success: false,
                error: `Server error (${response.status}): ${errorText || 'Please check the file format and try again.'}`
            };
        }

        const result = await response.json();
        showLoading(false);

        if (result.success) {
            importedData = result.data;
            return { success: true, headers: result.headers };
        } else {
            return { success: false, error: result.error || 'Server rejected file processing.' };
        }
    } catch (error) {
        showLoading(false);
        console.error('File processing failed:', error);
        return {
            success: false,
            error: 'A network error occurred while uploading the file. Please check your connection.'
        };
    }
}

// Add this function to fetch last locations
async function fetchLastLocations(itemNames) {
    try {
        const response = await fetch('/api/stock/get-last-locations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemNames })
        });

        if (!response.ok) throw new Error('Failed to fetch last locations');
        
        const result = await response.json();
        return result.success ? result.locations : {};
    } catch (error) {
        console.error('Error fetching last locations:', error);
        return {};
    }
}

/**
 * Final submission of stock data with locations.
 */
async function importStocks() {
    if (stockDetailsWithLocation.length === 0) {
        showMessage('Import Error', 'No stock items to import.', 'error');
        return;
    }

    // Basic location validation check
    const missingLocation = stockDetailsWithLocation.some(item => !item.location || item.location.trim() === '');
    if (missingLocation) {
        showMessage('Validation Required', 'Please ensure a location is specified for ALL items before importing.', 'error');
        return;
    }

    const payload = {
        templateId: selectedTemplate.id,
        masterData: getMasterDataFromImported(importedData[0] || {}),
        stockDetails: stockDetailsWithLocation,
    };

    document.getElementById('import-stocks-btn').disabled = true;

    try {
        showLoading(true);
        const response = await fetch('/api/stock/import-stocks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const result = await response.json();
        showLoading(false);

        if (result.success) {
            let successMessage = result.message;

            // Add details about skipped items if any
            if (result.skippedCount > 0) {
                successMessage += '\n\nSkipped items (duplicates):\n' +
                    result.skippedItems.map(item =>
                        `• ${item.item_name}${item.batch_number ? ` (Batch: ${item.batch_number})` : ''}`
                    ).join('\n');
            }

            // Add barcode printing option
            successMessage += `\n\nBarcodes have been automatically generated for all imported items. You can print them now.`;

            showMessage('Success',
                `${successMessage}
        <br><br>
        <div class="flex space-x-3 justify-center">
            <button onclick="location.href='/barcode-printing.html'" 
                    class="bg-quarterly text-white px-6 py-2 rounded-lg font-semibold hover:bg-orange-600 transition duration-200">
                <i class="fas fa-barcode mr-2"></i>Print Barcodes Now
            </button>
            <button onclick="resetState()" 
                    class="bg-primary text-white px-6 py-2 rounded-lg font-semibold hover:bg-green-800 transition duration-200">
                <i class="fas fa-plus mr-2"></i>Import More Stocks
            </button>
        </div>`,
                'success');
            resetState();
        } else {
            showMessage('Import Failed', result.error || 'Server failed to import stocks.', 'error');
            document.getElementById('import-stocks-btn').disabled = false;
        }

    } catch (error) {
        showLoading(false);
        console.error('Final import failed:', error);
        showMessage('Error', 'A network error occurred during final stock import.', 'error');
        document.getElementById('import-stocks-btn').disabled = false;
    }
}

// --- UI Helpers ---

/**
 * Populates the template dropdown with fetched data.
 * @param {Array<Object>} tplts - Array of template objects.
 */
function populateTemplateDropdown(tplts) {
    const dropdown = document.getElementById('template-select');
    // Clear existing options except the first one
    dropdown.innerHTML = '<option value="" disabled selected>-- Select a Template --</option>';

    tplts.forEach(template => {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = template.template_name;
        dropdown.appendChild(option);
    });
}

function showStep(step) {
    document.getElementById('step-1').classList.add('hidden');
    document.getElementById('step-2').classList.add('hidden');
    if (step === 1) {
        document.getElementById('step-1').classList.remove('hidden');
    } else if (step === 2) {
        document.getElementById('step-2').classList.remove('hidden');
    }
}

// --- Validation and Mapping Logic ---

/**
 * Compares file headers against the selected template's required columns.
 * @param {Array<string>} fileHeaders - Headers extracted from the uploaded file.
 * @returns {string | null} Error message if validation fails, otherwise null.
 */
function validateHeaders(fileHeaders) {
    if (!selectedTemplate) {
        return 'Please select an import template first.';
    }

    const templateColumns = [
        'vendor_detail_col', 'item_name_col', 'quantity_col', 'rate_col', 'mrp_col',
        'invoice_no_col', 'invoice_date_col', 'item_desc_col', 'manufacturer_col',
        'batch_number_col', 'hsn_code_col', 'free_col', 'tax_col', 'packing_col', // CHANGED: mfg_date_col to packing_col
        'expiry_date_col'
    ];

    let missingColumns = [];

    // Check all required columns from the template.
    // The columns store the actual header string expected in the file.
    for (const key of templateColumns) {
        const expectedHeader = selectedTemplate[key] ? String(selectedTemplate[key]).trim().toLowerCase() : null;

        // Only check if the template field is mapped (i.e., not null/empty/NA) AND required
        // Based on ImportTemplate.js: vendor_detail_col, item_name_col, quantity_col, rate_col, mrp_col are REQUIRED
        const isRequired = ['vendor_detail_col', 'item_name_col', 'quantity_col', 'rate_col', 'mrp_col'].includes(key);

        if (isRequired && expectedHeader) {
            if (!fileHeaders.map(h => h.toLowerCase()).includes(expectedHeader)) {
                missingColumns.push(selectedTemplate[key]);
            }
        }
    }

    if (missingColumns.length > 0) {
        return `File headers do not match the template. Missing or mismatched required column(s) from your file: ${missingColumns.join(', ')}.`;
    }

    return null; // Validation passed
}

/**
 * Renders the list of imported items for location assignment.
 */
async function renderItemLocationInputs() {
    const container = document.getElementById('items-to-locate-container');
    container.innerHTML = '';
    stockDetailsWithLocation = [];

    // Add comprehensive null check for selectedTemplate and required fields
    if (!selectedTemplate) {
        container.innerHTML = '<p class="text-red-500 text-center py-4">Error: No template selected.</p>';
        return;
    }

    if (!selectedTemplate.item_name_col) {
        container.innerHTML = '<p class="text-red-500 text-center py-4">Error: Selected template is missing Item Name column configuration.</p>';
        return;
    }

    // Clean the column name key
    const itemNameColumnKey = cleanColumnName(selectedTemplate.item_name_col);

    if (importedData.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-4">No data rows found in the uploaded file.</p>';
        return;
    }

    // Prepare stock details and collect item names for location lookup
    const itemNames = [];
    importedData.forEach((row, index) => {
        const detail = mapImportRowToStockDetail(row);
        stockDetailsWithLocation.push(detail);
        
        // Collect item name for location lookup
        const itemName = row[itemNameColumnKey];
        if (itemName) {
            itemNames.push(itemName);
        }
    });

    // Fetch last used locations for these items
    let lastLocations = {};
    if (itemNames.length > 0) {
        lastLocations = await fetchLastLocations(itemNames);
    }

    // Render UI with pre-filled locations where available
    importedData.forEach((row, index) => {
        const itemName = row[itemNameColumnKey] || `Item ${index + 1}`;
        const detail = stockDetailsWithLocation[index];
        
        // Get last used location for this item, if available
        const lastLocation = lastLocations[itemName] || '';
        detail.location = lastLocation; // Pre-fill the location

        // Create UI element - UPDATED packing display
        const card = document.createElement('div');
        card.className = 'item-card p-4 bg-white rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-center space-y-2 sm:space-y-0';
        card.innerHTML = `
            <div class="flex-grow w-full sm:w-auto">
                <p class="font-semibold text-gray-800">${itemName}</p>
                <p class="text-xs text-gray-500">Qty: ${detail.quantity} | Batch: ${detail.batch_number || 'N/A'}</p>
                ${detail.packing ? `<p class="text-xs text-blue-600 mt-1">Packing: ${detail.packing} units per item</p>` : ''}
                ${lastLocation ? `<p class="text-xs text-green-600 mt-1">Last used location: ${lastLocation}</p>` : ''}
            </div>
            <div class="w-full sm:w-1/3">
                <input type="text" 
                       placeholder="Enter Location (Shelf/Area)" 
                       value="${lastLocation}"
                       class="location-input w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-primary focus:border-primary"
                       data-index="${index}">
            </div>
        `;
        container.appendChild(card);
    });

    // Add listener for location inputs
    container.querySelectorAll('.location-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            if (stockDetailsWithLocation[index]) {
                stockDetailsWithLocation[index].location = e.target.value.trim();
            }
        });
    });

    // Render Master Data Review
    renderMasterDataReview(importedData[0]);
}

/**
 * Cleans a column name to match the format used in Python script
 * @param {string} columnName - The original column name
 * @returns {string} Cleaned column name
 */
function cleanColumnName(columnName) {
    if (!columnName) return '';
    return String(columnName).trim().toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_');
}

/**
 * Maps a single row of imported data to the final stock detail structure.
 * @param {Object} row - One row of data from the imported file.
 */
function mapImportRowToStockDetail(row) {
    const detail = {};

    // Function to safely extract and clean value using template's column name
    const getValue = (templateKey, dataType = 'string') => {
        // Check if template and template key exist
        if (!selectedTemplate || !selectedTemplate[templateKey]) {
            return null;
        }

        const expectedHeader = selectedTemplate[templateKey];
        if (!expectedHeader) return null;

        // Clean the header string to match the key used in Python script
        const rowKey = cleanColumnName(expectedHeader);
        let value = row[rowKey];

        if (value === undefined || value === null) return null;

        value = String(value).trim();
        if (value === '') return null;

        if (dataType === 'number') {
            const num = parseFloat(value);
            return isNaN(num) ? null : num;
        }
        if (dataType === 'date') {
            // Simple date cleanup - assuming the Python script returned an ISO string if it was a date
            return value.split('T')[0] || null;
        }
        if (dataType === 'packing') {
            // NEW: Extract numeric packing value from string
            return extractPackingValue(value);
        }
        return value || null;
    };

    // Map all required fields
    detail.item_name = getValue('item_name_col');
    detail.item_desc = getValue('item_desc_col');
    detail.manufacturer = getValue('manufacturer_col');
    detail.hsn_code = getValue('hsn_code_col');
    detail.batch_number = getValue('batch_number_col');
    detail.expiry_date = getValue('expiry_date_col', 'date');
    detail.packing = getValue('packing_col', 'packing'); // CHANGED: Can be null now
    detail.quantity = getValue('quantity_col', 'number');
    detail.free_quantity = getValue('free_col', 'number');
    detail.rate = getValue('rate_col', 'number');
    detail.mrp = getValue('mrp_col', 'number');
    detail.location = '';

    return detail;
}

/**
 * Extracts and prepares master data for review.
 * @param {Object} firstRow - The first row of data from the imported file.
 */
function getMasterDataFromImported(firstRow) {
    if (!selectedTemplate || !firstRow) {
        return {
            vendor_name: 'N/A',
            invoice_no: 'N/A',
            invoice_date: 'N/A',
        };
    }

    // Function to safely extract and clean value using template's column name
    const getValue = (templateKey, isDate = false) => {
        if (!selectedTemplate[templateKey]) return 'N/A';

        const expectedHeader = selectedTemplate[templateKey];
        if (!expectedHeader) return 'N/A';

        const rowKey = cleanColumnName(expectedHeader);
        const value = firstRow[rowKey];
        if (value === undefined || value === null) return 'N/A';

        const strValue = String(value).trim();

        // Handle date parsing for invoice date
        if (isDate && templateKey === 'invoice_date_col' && selectedTemplate.invoice_date_format) {
            const parsedDate = parseDate(strValue, selectedTemplate.invoice_date_format);
            return parsedDate || strValue;
        }

        return strValue;
    };

    return {
        vendor_name: getValue('vendor_detail_col'),
        invoice_no: getValue('invoice_no_col'),
        invoice_date: getValue('invoice_date_col', true), // true indicates it's a date field
    };
}

/**
 * Renders the master data review section.
 * @param {Object} firstRow - The first row of data from the imported file.
 */
function renderMasterDataReview(firstRow) {
    const container = document.getElementById('master-data-review');
    const masterData = getMasterDataFromImported(firstRow);

    container.innerHTML = `
        <div>
            <p class="text-xs font-medium text-gray-500">Vendor Name</p>
            <p class="font-bold text-gray-800">${masterData.vendor_name}</p>
        </div>
        <div>
            <p class="text-xs font-medium text-gray-500">Invoice No.</p>
            <p class="font-bold text-gray-800">${masterData.invoice_no}</p>
        </div>
        <div>
            <p class="text-xs font-medium text-gray-500">Invoice Date</p>
            <p class="font-bold text-gray-800">${masterData.invoice_date}</p>
        </div>
        <div>
            <p class="text-xs font-medium text-gray-500">Template Used</p>
            <p class="font-bold text-primary">${selectedTemplate.template_name}</p>
        </div>
    `;
}

// --- Event Handlers ---

function handleTemplateSelectChange(e) {
    const templateId = e.target.value;

    if (!templateId) {
        selectedTemplate = null;
        document.getElementById('process-file-btn').disabled = true;
        return;
    }

    // Find the template - use strict equality and ensure we find it
    selectedTemplate = templates.find(t => String(t.id) === String(templateId));

    console.log('Template selection:', {
        templateId: templateId,
        selectedTemplate: selectedTemplate,
        templates: templates
    });

    if (selectedTemplate) {
        document.getElementById('template-select-error').classList.add('hidden');
        document.getElementById('process-file-btn').disabled = false;

        // Log FULL template structure for debugging
        console.log('Selected FULL template structure:', selectedTemplate);
    } else {
        document.getElementById('template-select-error').classList.remove('hidden');
        document.getElementById('process-file-btn').disabled = true;
        console.error('Template not found for ID:', templateId);
    }
}

async function handleProcessFileClick() {
    const templateSelect = document.getElementById('template-select');
    const fileInput = document.getElementById('import-file');
    const validationOutput = document.getElementById('validation-output');
    const validationMessage = document.getElementById('validation-message');

    validationOutput.classList.add('hidden');
    document.getElementById('file-upload-error').classList.add('hidden');

    // More robust template check with validation of required fields
    if (!selectedTemplate || !selectedTemplate.id) {
        templateSelect.focus();
        document.getElementById('template-select-error').classList.remove('hidden');
        document.getElementById('template-select-error').textContent = 'Please select a valid template.';
        return;
    }

    // Check if template has required column mappings
    const requiredFields = ['item_name_col', 'vendor_detail_col', 'quantity_col', 'rate_col', 'mrp_col'];
    const missingMappings = requiredFields.filter(field => !selectedTemplate[field]);

    if (missingMappings.length > 0) {
        document.getElementById('template-select-error').textContent = `Selected template is missing required column mappings: ${missingMappings.join(', ')}. Please edit the template first.`;
        document.getElementById('template-select-error').classList.remove('hidden');
        return;
    }

    console.log('Processing file with template:', selectedTemplate);

    if (fileInput.files.length === 0) {
        document.getElementById('file-upload-error').textContent = 'Please select a file to upload.';
        document.getElementById('file-upload-error').classList.remove('hidden');
        return;
    }

    const file = fileInput.files[0];
    const extension = file.name.split('.').pop().toLowerCase();
    console.log('File upload attempt:', {
        fileName: file.name,
        extension: extension,
        fileSize: file.size,
        fileType: file.type,
        selectedTemplate: selectedTemplate
    });

    // Client-side file type validation
    if (!['xlsx', 'xls', 'csv'].includes(extension)) {
        document.getElementById('file-upload-error').textContent = 'Invalid file type. Only .xlsx, .xls, and .csv are allowed.';
        document.getElementById('file-upload-error').classList.remove('hidden');
        return;
    }

    console.log('Frontend validation passed, calling processFile...');
    const result = await processFile(file);
    console.log('Process file result:', result);

    if (result.success) {
        console.log('File processed successfully, validating headers...');
        console.log('Headers from file:', result.headers);
        console.log('Template columns:', {
            item_name_col: selectedTemplate.item_name_col,
            vendor_detail_col: selectedTemplate.vendor_detail_col,
            quantity_col: selectedTemplate.quantity_col,
            packing_col: selectedTemplate.packing_col // NEW: Log packing column
        });

        // 1. Validate Headers against the selected template
        const validationError = validateHeaders(result.headers);

        if (validationError) {
            validationMessage.textContent = validationError;
            validationOutput.classList.remove('hidden');
        } else {
            validationOutput.classList.add('hidden');
            renderItemLocationInputs();
            showStep(2);
            showMessage('Validation Success', 'File validated successfully against the template. Please add stock locations and finalize the import.', 'success');
        }
    } else {
        // This handles errors from the server/Python script, including the unsupported file type error
        validationMessage.textContent = result.error;
        validationOutput.classList.remove('hidden');
    }
}

function handleBackToStep1() {
    showStep(1);
}

function resetState() {
    selectedTemplate = null;
    importedData = [];
    stockDetailsWithLocation = [];
    document.getElementById('template-select').selectedIndex = 0;
    document.getElementById('import-file').value = '';
    document.getElementById('validation-output').classList.add('hidden');
    document.getElementById('file-upload-error').classList.add('hidden');
    document.getElementById('template-select-error').classList.add('hidden');
    document.getElementById('process-file-btn').disabled = true;
    showStep(1);
    document.getElementById('items-to-locate-container').innerHTML = '<p class="text-gray-500 text-center py-4">Imported items will appear here...</p>';
    document.getElementById('master-data-review').innerHTML = '';
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    // Initial fetch of templates
    fetchTemplates();
    showStep(1); // Start at Step 1

    // Event listeners
    document.getElementById('template-select').addEventListener('change', handleTemplateSelectChange);
    document.getElementById('process-file-btn').addEventListener('click', handleProcessFileClick);
    document.getElementById('import-stocks-btn').addEventListener('click', importStocks);
    document.getElementById('back-to-step-1-btn').addEventListener('click', handleBackToStep1);

    // Initial button state
    document.getElementById('process-file-btn').disabled = true;

    // Debug: Check if elements exist
    console.log('DOM loaded, elements found:', {
        templateSelect: document.getElementById('template-select'),
        processFileBtn: document.getElementById('process-file-btn'),
        importFile: document.getElementById('import-file')
    });
});