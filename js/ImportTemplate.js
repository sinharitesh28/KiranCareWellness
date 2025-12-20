// ImportTemplate.js - Updated with edit and delete functionality
// Updated required fields configuration with systematic sequencing
const REQUIRED_FIELDS = [
    // Basic Information
    { id: 'vendor_detail_col', label: 'Vendor Details Column', required: true },
    { id: 'invoice_no_col', label: 'Invoice No Column', required: false },
    { id: 'invoice_date_col', label: 'Invoice Date Column', required: false },
    
    // Product Information
    { id: 'item_name_col', label: 'Item Name Column', required: true },
    { id: 'item_desc_col', label: 'Item Description Column', required: false },
    { id: 'manufacturer_col', label: 'Manufacturer Column', required: false },
    { id: 'batch_number_col', label: 'Batch Number Column', required: false },
    { id: 'hsn_code_col', label: 'HSN Code Column', required: false },
    
    // Quantity and Pricing
    { id: 'quantity_col', label: 'Quantity Column', required: true },
    { id: 'free_col', label: 'Free Column', required: false },
    { id: 'rate_col', label: 'Rate Column', required: true },
    { id: 'mrp_col', label: 'MRP Column', required: true },
    
    // Packing Information
    { id: 'packing_col', label: 'Packing (Unit Dose Count)', required: false },
    { id: 'expiry_date_col', label: 'Expiry Date Column', required: false },
];

const DATE_FIELDS = [
    { colId: 'invoice_date_col', formatId: 'invoice_date_format', label: 'Invoice Date' },
    { colId: 'expiry_date_col', formatId: 'expiry_date_format', label: 'Expiry Date' },
];

let globalHeaders = [];
let sampleValues = {};
let finalTemplateData = {}; // To hold template data after initial check but before final save
let dateColumnsToValidate = []; // To hold the list of date columns that were mapped by the user
let isEditing = false; // Flag to track if we are in edit mode

// --- Utility Functions (showMessage) ---

function showMessage(title, message, type = 'info') {
    // Determine color classes based on message type
    let bgColor, borderColor, textColor;
    switch (type) {
        case 'success':
            bgColor = 'bg-green-100';
            borderColor = 'border-green-500';
            textColor = 'text-green-700';
            break;
        case 'error':
            bgColor = 'bg-red-100';
            borderColor = 'border-red-500';
            textColor = 'text-red-700';
            break;
        case 'info':
        default:
            bgColor = 'bg-blue-100';
            borderColor = 'border-blue-500';
            textColor = 'text-blue-700';
            break;
    }

    const container = document.getElementById('messageContainer');
    const messageElement = document.createElement('div');
    messageElement.className = `p-4 border-l-4 ${borderColor} ${bgColor} ${textColor} rounded-r-lg shadow-lg max-w-sm`;
    messageElement.innerHTML = `<p class="font-bold">${title}</p><p class="text-sm">${message}</p>`;

    container.prepend(messageElement);

    setTimeout(() => {
        messageElement.remove();
    }, 5000);
}

// --- Initialization and Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    renderMappingSection();
    addTemplateNamePreview();
    fetchSavedTemplates(); // Load saved templates on startup
});

function initializeEventListeners() {
    document.getElementById('extractHeadersButton').addEventListener('click', handleFileExtraction);
    document.getElementById('templateForm').addEventListener('submit', (e) => e.preventDefault()); // Prevent default submit on form
    
    // New validation workflow buttons
    document.getElementById('startValidationButton').addEventListener('click', startDateFormatValidation);
    document.getElementById('validateFormatButton').addEventListener('click', validateDateFormats);
    document.getElementById('saveTemplateFinalButton').addEventListener('click', saveTemplate);
    
    // Update button (hidden by default)
    document.getElementById('updateTemplateButton').addEventListener('click', startDateFormatValidation);
    document.getElementById('updateTemplateFinalButton').addEventListener('click', updateTemplate);
}

// --- UI Rendering Functions ---

