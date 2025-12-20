// templateRoutes.js - Updated with single importTemplate table and string data types
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const requireAuth = require('../middleware/auth'); 
const util = require('util'); // For promisifying db.query

const router = express.Router();

// Promisify db.query for use with async/await
const query = util.promisify(db.query).bind(db);

// Define REQUIRED_FIELDS in backend to match frontend
const REQUIRED_FIELDS = [
    { id: 'vendor_detail_col', label: 'Vendor Details Column', required: true },
    { id: 'invoice_no_col', label: 'Invoice No Column', required: false },
    { id: 'invoice_date_col', label: 'Invoice Date Column', required: false },
    { id: 'item_name_col', label: 'Item Name Column', required: true },
    { id: 'item_desc_col', label: 'Item Description Column', required: false },
    { id: 'manufacturer_col', label: 'Manufacturer Column', required: false },
    { id: 'batch_number_col', label: 'Batch Number Column', required: false },
    { id: 'hsn_code_col', label: 'HSN Code Column', required: false },
    { id: 'quantity_col', label: 'Quantity Column', required: true },
    { id: 'free_col', label: 'Free Column', required: false },
    { id: 'rate_col', label: 'Rate Column', required: true },
    { id: 'mrp_col', label: 'MRP Column', required: true },
    { id: 'packing_col', label: 'Packing (Unit Dose Count)', required: false }, // CHANGED
    { id: 'expiry_date_col', label: 'Expiry Date Column', required: false },
];

// --- Multer setup for file uploads (FIXED to preserve extension) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Destination directory: server/uploads/
        const dest = path.join(__dirname, '..', 'uploads/');
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        // Use a unique suffix and append the original file extension
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        // The saved file path will now include the extension (e.g., 'template_file-1234567.csv')
        cb(null, file.fieldname + '-' + uniqueSuffix + fileExtension);
    }
});
const upload = multer({ storage: storage });


const { PythonShell } = require('python-shell');

// --- Route for file upload and header extraction ---
router.post('/extract-headers', [requireAuth, upload.single('template_file')], (req, res) => {
    // 1. Check if file was uploaded successfully
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded or file upload failed.' });
    }

    const tempFilePath = req.file.path;
    const pythonScriptPath = path.resolve(__dirname, '..', 'python-services', 'extract_headers.py');

    // Configure python-shell options
    let options = {
        mode: 'text',
        pythonPath: 'python', // Default to 'python'. Docker container will use its PATH.
        pythonOptions: ['-u'], // get print results in real-time
        scriptPath: path.dirname(pythonScriptPath),
        args: [tempFilePath]
    };
    
    // Adjust pythonPath for Linux/Docker if needed, though usually 'python' or 'python3' works if in PATH.
    // In many Docker images, 'python' is aliased to python3. 
    // If strict 'python3' is needed on Linux:
    if (process.platform === 'linux') {
        options.pythonPath = 'python3';
    }

    // Run the Python script
    PythonShell.run('extract_headers.py', options).then(messages => {
        // Cleanup file
        fs.unlink(tempFilePath, (err) => {
            if (err) console.error('Error deleting uploaded file:', err);
        });
        
        // messages is an array of strings (stdout lines)
        // We expect the last line to be our JSON result, or the whole output joined if printed as one block.
        // Our script prints one JSON block.
        try {
            const resultString = messages.join(''); 
            const result = JSON.parse(resultString);
            
            if (result.success) {
                res.json({
                    success: true,
                    headers: result.headers,
                    sample_values: result.sample_values,
                    message: `Headers extracted successfully from ${result.file_type} file.`
                });
            } else {
                res.status(result.status || 500).json({
                    success: false,
                    error: result.error || 'Unknown error during file processing.'
                });
            }
        } catch (e) {
            console.error('Failed to parse Python output:', e, 'Raw:', messages);
            res.status(500).json({ success: false, error: 'Failed to interpret file analysis result.' });
        }
        
    }).catch(err => {
        // Cleanup file on error
        fs.unlink(tempFilePath, (unlinkErr) => {
             if (unlinkErr) console.error('Error deleting file after script failure:', unlinkErr);
        });

        console.error('Python script error:', err);
        res.status(500).json({ 
            success: false, 
            error: 'File processing failed.',
            details: err.message 
        });
    });
});


