const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const db = require('../db');
const requireAuth = require('../middleware/auth'); 

const router = express.Router();

// Configure Multer for file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = path.join(__dirname, '..', 'uploads', 'temp');
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExt = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + fileExt);
    }
});

const upload = multer({ storage: storage });

// Utility function to execute Python script
const executePythonScript = (scriptName, filePath) => {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '..', 'python-services', scriptName);
        const pythonProcess = spawn('python', [scriptPath, filePath]);
        
        let output = '';
        let errorOutput = '';

        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (errorOutput.trim().length > 0) {
                console.log(`[Python Script Log] ${scriptName}:\n${errorOutput.trim()}`);
            }

            if (code !== 0) {
                console.error(`Python script ${scriptName} exited with code ${code}. Stderr: ${errorOutput}`);
                reject({ success: false, error: `Python script execution failed.`, status: 500 });
                return;
            }
            try {
                const result = JSON.parse(output);
                resolve(result);
            } catch (e) {
                console.error(`Failed to parse Python script output: ${output}`, e);
                reject({ success: false, error: 'Invalid response from data processing service.', status: 500 });
            }
        });

        pythonProcess.on('error', (err) => {
            console.error(`Failed to start Python process: ${err}`);
            reject({ success: false, error: 'Could not run data processing script.', status: 500 });
        });
    });
};

// Function to extract numeric packing value from string
function extractPackingValue(packingString) {
    if (!packingString) return null;
    
    const str = String(packingString).trim();
    if (str === '' || str === 'N/A' || str === 'null') return null;
    
    // Method 1: Try to extract numbers using regex (matches first sequence of digits)
    const numberMatch = str.match(/\d+/);
    if (numberMatch) {
        const value = parseInt(numberMatch[0], 10);
        return isNaN(value) ? null : value;
    }
    
    // Method 2: Common packing patterns
    const patterns = {
        'strip of': (s) => parseInt(s.match(/\d+/)?.[0]) || null,
        'tablets': (s) => parseInt(s.match(/\d+/)?.[0]) || null,
        'capsules': (s) => parseInt(s.match(/\d+/)?.[0]) || null,
        'bottle of': (s) => parseInt(s.match(/\d+/)?.[0]) || null,
        'pack of': (s) => parseInt(s.match(/\d+/)?.[0]) || null,
        'box of': (s) => parseInt(s.match(/\d+/)?.[0]) || null
    };
    
    const lowerStr = str.toLowerCase();
    for (const [pattern, extractor] of Object.entries(patterns)) {
        if (lowerStr.includes(pattern)) {
            const value = extractor(str);
            if (value > 0) return value;
        }
    }
    
    // Return null if no numbers found
    return null;
}

// Function to parse date based on format
function parseDate(dateString, format) {
    if (!dateString || !format) return null;
    
    try {
        dateString = String(dateString).trim();
        if (!dateString || dateString === 'N/A' || dateString === '') return null;

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
            },
            '%Y/%m/%d': (str) => {
                const parts = str.split('/');
                if (parts.length === 3) {
                    return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                }
                return null;
            }
        };

        const parser = formatMap[format];
        if (parser) {
            return parser(dateString);
        }

        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
    } catch (error) {
        console.error('Error parsing date:', error);
        return null;
    }
}

// Function to generate unique barcode
function generateBarcode(templateId, itemName, batchNumber, expiryDate) {
    const timestamp = Date.now().toString(36).slice(-6);
    const random = Math.random().toString(36).substring(2, 5);
    const itemCode = itemName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'A');
    const batchCode = batchNumber ? batchNumber.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '0') : '000';
    
    return `T${templateId}-${itemCode}-${batchCode}-${timestamp}${random}`.toUpperCase();
}

// 1. Route to process file, extract data, and perform initial validation
router.post('/process-file', requireAuth, (req, res, next) => {
    upload.single('importFile')(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            console.error('Multer Error:', err.message);
            return res.status(400).json({ success: false, error: err.message });
        } else if (err) {
            console.error(`Multer General Error: Details: ${err.message}`);
            return res.status(400).json({ success: false, error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded. Please select a file.' });
        }

        const filePath = req.file.path;
        try {
            const result = await executePythonScript('extract_data.py', filePath);

            fs.unlink(filePath, (err) => {
                if (err) console.error('Error deleting temp file:', err);
            });

            if (result.success) {
                res.json(result);
            } else {
                res.status(result.status || 500).json(result);
            }
        } catch (error) {
            if (req.file) {
                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting temp file on exception:', err);
                });
            }
            console.error('File processing error (post-upload):', error);
            const errorMessage = error.message || error.error || 'Server error during file processing.';
            const statusCode = error.status || 500;
            res.status(statusCode).json({ success: false, error: errorMessage });
        }
    });
});