function renderMappingSection() {
    const container = document.getElementById('mappingSection');
    container.innerHTML = '';
    
    REQUIRED_FIELDS.forEach(field => {
        // Create the div container for the field
        const div = document.createElement('div');
        div.className = 'flex flex-col space-y-1';
        div.id = `field_container_${field.id}`;
        
        // Label
        const label = document.createElement('label');
        label.className = 'text-sm font-medium text-gray-700 flex items-center';
        label.htmlFor = field.id;
        label.textContent = field.label;
        if (field.required) {
            label.innerHTML += ' <span class="text-red-500 ml-1">*</span>';
        }
        
        // Select dropdown
        const select = document.createElement('select');
        select.id = field.id;
        select.name = field.id;
        select.required = field.required; // Note: HTML required only works if no-selection is disabled
        select.className = 'mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-primary focus:border-primary bg-white';
        
        // Append elements
        div.appendChild(label);
        div.appendChild(select);
        container.appendChild(div);
        
        // Optional error message below the input
        const errorMsg = document.createElement('p');
        errorMsg.id = `${field.id}_error`;
        errorMsg.className = 'text-xs text-red-500 mt-1 hidden';
        div.appendChild(errorMsg);
    });
}

// Updates dropdowns with extracted headers
function updateDropdowns(headers) {
    REQUIRED_FIELDS.forEach(field => {
        const select = document.getElementById(field.id);
        if (select) {
            const currentValue = select.value; // Preserve current value if any
            
            // Clear existing options
            select.innerHTML = '';
            
            // Add default "Select Column" option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = field.required ? '--- Select Column ---' : '--- Ignore ---';
            select.appendChild(defaultOption);

            // Add headers
            headers.forEach(header => {
                const option = document.createElement('option');
                option.value = header;
                option.textContent = header;
                select.appendChild(option);
            });
            
            // Restore value if it exists in new headers
            if (headers.includes(currentValue)) {
                select.value = currentValue;
            }
        }
    });

    // Show the mapping and action sections
    document.getElementById('mappingSection').classList.remove('hidden');
    document.getElementById('templateNamingSection').classList.remove('hidden');
    document.getElementById('initialActionButtons').classList.remove('hidden');
    document.getElementById('dateFormatValidationSection').classList.add('hidden'); // Ensure validation section is hidden
}

// --- Form Handlers ---