// --- NEW ROUTE: Validate Date Formats ---
router.post('/validate-date-formats', requireAuth, async (req, res) => {
    try {
        const { formats, dateColumns } = req.body;

        if (!dateColumns || dateColumns.length === 0) {
            return res.json({ success: true, message: 'No date columns to validate.' });
        }

        // Filter out date columns where the user didn't provide a format
        const dateFieldsToValidate = dateColumns.filter(c => formats[c.formatId]);

        for (const field of dateFieldsToValidate) {
            const sampleValue = field.sampleValue;
            const formatString = formats[field.formatId];

            // If sample is empty, we cannot validate the format. We trust the format for now.
            if (!sampleValue || sampleValue.trim() === 'N/A' || sampleValue.trim() === '') {
                 continue; 
            }

            // SQL: Use STR_TO_DATE(date_string, format_string). Returns NULL if parsing fails.
            const validationQuery = `
                SELECT STR_TO_DATE(?, ?) AS parsed_date
            `;
            
            const rows = await query(validationQuery, [sampleValue, formatString]);
            const parsedDate = rows[0].parsed_date;

            // If parsedDate is null, the format is incorrect for the sample value.
            if (parsedDate === null) {
                console.error(`Validation failed for sample: ${sampleValue} with format: ${formatString}`);
                return res.status(400).json({
                    success: false,
                    error_field: field.formatId, // ID of the failing input
                    message: `Format '${formatString}' is invalid for sample date value '${sampleValue}'. Please ensure the format string matches the sample value exactly (e.g., %d/%m/%Y for 23/12/2023).`
                });
            }
            
            // If the parsed date is a valid date string (not just '0000-00-00')
            // This is a basic check to prevent formats that partially match but result in the zero date.
            if (parsedDate && parsedDate.toISOString().startsWith('0000-00-00')) {
                return res.status(400).json({
                    success: false,
                    error_field: field.formatId, 
                    message: `Format '${formatString}' resulted in a zero date for sample value '${sampleValue}'. Please check your format specifiers.`
                });
            }
        }

        // If all validations pass
        return res.json({ 
            success: true, 
            message: 'All date formats are valid.',
            validated_fields: dateFieldsToValidate.map(f => f.formatId)
        });

    } catch (error) {
        console.error('Error in validate-date-formats:', error);
        res.status(500).json({ success: false, error: 'Server error during date format validation.' });
    }
});


// --- UPDATED ROUTE: Create Template ---
// Renamed from POST '/' to POST '/save-template'
router.post('/save-template', requireAuth, (req, res) => {
    try {
        const templateData = req.body;

        const templateName = templateData.template_name;
        if (!templateName) {
            return res.status(400).json({ success: false, error: 'Template name is required.' });
        }
        
        // Allowed columns now include packing_col instead of mfg_date_col and mfg_date_format
        const allowedColumns = [
            'template_name', 'vendor_detail_col', 'invoice_no_col', 'invoice_date_col', 
            'invoice_date_format',
            'item_name_col', 'item_desc_col', 'manufacturer_col', 'batch_number_col', 
            'hsn_code_col', 'quantity_col', 'free_col', 'rate_col', 'mrp_col', 
            'packing_col', // CHANGED: Replaced mfg_date_col and mfg_date_format
            'expiry_date_col',
            'expiry_date_format'
        ];

        let columns = [];
        let values = [];
        
        // Dynamically build the query based on fields present in the request body
        allowedColumns.forEach(col => {
            // Use the value from the body, defaulting to NULL if not provided or explicitly null
            // For strings, trim and treat empty string as NULL for database consistency
            const rawValue = templateData[col];
            const value = rawValue !== undefined ? (typeof rawValue === 'string' ? (rawValue.trim() || null) : rawValue) : null;
            
            // Collect the column and its value
            columns.push(col);
            values.push(value);
        });

        const placeholders = columns.map(() => '?').join(', ');
        const columnNames = columns.join(', ');

        const insertQuery = `INSERT INTO importTemplate (${columnNames}) VALUES (${placeholders})`;

        db.query(insertQuery, values, (err, result) => {
            if (err) {
                // Check for duplicate template name error (ER_DUP_ENTRY)
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ success: false, error: `Template name '${templateName}' already exists. Please choose a different name.` });
                }
                console.error('Error saving template:', err);
                return res.status(500).json({ success: false, error: 'Database error saving template.' });
            }

            res.status(201).json({ 
                success: true, 
                message: 'Template saved successfully!',
                templateId: result.insertId,
                templateName: templateName
            });
        });

    } catch (error) {
        console.error('Error in save-template route:', error);
        res.status(500).json({ success: false, error: 'Server error saving template.' });
    }
});