// Function to check for duplicate stocks (Promisified)
function checkDuplicateStocks(templateId, invoiceNo, stockDetails) {
    return new Promise((resolve, reject) => {
        const duplicateCheckQuery = `
            SELECT d.item_name, d.batch_number 
            FROM import_stock_detail d
            INNER JOIN import_stock_master m ON d.master_id = m.id
            WHERE m.template_id = ? 
            AND m.invoice_no = ? 
            AND d.item_name = ? 
            AND (d.batch_number = ? OR (d.batch_number IS NULL AND ? IS NULL))
        `;

        const duplicates = [];
        const uniqueItems = [];
        
        if (stockDetails.length === 0) {
            return resolve({ duplicates: [], uniqueItems: [] });
        }

        // Use Promise.all for parallel checking
        const checks = stockDetails.map(async (item, index) => {
            const batchNumber = item.batch_number || null;
            try {
                const [results] = await db.promise().query(
                    duplicateCheckQuery, 
                    [templateId, invoiceNo, item.item_name, batchNumber, batchNumber]
                );
                
                if (results.length > 0) {
                    duplicates.push({
                        item_name: item.item_name,
                        batch_number: item.batch_number,
                        originalIndex: index,
                        existingRecord: results[0]
                    });
                } else {
                    uniqueItems.push({ ...item, originalIndex: index });
                }
            } catch (err) {
                console.error('Error checking duplicate for item:', item.item_name, err);
                uniqueItems.push({ ...item, originalIndex: index });
            }
        });

        Promise.all(checks)
            .then(() => resolve({ duplicates, uniqueItems }))
            .catch(reject);
    });
}

// 2. Route for final stock import with ALL data and barcode generation
router.post('/import-stocks', requireAuth, async (req, res) => {
    const { templateId, masterData, stockDetails } = req.body;
    const userId = req.session.code;

    if (!userId) {
        console.error('Import stock failed: User ID not found in session.');
        return res.status(401).json({ success: false, error: 'Authorization required for import. Please log in again.' });
    }
    
    if (!templateId || !masterData || !stockDetails || stockDetails.length === 0) {
        return res.status(400).json({ success: false, error: 'Missing required import data (templateId, masterData, or stockDetails).' });
    }

    try {
        const [templateResults] = await db.promise().query('SELECT * FROM importTemplate WHERE id = ?', [templateId]);

        if (templateResults.length === 0) {
            return res.status(404).json({ success: false, error: 'Template not found.' });
        }

        const template = templateResults[0];

        const { duplicates, uniqueItems } = await checkDuplicateStocks(templateId, masterData.invoice_no, stockDetails);

        if (duplicates.length === stockDetails.length) {
            const duplicateNames = duplicates.map(d => 
                `${d.item_name}${d.batch_number ? ` (Batch: ${d.batch_number})` : ''}`
            ).join(', ');
            
            return res.status(400).json({
                success: false, 
                error: `All items are duplicates and already exist in the system: ${duplicateNames}. No items were imported.` 
            });
        }

        if (uniqueItems.length === 0) {
            return res.status(400).json({
                success: false, 
                error: 'No unique items to import after filtering duplicates.' 
            });
        }

        // Start Transaction
        const connection = await db.promise().getConnection();
        await connection.beginTransaction();

        try {
            const parsedMasterData = { ...masterData };
            if (template.invoice_date_format && masterData.invoice_date && masterData.invoice_date !== 'N/A') {
                parsedMasterData.invoice_date = parseDate(masterData.invoice_date, template.invoice_date_format);
            }

            // 1. Insert into import_stock_master
            const masterSql = 'INSERT INTO import_stock_master (template_id, invoice_no, invoice_date, vendor_name, imported_by_user_id) VALUES (?, ?, ?, ?, ?)';
            const masterValues = [
                templateId, 
                parsedMasterData.invoice_no, 
                parsedMasterData.invoice_date,
                parsedMasterData.vendor_name, 
                userId
            ];

            const [masterResult] = await connection.query(masterSql, masterValues);
            const masterId = masterResult.insertId;

            // 2. Prepare and insert details
            const detailSql = `INSERT INTO import_stock_detail 
                (master_id, item_name, item_desc, manufacturer, hsn_code, batch_number, expiry_date, packing, quantity, free_quantity, rate, mrp, location, barcode, barcode_printed) 
                VALUES ?`;
            
            const detailValues = uniqueItems.map((item, index) => {
                let parsedExpiryDate = item.expiry_date;
                if (template.expiry_date_format && item.expiry_date) {
                    parsedExpiryDate = parseDate(item.expiry_date, template.expiry_date_format);
                }

                const packingValue = item.packing && typeof item.packing === 'string' 
                    ? extractPackingValue(item.packing) 
                    : item.packing;

                const barcode = generateBarcode(
                    templateId,
                    item.item_name,
                    item.batch_number,
                    parsedExpiryDate
                );

                return [
                    masterId,
                    item.item_name,
                    item.item_desc || null,
                    item.manufacturer || null,
                    item.hsn_code || null,
                    item.batch_number || null,
                    parsedExpiryDate,
                    packingValue,
                    item.quantity,
                    item.free_quantity || 0,
                    item.rate,
                    item.mrp || null,
                    item.location,
                    barcode,
                    false
                ];
            });

            await connection.query(detailSql, [detailValues]);

            await connection.commit();

            let responseMessage = `Stock imported successfully! ${uniqueItems.length} item(s) added with barcodes generated.`;
            
            if (duplicates.length > 0) {
                const duplicateNames = duplicates.map(d => 
                    `${d.item_name}${d.batch_number ? ` (Batch: ${d.batch_number})` : ''}`
                ).join(', ');
                
                responseMessage += ` ${duplicates.length} duplicate item(s) were skipped: ${duplicateNames}`;
            }

            console.log(`Stock import Master ID ${masterId} successfully committed. Imported ${uniqueItems.length} items with barcodes, skipped ${duplicates.length} duplicates.`);
            
            res.json({
                success: true, 
                message: responseMessage,
                masterId: masterId,
                importedCount: uniqueItems.length,
                skippedCount: duplicates.length,
                skippedItems: duplicates.map(d => ({
                    item_name: d.item_name,
                    batch_number: d.batch_number
                }))
            });

        } catch (err) {
            await connection.rollback();
            console.error('Transaction error during import:', err);
            res.status(500).json({ success: false, error: 'Failed to import stock items. ' + err.message });
        } finally {
            connection.release();
        }

    } catch (err) {
        console.error('Import stock error:', err);
        res.status(500).json({ success: false, error: 'Internal server error during import.' });
    }
});