// Handles the file upload and header extraction process
async function handleFileExtraction() {
    const fileInput = document.getElementById('template_file');
    const file = fileInput.files[0];
    const errorDisplay = document.getElementById('templateFileError');
    const extractButton = document.getElementById('extractHeadersButton');

    if (!file) {
        errorDisplay.textContent = 'Please select a file before extracting headers.';
        errorDisplay.classList.remove('hidden');
        return;
    }
    
    errorDisplay.classList.add('hidden');
    extractButton.disabled = true;
    extractButton.textContent = 'Extracting...';

    const formData = new FormData();
    formData.append('template_file', file);

    try {
        const response = await fetch('/api/template/extract-headers', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (response.ok && result.success) {
            globalHeaders = result.headers;
            sampleValues = result.sample_values || {}; // Store sample values globally
            
            updateDropdowns(globalHeaders);
            showMessage('Success', 'Headers extracted and dropdowns updated!', 'success');
            
            // Update template name preview only if creating new
            if (!isEditing) {
                updateTemplateNamePreview(); 
            }
        } else {
            showMessage('Error', result.error || 'Failed to extract headers.', 'error');
        }
    } catch (error) {
        console.error('Fetch error:', error);
        showMessage('Network Error', 'A network error occurred during header extraction.', 'error');
    } finally {
        extractButton.disabled = false;
        extractButton.textContent = 'Extract Headers';
    }
}

// Validates that all required fields are mapped (not null/empty)
function validateForm() {
    let isValid = true;
    let firstErrorElement = null;
    document.getElementById('mappingError').classList.add('hidden');
    
    // Validate Template Name
    const templateName = document.getElementById('template_name').value.trim();
    if (!templateName) {
        document.getElementById('mappingError').textContent = 'Please provide a name for the template.';
        document.getElementById('mappingError').classList.remove('hidden');
        document.getElementById('template_name').focus();
        return false;
    }

    // Validate Required Dropdowns
    REQUIRED_FIELDS.filter(field => field.required).forEach(field => {
        const select = document.getElementById(field.id);
        const errorMsg = document.getElementById(`${field.id}_error`);
        
        if (select.value === '') {
            errorMsg.textContent = `${field.label} is required.`;
            errorMsg.classList.remove('hidden');
            isValid = false;
            if (!firstErrorElement) firstErrorElement = select;
        } else {
            errorMsg.classList.add('hidden');
        }
    });
    
    // Scroll to the first error if validation failed
    if (!isValid && firstErrorElement) {
        firstErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('mappingError').textContent = 'Please map all required fields marked with *.';
        document.getElementById('mappingError').classList.remove('hidden');
    }

    return isValid;
}

// --- NEW DATE VALIDATION WORKFLOW ---

function startDateFormatValidation(event) {
    event.preventDefault();

    // 1. Initial form validation (check required fields are mapped)
    if (!validateForm()) {
        showMessage('Validation Error', 'Please map all required fields first.', 'error');
        return;
    }

    const formatSection = document.getElementById('dateFormatValidationSection');
    const dateFieldsContainer = document.getElementById('dateFieldsContainer');
    const startButton = document.getElementById('startValidationButton');
    const updateButton = document.getElementById('updateTemplateButton');
    const finalSaveButton = document.getElementById('saveTemplateFinalButton');
    const finalUpdateButton = document.getElementById('updateTemplateFinalButton');
    const validationError = document.getElementById('formatValidationError');
    const validateButton = document.getElementById('validateFormatButton');

    // Reset visibility and state
    validationError.classList.add('hidden');
    finalSaveButton.classList.add('hidden');
    finalUpdateButton.classList.add('hidden');
    validateButton.classList.remove('hidden');
    dateFieldsContainer.innerHTML = '';
    dateColumnsToValidate = []; // Clear previous list
    
    // Also hide any previous field-level success/error messages
    document.querySelectorAll('[id$="_error"]').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('[id$="_success"]').forEach(el => el.classList.add('hidden'));


    // Collect all form data (excluding file)
    const formData = new FormData(document.getElementById('templateForm'));
    const templateData = {};
    for (const [key, value] of formData.entries()) {
        // Only trim if value is a string, otherwise keep as-is
        templateData[key] = (typeof value === 'string') ? value.trim() : value;
    }
    
    // Store data for final save
    finalTemplateData = templateData;

    // 2. Identify which date fields were mapped and need validation
    DATE_FIELDS.forEach(field => {
        const mappedColName = templateData[field.colId]; // e.g., 'invoice_date_col' value (the header name)
        if (mappedColName) {
            dateColumnsToValidate.push({
                ...field,
                mappedColName: mappedColName,
                // Use global sampleValues populated by extract_headers. Replace null/undefined with empty string.
                sampleValue: sampleValues[mappedColName] || '' 
            });
        }
    });

    // 3. If no date fields are mapped, skip this step and proceed to final save/update
    if (dateColumnsToValidate.length === 0) {
        showMessage('Template Ready', 'No date fields mapped. Saving template...', 'info');
        if (isEditing) {
            updateTemplate();
        } else {
            saveTemplate();
        }
        return;
    }

    // 4. Generate dynamic inputs and show section
    generateDateFieldInputs(dateColumnsToValidate, dateFieldsContainer);

    // Hide initial save/update button, show validation section
    startButton.classList.add('hidden');
    updateButton.classList.add('hidden');
    formatSection.classList.remove('hidden');
    
    // Scroll to the validation section
    formatSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function generateDateFieldInputs(fields, containerElement) {
    fields.forEach(field => {
        // If editing, try to pre-fill the format from the existing template data (which is in finalTemplateData or should be passed)
        // Since finalTemplateData is fresh from form, format fields won't be there yet unless we populated form inputs for them.
        // We need to fetch the existing format if editing.
        // Actually, let's assume we populated hidden fields or handle it here.
        // Ideally, if editing, the user might want to change it.
        
        let existingFormat = '';
        if (isEditing && window.currentTemplate) {
            existingFormat = window.currentTemplate[field.formatId] || '';
        }

        const html = `
            <div class="p-4 border border-gray-200 rounded-lg bg-white shadow-sm">
                <label class="block text-sm font-medium text-gray-700 mb-1">${field.label} Format</label>
                <div class="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
                    <div class="flex-grow">
                        <p class="text-xs text-primary font-semibold mb-1">Sample Value from Row 2 (for format inspection):</p>
                        <p class="text-sm font-mono p-2 bg-gray-50 border rounded">${field.sampleValue || '— EMPTY/N/A —'}</p>
                    </div>
                    <div class="sm:w-1/2">
                        <label for="${field.formatId}" class="block text-xs font-medium text-gray-700">MySQL Format String (e.g., %d/%m/%Y):</label>
                        <input type="text" id="${field.formatId}" name="${field.formatId}" 
                               value="${existingFormat}" placeholder="e.g., %d/%m/%Y" 
                               class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-primary focus:border-primary">
                    </div>
                </div>
                <p id="${field.formatId}_error" class="text-xs text-red-500 mt-1 hidden"></p>
                <p id="${field.formatId}_success" class="text-xs text-green-500 mt-1 hidden font-semibold">Format validated successfully!</p>
            </div>
        `;
        containerElement.insertAdjacentHTML('beforeend', html);
    });
}

async function validateDateFormats() {
    const validationError = document.getElementById('formatValidationError');
    const finalSaveButton = document.getElementById('saveTemplateFinalButton');
    const finalUpdateButton = document.getElementById('updateTemplateFinalButton');
    const validateButton = document.getElementById('validateFormatButton');
    
    // Reset state
    validationError.classList.add('hidden');
    finalSaveButton.classList.add('hidden');
    finalUpdateButton.classList.add('hidden');
    document.querySelectorAll('[id$="_error"]').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('[id$="_success"]').forEach(el => el.classList.add('hidden'));

    // 1. Client-side check for empty format strings
    let formats = {};
    let clientError = false;
    dateColumnsToValidate.forEach(field => {
        const formatInput = document.getElementById(field.formatId);
        formats[field.formatId] = formatInput ? formatInput.value.trim() : '';
        
        // Update finalTemplateData immediately with user input
        finalTemplateData[field.formatId] = formats[field.formatId];

        if (formats[field.formatId] === '') {
            const errorElement = document.getElementById(`${field.formatId}_error`);
            errorElement.textContent = `${field.label} format cannot be empty.`;
            errorElement.classList.remove('hidden');
            clientError = true;
        }
    });

    if (clientError) {
        validationError.textContent = 'Please fill in all required date formats.';
        validationError.classList.remove('hidden');
        return;
    }

    validateButton.disabled = true;
    validateButton.textContent = 'Validating...';

    // 2. Prepare payload for backend validation
    const validationPayload = {
        formats: formats, // e.g., { invoice_date_format: '%d/%m/%Y', ... }
        dateColumns: dateColumnsToValidate.map(f => ({
            colId: f.colId,
            formatId: f.formatId,
            sampleValue: f.sampleValue
        }))
    };
    
    try {
        const response = await fetch('/api/template/validate-date-formats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validationPayload)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showMessage('Validation Success', 'All date formats are valid! Click "Confirm" to finalize.', 'success');
            validateButton.classList.add('hidden');
            
            if (isEditing) {
                finalUpdateButton.classList.remove('hidden');
            } else {
                finalSaveButton.classList.remove('hidden');
            }
            
            // Show success messages for each field
            result.validated_fields.forEach(fieldId => {
                document.getElementById(`${fieldId}_success`).classList.remove('hidden');
            });

        } else if (result.error_field) {
            // Specific field error
            const errorElement = document.getElementById(`${result.error_field}_error`);
            errorElement.textContent = result.message || 'Invalid format for the sample value.';
            errorElement.classList.remove('hidden');
            validationError.textContent = 'Date format validation failed for one or more fields. Please correct and re-validate.';
            validationError.classList.remove('hidden');
            
        } else {
            // General error
            validationError.textContent = result.error || 'Date format validation failed due to a server error.';
            validationError.classList.remove('hidden');
        }

    } catch (error) {
        console.error('Validation fetch error:', error);
        validationError.textContent = 'Network error during validation. Check console.';
        validationError.classList.remove('hidden');
    } finally {
        validateButton.disabled = false;
        validateButton.textContent = 'Validate Date Format';
        // Restore button visibility logic handled in success block above
        if (finalSaveButton.classList.contains('hidden') && finalUpdateButton.classList.contains('hidden')) {
             validateButton.classList.remove('hidden');
        }
    }
}

// Final template saving function (called after successful date validation)
async function saveTemplate() {
    processTemplateSave('/api/template/save-template', 'POST');
}

async function updateTemplate() {
    const templateId = document.getElementById('editing_template_id').value;
    processTemplateSave(`/api/template/update-template/${templateId}`, 'PUT');
}

async function processTemplateSave(url, method) {
    // Clean up finalTemplateData - ensure all string values are trimmed
    Object.keys(finalTemplateData).forEach(key => {
        if (typeof finalTemplateData[key] === 'string') {
            finalTemplateData[key] = finalTemplateData[key].trim();
        }
    });

    // Ensure finalTemplateData is populated
    if (Object.keys(finalTemplateData).length === 0) {
        showMessage('Error', 'Template data missing. Please map headers and re-run validation.', 'error');
        return;
    }

    const startButton = document.getElementById('startValidationButton');
    const updateButton = document.getElementById('updateTemplateButton');
    const finalSaveButton = document.getElementById('saveTemplateFinalButton');
    const finalUpdateButton = document.getElementById('updateTemplateFinalButton');
    const validationSection = document.getElementById('dateFormatValidationSection');
    const validationError = document.getElementById('formatValidationError');

    // Disable active button
    const activeBtn = method === 'PUT' ? finalUpdateButton : finalSaveButton;
    activeBtn.disabled = true;
    activeBtn.textContent = 'Saving...';
    validationError.classList.add('hidden');

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalTemplateData)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showMessage('Success', result.message || 'Template saved successfully!', 'success');
            
            // Cleanup UI
            resetForm(); 
            fetchSavedTemplates(); // Refresh the list

        } else {
            validationError.textContent = result.error || 'Failed to save template. Check server logs.';
            validationError.classList.remove('hidden');
            showMessage('Save Error', validationError.textContent, 'error');
        }

    } catch (error) {
        console.error('Save fetch error:', error);
        showMessage('Network Error', 'A network error occurred while saving the template.', 'error');
    } finally {
        activeBtn.disabled = false;
        activeBtn.textContent = method === 'PUT' ? 'Confirm & Update Template' : 'Confirm & Save Template';
    }
}


