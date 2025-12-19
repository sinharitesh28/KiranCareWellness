// templateRoutes.js - Updated with single importTemplate table and string data types
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
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
        cb(null, path.join(__dirname, '..', 'uploads/'));
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


// --- Route for file upload and header extraction ---
// NOTE: We combine requireAuth and upload.single() in the array of middleware.
router.post('/extract-headers', [requireAuth, upload.single('template_file')], (req, res) => {
    // 1. Check if file was uploaded successfully by Multer/Auth
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded or file upload failed.' });
    }

    // Get the temporary path where Multer stored the file. This now includes the extension.
    const tempFilePath = req.file.path;
    
    // --- CRITICAL PATH FIX: Use absolute path with OS separators and enable shell execution ---
    // 1. Get the absolute path for the Python script.
    // CORRECTED: Changed 'python' to 'python-services' based on the actual file structure.
    const pythonScriptPath = path.resolve(__dirname, '..', 'python-services', 'extract_headers.py');
    
    // The tempFilePath from Multer is already using the correct OS separators and now has the extension.
    const filePath = tempFilePath;

    // Log the paths being used to stderr for debugging
    console.error(`Attempting to run Python script at: ${pythonScriptPath}`);
    console.error(`Processing file path: ${filePath}`);


    // 2. Spawn the Python child process
    // CRITICAL: Adding { shell: true } forces the command to be executed via the system shell (cmd.exe on Windows),
    // which is the most reliable way to handle path resolution for executable scripts.
    const pythonProcess = spawn('python', [pythonScriptPath, filePath], { shell: true });

    let pythonOutput = '';
    let pythonError = '';

    // Capture standard output (where Python returns JSON)
    pythonProcess.stdout.on('data', (data) => {
        pythonOutput += data.toString();
    });

    // Capture standard error (where Python writes logs/errors)
    pythonProcess.stderr.on('data', (data) => {
        pythonError += data.toString();
    });

    // 3. Handle process close
    pythonProcess.on('close', (code) => {
        // Clean up the uploaded file immediately. MUST use the original req.file.path for fs.unlink
        fs.unlink(tempFilePath, (err) => {
            if (err) console.error('Error deleting uploaded file:', err);
        });

        if (code !== 0) {
            // Log the full command and error for severe debugging
            console.error(`Python script failed with code ${code}. Command: python ${pythonScriptPath} ${filePath}. Stderr: ${pythonError}`);
            return res.status(500).json({ 
                success: false, 
                error: `File processing failed (Python code ${code}). Check server logs for details.`,
                details: pythonError.substring(0, 500) // Increase error detail for debugging
            });
        }

        try {
            // Attempt to parse the JSON output from Python
            const result = JSON.parse(pythonOutput);
            
            if (result.success) {
                // SUCCESS: Return the headers and sample values
                res.json({
                    success: true,
                    headers: result.headers,
                    sample_values: result.sample_values,
                    message: `Headers extracted successfully from ${result.file_type} file.`
                });
            } else {
                // Python script ran but returned a failure status
                res.status(result.status || 500).json({
                    success: false,
                    error: result.error || 'Unknown error during file processing.'
                });
            }
        } catch (e) {
            // JSON parsing failed, likely due to unexpected Python output
            console.error('Failed to parse Python output as JSON:', e.message, 'Raw Output:', pythonOutput);
            res.status(500).json({ 
                success: false, 
                error: 'Server error: Failed to interpret file analysis result.' 
            });
        }
    });

    // 4. Handle process spawn error (e.g., python command not found)
    pythonProcess.on('error', (err) => {
        // Clean up the uploaded file in case of spawn error
        fs.unlink(tempFilePath, (unlinkErr) => {
             if (unlinkErr) console.error('Error deleting file after spawn failure:', unlinkErr);
        });
        
        console.error('Failed to spawn python process:', err);
        // Ensure we send a response immediately to resolve the pending status
        res.status(500).json({ 
            success: false, 
            error: 'Server configuration error: Could not run file processing script (Python command not found or path error).' 
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


// --- Other Routes (unchanged) ---


// Route to get all templates WITH ALL COLUMNS
router.get('/get-templates', requireAuth, async (req, res) => {
    try {
        // Select ALL columns including column mappings
        const query = 'SELECT * FROM importTemplate';
        
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