/**
 * Route to fetch last used locations for items
 */
router.post('/get-last-locations', requireAuth, async (req, res) => {
    const { itemNames } = req.body;

    if (!itemNames || !Array.isArray(itemNames) || itemNames.length === 0) {
        return res.status(400).json({
            success: false, 
            error: 'Item names array is required' 
        });
    }

    try {
        const locationQuery = `
            SELECT latest.item_name, d.location
            FROM (
                SELECT d2.item_name, MAX(m2.import_date) as latest_date
                FROM import_stock_detail d2
                INNER JOIN import_stock_master m2 ON d2.master_id = m2.id
                WHERE d2.item_name IN (?) 
                AND d2.location IS NOT NULL 
                AND d2.location != ''
                GROUP BY d2.item_name
            ) AS latest
            INNER JOIN import_stock_detail d ON d.item_name = latest.item_name
            INNER JOIN import_stock_master m ON d.master_id = m.id AND m.import_date = latest.latest_date
            WHERE d.location IS NOT NULL 
            AND d.location != ''
        `;

        const [results] = await db.promise().query(locationQuery, [itemNames]);

        const locations = {};
        results.forEach(row => {
            locations[row.item_name] = row.location;
        });

        res.json({
            success: true,
            locations: locations
        });
    } catch (err) {
        console.error('Error fetching last locations:', err);
        res.status(500).json({
            success: false, 
            error: 'Database error while fetching locations'
        });
    }
});

// Route to fetch stock sheet data
router.get('/stock-sheet', requireAuth, async (req, res) => {
    try {
        const stockSheetQuery = `
            SELECT 
                d.id,
                d.item_name,
                d.batch_number,
                d.expiry_date,
                d.quantity AS standard_stock,
                d.loose_quantity AS loose_stock,
                d.packing,
                d.mrp,
                d.rate,
                m.vendor_name
            FROM import_stock_detail d
            LEFT JOIN import_stock_master m ON d.master_id = m.id
            WHERE d.quantity > 0 OR d.loose_quantity > 0
            ORDER BY d.item_name ASC, d.expiry_date ASC
        `;

        const [results] = await db.promise().query(stockSheetQuery);

        // Process results to calculate value and format dates
        const processedResults = results.map(item => {
            const packing = parseInt(item.packing) || 1;
            const standardValue = item.quantity * item.rate;
            // Loose stock value is loose_quantity * (rate / packing)
            const looseValue = item.loose_quantity * (item.rate / packing);
            const totalValue = standardValue + looseValue;

            return {
                ...item,
                value: totalValue.toFixed(2), // Format as string with 2 decimals
                expiry_date: item.expiry_date ? new Date(item.expiry_date).toISOString().split('T')[0] : 'N/A'
            };
        });

        res.json({
            success: true,
            data: processedResults
        });
    } catch (err) {
        console.error('Error fetching stock sheet data:', err);
        res.status(500).json({ success: false, error: 'Database error fetching stock sheet.' });
    }
});

module.exports = router;