// --- Reset and Preview ---

// Resets the form and hides dynamic sections
function resetForm() {
    document.getElementById('templateForm').reset();
    
    globalHeaders = [];
    sampleValues = {};
    finalTemplateData = {};
    dateColumnsToValidate = [];
    isEditing = false;
    window.currentTemplate = null;
    
    // Hide sections
    document.getElementById('mappingSection').classList.add('hidden');
    document.getElementById('templateNamingSection').classList.add('hidden');
    document.getElementById('initialActionButtons').classList.add('hidden');
    document.getElementById('dateFormatValidationSection').classList.add('hidden');
    document.getElementById('editingBadge').classList.add('hidden');
    
    // Reset Buttons
    document.getElementById('startValidationButton').classList.remove('hidden');
    document.getElementById('updateTemplateButton').classList.add('hidden');
    document.getElementById('saveTemplateFinalButton').classList.add('hidden');
    document.getElementById('updateTemplateFinalButton').classList.add('hidden');
    document.getElementById('validateFormatButton').classList.remove('hidden');
    
    // Clear dynamic content
    document.getElementById('templateNamePreview').textContent = '';
    document.getElementById('mappingError').classList.add('hidden');
    document.getElementById('formatValidationError').classList.add('hidden');

    // Clear and reset dropdowns
    renderMappingSection();
    
    // Reset the initial extract button's error display
    document.getElementById('templateFileError').classList.add('hidden');
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    showMessage('Form Reset', 'The form has been cleared and reset.', 'info');
}

