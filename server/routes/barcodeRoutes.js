// server/routes/barcodeRoutes.js
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// Generate barcode for existing stock
router.post('/generate-for-stock', requireAuth, async (req, res) => {
    const { stockDetailId } = req.body;
    const userId = req.session.code;

    if (!stockDetailId) {
        return res.status(400).json({ success: false, error: 'Stock detail ID is required.' });
    }

    const getStockSql = `
        SELECT isd.*, ism.template_id 
        FROM import_stock_detail isd
        JOIN import_stock_master ism ON isd.master_id = ism.id
        WHERE isd.id = ?
    `;

    try {
        const [results] = await db.promise().query(getStockSql, [stockDetailId]);

        if (results.length === 0) {
            return res.status(404).json({ success: false, error: 'Stock item not found.' });
        }

        const stock = results[0];
        
        const generateBarcode = (templateId, itemName, batchNumber, expiryDate) => {
            const timestamp = Date.now().toString(36).slice(-6);
            const random = Math.random().toString(36).substring(2, 5);
            const itemCode = itemName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'A');
            const batchCode = batchNumber ? batchNumber.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '0') : '000';
            return `T${templateId}-${itemCode}-${batchCode}-${timestamp}${random}`.toUpperCase();
        };

        const newBarcode = generateBarcode(
            stock.template_id,
            stock.item_name,
            stock.batch_number,
            stock.expiry_date
        );

        const updateSql = 'UPDATE import_stock_detail SET barcode = ?, barcode_printed = FALSE WHERE id = ?';
        
        await db.promise().query(updateSql, [newBarcode, stockDetailId]);

        res.json({
            success: true,
            barcode: newBarcode,
            message: 'Barcode generated successfully.'
        });

    } catch (error) {
        console.error('Error generating barcode:', error);
        res.status(500).json({ success: false, error: 'Database error.' });
    }
});

// Print barcode (log the print event)
router.post('/log-print', requireAuth, async (req, res) => {
    const { stockDetailIds, printReason } = req.body;
    const userId = req.session.code;

    if (!stockDetailIds || !Array.isArray(stockDetailIds) || stockDetailIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Stock detail IDs are required.' });
    }

    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const updateSql = 'UPDATE import_stock_detail SET barcode_printed = TRUE WHERE id IN (?)';
        // Note: mysql2 handles array parameters for IN clause correctly
        await connection.query(updateSql, [stockDetailIds]);

        const logValues = stockDetailIds.map(id => [id, userId, printReason || 'reprint', 1]);
        const logSql = 'INSERT INTO barcode_print_log (stock_detail_id, printed_by_user_id, print_reason, print_count) VALUES ?';
        
        await connection.query(logSql, [logValues]);

        await connection.commit();

        res.json({
            success: true,
            message: `Barcodes printed successfully for ${stockDetailIds.length} items.`
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error logging print event:', error);
        res.status(500).json({ success: false, error: 'Failed to log print event: ' + error.message });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// Get stock items for barcode printing
router.get('/stock-items', requireAuth, async (req, res) => {
    const { search, batch, location, printed } = req.query;
    
    let sql = `
        SELECT 
            isd.id,
            isd.item_name,
            isd.batch_number,
            isd.expiry_date,
            isd.quantity,
            isd.location,
            isd.barcode,
            isd.barcode_printed,
            ism.vendor_name,
            ism.import_date
        FROM import_stock_detail isd
        JOIN import_stock_master ism ON isd.master_id = ism.id
        WHERE 1=1
    `;
    
    const params = [];

    if (search) {
        sql += ' AND (isd.item_name LIKE ? OR isd.barcode LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }

    if (batch) {
        sql += ' AND isd.batch_number LIKE ?';
        params.push(`%${batch}%`);
    }

    if (location) {
        sql += ' AND isd.location LIKE ?';
        params.push(`%${location}%`);
    }

    if (printed === 'true') {
        sql += ' AND isd.barcode_printed = TRUE';
    } else if (printed === 'false') {
        sql += ' AND isd.barcode_printed = FALSE';
    }

    sql += ' ORDER BY isd.id DESC LIMIT 100';

    try {
        const [results] = await db.promise().query(sql, params);
        res.json({
            success: true,
            items: results,
            total: results.length
        });
    } catch (error) {
        console.error('Error fetching stock items:', error);
        res.status(500).json({ success: false, error: 'Database error fetching stock items.' });
    }
});

router.get('/search-by-barcode', requireAuth, async (req, res) => {
    const { barcode } = req.query;
    
    if (!barcode) {
        return res.status(400).json({ success: false, error: 'Barcode is required' });
    }

    const sql = `
        SELECT 
            id, item_name, item_desc, mrp, 
            COALESCE(rate, mrp) as rate, 
            quantity, location, barcode,
            batch_number, expiry_date, manufacturer
        FROM import_stock_detail 
        WHERE barcode = ? AND quantity > 0
        LIMIT 1
    `;

    try {
        const [results] = await db.promise().query(sql, [barcode]);

        if (results.length > 0) {
            res.json({ 
                success: true, 
                medicine: results[0],
                found: true 
            });
        } else {
            res.json({ 
                success: true, 
                medicine: null,
                found: false,
                message: 'No medicine found with this barcode'
            });
        }
    } catch (error) {
        console.error('Database error searching by barcode:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});


router.get('/last-imports', requireAuth, async (req, res) => {
    const sql = `
        SELECT 
            ism.id,
            ism.vendor_name,
            ism.invoice_no,
            ism.import_date,
            COUNT(isd.id) as item_count
        FROM import_stock_master ism
        LEFT JOIN import_stock_detail isd ON ism.id = isd.master_id
        GROUP BY ism.id, ism.vendor_name, ism.invoice_no, ism.import_date
        ORDER BY ism.import_date DESC
        LIMIT 20
    `;

    try {
        const [results] = await db.promise().query(sql);
        res.json({
            success: true,
            imports: results
        });
    } catch (error) {
        console.error('Error fetching last imports:', error);
        res.status(500).json({ success: false, error: 'Database error fetching last imports.' });
    }
});

module.exports = router;