// Update template
router.put('/update-template/:id', requireAuth, (req, res) => {
    try {
        const templateId = req.params.id;
        const templateData = req.body;

        const allowedColumns = [
            'template_name', 'vendor_detail_col', 'invoice_no_col', 'invoice_date_col', 
            'invoice_date_format',
            'item_name_col', 'item_desc_col', 'manufacturer_col', 'batch_number_col', 
            'hsn_code_col', 'quantity_col', 'free_col', 'rate_col', 'mrp_col', 
            'packing_col',
            'expiry_date_col',
            'expiry_date_format'
        ];

        let updates = [];
        let values = [];

        allowedColumns.forEach(col => {
            const rawValue = templateData[col];
            // Only update fields that are explicitly provided in the request
            if (rawValue !== undefined) {
                const value = typeof rawValue === 'string' ? (rawValue.trim() || null) : rawValue;
                updates.push(`${col} = ?`);
                values.push(value);
            }
        });

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update.' });
        }

        values.push(templateId);
        const updateQuery = `UPDATE importTemplate SET ${updates.join(', ')} WHERE id = ?`;

        db.query(updateQuery, values, (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ success: false, error: 'Template name already exists.' });
                }
                console.error('Error updating template:', err);
                return res.status(500).json({ success: false, error: 'Database error updating template.' });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, error: 'Template not found.' });
            }

            res.json({ success: true, message: 'Template updated successfully.' });
        });

    } catch (error) {
        console.error('Error in update-template route:', error);
        res.status(500).json({ success: false, error: 'Server error updating template.' });
    }
});

// Delete template
router.delete('/delete-template/:id', requireAuth, (req, res) => {
    try {
        const templateId = req.params.id;
        const deleteQuery = 'DELETE FROM importTemplate WHERE id = ?';

        db.query(deleteQuery, [templateId], (err, result) => {
            if (err) {
                console.error('Error deleting template:', err);
                return res.status(500).json({ success: false, error: 'Database error deleting template.' });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, error: 'Template not found.' });
            }

            res.json({ success: true, message: 'Template deleted successfully.' });
        });

    } catch (error) {
        console.error('Error in delete-template route:', error);
        res.status(500).json({ success: false, error: 'Server error deleting template.' });
    }
});


// --- Other Routes (unchanged) ---


// Route to get all templates WITH ALL COLUMNS
router.get('/get-templates', requireAuth, async (req, res) => {
    try {
        // Select ALL columns including column mappings
        const query = 'SELECT * FROM importTemplate ORDER BY id DESC';
        
        db.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching templates:', err);
                return res.status(500).json({ success: false, error: 'Database error fetching templates' });
            }
            
            res.json({ 
                success: true, 
                templates: results 
            });
        });
    } catch (error) {
        console.error('Error in get-templates:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error fetching templates' 
        });
    }
});

// Route to get a single template by ID
// Route to get a single template by ID
router.get('/get-template/:id', requireAuth, async (req, res) => {
    try {
        const templateId = req.params.id;
        const query = 'SELECT * FROM importTemplate WHERE id = ?';
        
        db.query(query, [templateId], (err, results) => {
            if (err) {
                console.error('Error fetching template:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Database error fetching template' 
                });
            }
            
            if (results.length === 0) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Template not found' 
                });
            }
            
            res.json({ 
                success: true, 
                template: results[0] 
            });
        });
    } catch (error) {
        console.error('Error in get-template:', error);
        res.status(500).json({ success: false, error: 'Server error fetching template' });
    }
});


module.exports = router;