// Optional: Add template name preview functionality
function addTemplateNamePreview() {
    const vendorDetailDropdown = document.getElementById('vendor_detail_col');
    const templateNameInput = document.getElementById('template_name');

    // Add listeners to update the template name input based on the Vendor column value
    const updatePreview = () => {
        if (isEditing) return; // Don't auto-update name if editing

        const vendorHeaderName = vendorDetailDropdown.value.trim();
        let previewName = 'Unnamed Template';
        
        if (vendorHeaderName && sampleValues[vendorHeaderName]) {
            // Use the sample value from the second row for a better default name
            previewName = `${sampleValues[vendorHeaderName]} Template`;
        } else if (vendorHeaderName) {
            previewName = `${vendorHeaderName} Template`;
        }
        
        // Set the default template name suggestion
        templateNameInput.value = previewName;
        
        // Update a preview element
        const previewElement = document.getElementById('templateNamePreview');
        if (previewElement) {
            previewElement.textContent = `Suggested name based on mapped vendor value: ${previewName}`;
        }
    };

    if (vendorDetailDropdown) {
        vendorDetailDropdown.addEventListener('change', updatePreview);
    }
    
    // Also update on file extraction success
    window.updateTemplateNamePreview = updatePreview;
}

function updateTemplateNamePreview() {
    if (isEditing) return;

    const vendorHeaderName = document.getElementById('vendor_detail_col').value.trim();
    const templateNameInput = document.getElementById('template_name');
    let previewName = 'Unnamed Template';
    
    if (vendorHeaderName && sampleValues[vendorHeaderName]) {
        previewName = `${sampleValues[vendorHeaderName]} Template`;
    } else if (vendorHeaderName) {
        previewName = `${vendorHeaderName} Template`;
    }
    
    // Set the default template name suggestion
    templateNameInput.value = previewName;
    
    // Update a preview element
    const previewElement = document.getElementById('templateNamePreview');
    if (previewElement) {
        previewElement.textContent = `Suggested name based on mapped vendor value: ${previewName}`;
    }
}

