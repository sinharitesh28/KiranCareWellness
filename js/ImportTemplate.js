// ImportTemplate.js - Updated with date format validation workflow
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

// --- Utility Functions (showMessage) ---

function showMessage(title, message, type = 'info') {
    // Determine color classes based on message type
    let bgColor, borderColor;
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
});

function initializeEventListeners() {
    document.getElementById('extractHeadersButton').addEventListener('click', handleFileExtraction);
    document.getElementById('templateForm').addEventListener('submit', (e) => e.preventDefault()); // Prevent default submit on form
    
    // New validation workflow buttons
    document.getElementById('startValidationButton').addEventListener('click', startDateFormatValidation);
    document.getElementById('validateFormatButton').addEventListener('click', validateDateFormats);
    document.getElementById('saveTemplateFinalButton').addEventListener('click', saveTemplate);
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
            
            // Update template name preview based on the new sample values
            updateTemplateNamePreview(); 
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
    const finalSaveButton = document.getElementById('saveTemplateFinalButton');
    const validationError = document.getElementById('formatValidationError');
    const validateButton = document.getElementById('validateFormatButton');

    // Reset visibility and state
    validationError.classList.add('hidden');
    finalSaveButton.classList.add('hidden');
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

    // 3. If no date fields are mapped, skip this step and proceed to final save
    if (dateColumnsToValidate.length === 0) {
        showMessage('Template Ready', 'No date fields mapped. Saving template...', 'info');
        saveTemplate(); 
        return;
    }

    // 4. Generate dynamic inputs and show section
    generateDateFieldInputs(dateColumnsToValidate, dateFieldsContainer);

    // Hide initial save button, show validation section
    startButton.classList.add('hidden');
    formatSection.classList.remove('hidden');
    
    // Scroll to the validation section
    formatSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function generateDateFieldInputs(fields, containerElement) {
    fields.forEach(field => {
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
                               value="" placeholder="e.g., %d/%m/%Y" 
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
    const validateButton = document.getElementById('validateFormatButton');
    
    // Reset state
    validationError.classList.add('hidden');
    finalSaveButton.classList.add('hidden');
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
            showMessage('Validation Success', 'All date formats are valid! Click "Confirm & Save Template" to finalize.', 'success');
            validateButton.classList.add('hidden');
            finalSaveButton.classList.remove('hidden');
            
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
        if (finalSaveButton.classList.contains('hidden')) {
             validateButton.classList.remove('hidden');
        }
    }
}

// Final template saving function (called after successful date validation)
async function saveTemplate() {

// Clean up finalTemplateData - ensure all string values are trimmed
Object.keys(finalTemplateData).forEach(key => {
    if (typeof finalTemplateData[key] === 'string') {
        finalTemplateData[key] = finalTemplateData[key].trim();
    }
});

// Ensure finalTemplateData is populated (should be from startDateFormatValidation and validateDateFormats)
if (Object.keys(finalTemplateData).length === 0) {
    showMessage('Error', 'Template data missing. Please map headers and re-run validation.', 'error');
    return;
}
    const startButton = document.getElementById('startValidationButton');
    const finalSaveButton = document.getElementById('saveTemplateFinalButton');
    const validationSection = document.getElementById('dateFormatValidationSection');
    const validationError = document.getElementById('formatValidationError');

    finalSaveButton.disabled = true;
    finalSaveButton.textContent = 'Saving...';
    validationError.classList.add('hidden');


    try {
        // Use the combined data (form data + validated formats)
        const response = await fetch('/api/template/save-template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalTemplateData) // Send the full payload with formats
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showMessage('Success', `Template "${result.templateName}" saved successfully!`, 'success');
            
            // Cleanup UI
            document.getElementById('templateForm').reset();
            resetForm(); 
            // Hide the validation section and show the start button
            validationSection.classList.add('hidden');
            startButton.classList.remove('hidden');

        } else {
            validationError.textContent = result.error || 'Failed to save template. Check server logs.';
            validationError.classList.remove('hidden');
            showMessage('Save Error', validationError.textContent, 'error');
        }

    } catch (error) {
        console.error('Save fetch error:', error);
        showMessage('Network Error', 'A network error occurred while saving the template.', 'error');
    } finally {
        finalSaveButton.disabled = false;
        finalSaveButton.textContent = 'Confirm & Save Template';
    }
}


// --- Reset and Preview (modified resetForm to hide the validation section) ---

// Resets the form and hides dynamic sections
function resetForm() {
    globalHeaders = [];
    sampleValues = {};
    finalTemplateData = {};
    dateColumnsToValidate = [];
    
    // Hide sections
    document.getElementById('mappingSection').classList.add('hidden');
    document.getElementById('templateNamingSection').classList.add('hidden');
    document.getElementById('initialActionButtons').classList.add('hidden');
    document.getElementById('dateFormatValidationSection').classList.add('hidden');
    
    // Clear dynamic content
    document.getElementById('templateNamePreview').textContent = '';
    document.getElementById('mappingError').classList.add('hidden');
    document.getElementById('formatValidationError').classList.add('hidden');

    // Clear and reset dropdowns
    renderMappingSection();
    
    // Reset the initial extract button's error display
    document.getElementById('templateFileError').classList.add('hidden');

    showMessage('Form Reset', 'The form has been cleared and reset.', 'info');
}

// Optional: Add template name preview functionality
function addTemplateNamePreview() {
    const vendorDetailDropdown = document.getElementById('vendor_detail_col');
    const templateNameInput = document.getElementById('template_name');

    // Add listeners to update the template name input based on the Vendor column value
    const updatePreview = () => {
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
    } else {
        console.log('Template name preview:', previewName);
    }
}

// Initialize template name preview when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    addTemplateNamePreview();
});