// --- Fetch and Display Saved Templates ---

async function fetchSavedTemplates() {
    const container = document.getElementById('savedTemplatesList');
    container.innerHTML = '<p class="text-gray-500 text-center py-4">Loading templates...</p>';

    try {
        const response = await fetch('/api/template/get-templates');
        const result = await response.json();

        if (response.ok && result.success) {
            renderSavedTemplates(result.templates);
        } else {
            container.innerHTML = '<p class="text-red-500 text-center py-4">Failed to load templates.</p>';
        }
    } catch (error) {
        console.error('Fetch templates error:', error);
        container.innerHTML = '<p class="text-red-500 text-center py-4">Network error loading templates.</p>';
    }
}

function renderSavedTemplates(templates) {
    const container = document.getElementById('savedTemplatesList');
    
    if (!templates || templates.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-4">No saved templates found.</p>';
        return;
    }

    container.innerHTML = ''; // Clear loading

    templates.forEach(template => {
        const item = document.createElement('div');
        item.className = 'flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50 p-4 rounded-lg border border-gray-200 hover:shadow-md transition';
        
        item.innerHTML = `
            <div>
                <h3 class="font-bold text-gray-800 text-lg">${template.template_name}</h3>
                <p class="text-xs text-gray-500">ID: ${template.id} | Vendor Col: ${template.vendor_detail_col}</p>
            </div>
            <div class="mt-3 sm:mt-0 flex space-x-2">
                <button class="edit-btn bg-blue-100 text-blue-700 hover:bg-blue-200 px-3 py-1 rounded text-sm font-medium transition" data-id="${template.id}">
                    <i class="fas fa-edit mr-1"></i> Edit
                </button>
                <button class="delete-btn bg-red-100 text-red-700 hover:bg-red-200 px-3 py-1 rounded text-sm font-medium transition" data-id="${template.id}">
                    <i class="fas fa-trash-alt mr-1"></i> Delete
                </button>
            </div>
        `;
        
        container.appendChild(item);
    });

    // Add event listeners
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => deleteTemplate(e.target.closest('button').dataset.id));
    });

    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => loadTemplateForEdit(e.target.closest('button').dataset.id));
    });
}

async function deleteTemplate(id) {
    if (!confirm('Are you sure you want to delete this template? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/template/delete-template/${id}`, {
            method: 'DELETE'
        });
        const result = await response.json();

        if (response.ok && result.success) {
            showMessage('Deleted', 'Template deleted successfully.', 'success');
            fetchSavedTemplates();
            // If deleting the currently editing template, reset form
            if (isEditing && document.getElementById('editing_template_id').value == id) {
                resetForm();
            }
        } else {
            showMessage('Error', result.error || 'Failed to delete template.', 'error');
        }
    } catch (error) {
        console.error('Delete error:', error);
        showMessage('Error', 'Network error while deleting template.', 'error');
    }
}

async function loadTemplateForEdit(id) {
    try {
        const response = await fetch(`/api/template/get-template/${id}`);
        const result = await response.json();

        if (response.ok && result.success) {
            const template = result.template;
            
            // Set edit mode
            isEditing = true;
            window.currentTemplate = template; // Store for format retrieval
            document.getElementById('editing_template_id').value = template.id;
            document.getElementById('editingBadge').classList.remove('hidden');
            
            // Populate basic fields
            document.getElementById('template_name').value = template.template_name;
            
            // Show necessary sections (even without file upload)
            document.getElementById('templateNamingSection').classList.remove('hidden');
            document.getElementById('mappingSection').classList.remove('hidden');
            document.getElementById('initialActionButtons').classList.remove('hidden');
            document.getElementById('dateFormatValidationSection').classList.add('hidden'); // Hide until validation
            
            // Hide extract button error
            document.getElementById('templateFileError').classList.add('hidden');

            // Switch buttons
            document.getElementById('startValidationButton').classList.add('hidden');
            document.getElementById('updateTemplateButton').classList.remove('hidden');

            // Populate dropdowns with *current values* as options (since we don't have the file anymore)
            // Ideally, we'd have the headers, but we don't store raw headers separate from mapping.
            // We'll create options based on the mapped values so they show up.
            
            // Collect all unique mapped values
            const mappedValues = new Set();
            REQUIRED_FIELDS.forEach(field => {
                if (template[field.id]) mappedValues.add(template[field.id]);
            });
            
            // Update dropdowns with these values
            updateDropdowns(Array.from(mappedValues));
            
            // Set selected values
            REQUIRED_FIELDS.forEach(field => {
                const select = document.getElementById(field.id);
                if (select && template[field.id]) {
                    select.value = template[field.id];
                }
            });

            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            showMessage('Edit Mode', `Editing template: ${template.template_name}. NOTE: Since the original file is not stored, dropdowns only show previously mapped columns. Upload a file to see all columns.`, 'info');

        } else {
            showMessage('Error', 'Failed to load template details.', 'error');
        }
    } catch (error) {
        console.error('Load edit error:', error);
        showMessage('Error', 'Network error loading template.', 'error');
    }
}