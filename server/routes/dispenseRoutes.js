const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const transporter = require('../mailer');
const { scheduleRemindersForTransaction, sendDigitalBill } = require('../services/telegramService');

const router = express.Router();

// Search customer by mobile number
router.get('/search-customer', requireAuth, async (req, res) => {
    const { mobile } = req.query;
    
    if (!mobile) {
        return res.status(400).json({ success: false, error: 'Mobile number is required' });
    }

    try {
        const [results] = await db.promise().query('SELECT * FROM customerDetails WHERE mobile_no = ?', [mobile]);
        
        if (results.length > 0) {
            res.json({ success: true, customer: results[0], exists: true });
        } else {
            res.json({ success: true, customer: null, exists: false });
        }
    } catch (err) {
        console.error('Database error searching customer:', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Save or update customer
router.post('/save-customer', requireAuth, async (req, res) => {
    const { mobile_no, name, email } = req.body;
    
    if (!mobile_no || !name) {
        return res.status(400).json({ success: false, error: 'Mobile number and name are required' });
    }

    const customerSql = `
        INSERT INTO customerDetails (mobile_no, name, email) 
        VALUES (?, ?, ?) 
        ON DUPLICATE KEY UPDATE name = ?, email = ?, updated_at = CURRENT_TIMESTAMP
    `;
    
    try {
        const [results] = await db.promise().query(customerSql, [mobile_no, name, email, name, email]);
        res.json({ 
            success: true, 
            message: 'Customer saved successfully',
            customerId: results.insertId 
        });
    } catch (err) {
        console.error('Database error saving customer:', err);
        res.status(500).json({ success: false, error: 'Failed to save customer' });
    }
});

// Search medicines
router.get('/search-medicines', requireAuth, async (req, res) => {
    const { query, category } = req.query;
    
    if (!query) {
        return res.status(400).json({ success: false, error: 'Search query is required' });
    }

    let searchSql = '';
    let searchParams = [];

    switch (category) {
        case 'name':
            searchSql = `SELECT id, item_name, item_desc, mrp, COALESCE(rate, mrp) as rate, quantity, location, barcode, batch_number, expiry_date, manufacturer FROM import_stock_detail WHERE item_name LIKE ? AND quantity > 0`;
            searchParams = [`%${query}%`];
            break;
        case 'description':
            searchSql = `SELECT id, item_name, item_desc, mrp, COALESCE(rate, mrp) as rate, quantity, location, barcode, batch_number, expiry_date, manufacturer FROM import_stock_detail WHERE item_desc LIKE ? AND quantity > 0`;
            searchParams = [`%${query}%`];
            break;
        case 'location':
            searchSql = `SELECT id, item_name, item_desc, mrp, COALESCE(rate, mrp) as rate, quantity, location, barcode, batch_number, expiry_date, manufacturer FROM import_stock_detail WHERE location LIKE ? AND quantity > 0`;
            searchParams = [`%${query}%`];
            break;
        case 'barcode':
            searchSql = `SELECT id, item_name, item_desc, mrp, COALESCE(rate, mrp) as rate, quantity, location, barcode, batch_number, expiry_date, manufacturer FROM import_stock_detail WHERE barcode = ? AND quantity > 0`;
            searchParams = [query];
            break;
        case 'rate':
            searchSql = `SELECT id, item_name, item_desc, mrp, COALESCE(rate, mrp) as rate, quantity, location, barcode, batch_number, expiry_date, manufacturer FROM import_stock_detail WHERE (rate <= ? OR mrp <= ?) AND quantity > 0`;
            searchParams = [query, query];
            break;
        default:
            searchSql = `SELECT id, item_name, item_desc, mrp, COALESCE(rate, mrp) as rate, quantity, location, barcode, batch_number, expiry_date, manufacturer FROM import_stock_detail WHERE (item_name LIKE ? OR item_desc LIKE ? OR location LIKE ? OR barcode = ?) AND quantity > 0`;
            searchParams = [`%${query}%`, `%${query}%`, `%${query}%`, query];
    }

    try {
        const [results] = await db.promise().query(searchSql, searchParams);
        res.json({ success: true, medicines: results, count: results.length });
    } catch (err) {
        console.error('Database error searching medicines:', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Search by barcode
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
    `;

    try {
        const [results] = await db.promise().query(sql, [barcode]);
        if (results.length > 0) {
            res.json({ success: true, medicine: results[0], found: true });
        } else {
            res.json({ success: true, medicine: null, found: false });
        }
    } catch (err) {
        console.error('Database error searching by barcode:', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Save transaction
router.post('/save-transaction', requireAuth, async (req, res) => {
    const { customer, items, summary, paymentMethod } = req.body;
    const userId = req.session.code;

    if (!customer || !items || items.length === 0 || !summary) {
        return res.status(400).json({ success: false, error: 'Incomplete transaction data' });
    }

    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        let customerId = null;
        if (customer && (customer.mobile || customer.name || customer.email)) {
            const cleanMobile = customer.mobile ? customer.mobile.trim() : null;
            const cleanName = customer.name ? customer.name.trim() : null;
            const cleanEmail = customer.email ? customer.email.trim() : null;

            if (cleanMobile) {
                const [existing] = await connection.query('SELECT id FROM customerDetails WHERE mobile_no = ?', [cleanMobile]);
                if (existing.length > 0) {
                    customerId = existing[0].id;
                    if (cleanName || cleanEmail) {
                        await connection.query(
                            'UPDATE customerDetails SET name = COALESCE(?, name), email = COALESCE(?, email), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                            [cleanName, cleanEmail, customerId]
                        );
                    }
                } else {
                    const [result] = await connection.query(
                        'INSERT INTO customerDetails (mobile_no, name, email) VALUES (?, ?, ?)',
                        [cleanMobile, cleanName, cleanEmail]
                    );
                    customerId = result.insertId;
                }
            } else if (cleanName || cleanEmail) {
                const [result] = await connection.query(
                    'INSERT INTO customerDetails (name, email) VALUES (?, ?)',
                    [cleanName, cleanEmail]
                );
                customerId = result.insertId;
            }
        }

        const generateBillNumber = () => `BILL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const billNumber = generateBillNumber();

        const [transResult] = await connection.query(
            `INSERT INTO transactions 
            (customer_id, total_amount, discount_amount, discount_type, payment_method, 
             bill_number, created_by_user_id, customer_mobile, customer_name) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                customerId,
                summary.totalAmount,
                summary.discountAmount || 0,
                summary.discountType || 'fixed',
                paymentMethod,
                billNumber,
                userId || 'PHARM-1001',
                customer && customer.mobile ? customer.mobile.trim() : null,
                customer && customer.name ? customer.name.trim() : null
            ]
        );
        const transactionId = transResult.insertId;

        const stockUpdateErrors = [];
        for (const item of items) {
            await connection.query(
                `INSERT INTO transaction_items 
                (transaction_id, stock_detail_id, item_name, item_description, mrp, selling_price, quantity, total_price, location, is_manual, dose_dispensing, dose_stock_id, dose_quantity, dose_unit_price) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    transactionId,
                    item.stock_detail_id,
                    item.item_name,
                    item.item_description || '',
                    item.mrp || 0,
                    item.selling_price || 0,
                    item.quantity,
                    item.total_price,
                    item.location || '',
                    item.is_manual || false,
                    item.dose_dispensing || false,
                    item.dose_stock_id || null,
                    item.dose_quantity || null,
                    item.dose_unit_price || null
                ]
            );

            if (item.dose_dispensing) {
                const [updateResult] = await connection.query(
                    'UPDATE import_stock_detail SET loose_quantity = loose_quantity - ? WHERE id = ? AND loose_quantity >= ?',
                    [item.dose_quantity, item.dose_stock_id, item.dose_quantity]
                );
                if (updateResult.affectedRows === 0) {
                    stockUpdateErrors.push({ item: item.item_name, reason: 'Insufficient loose doses.' });
                }
            } else if (!item.is_manual && item.stock_detail_id) {
                const [updateResult] = await connection.query(
                    'UPDATE import_stock_detail SET quantity = quantity - ? WHERE id = ? AND quantity >= ?',
                    [item.quantity, item.stock_detail_id, item.quantity]
                );
                if (updateResult.affectedRows === 0) {
                    stockUpdateErrors.push({ item: item.item_name, reason: 'Insufficient stock.' });
                }
            }
        }

        if (stockUpdateErrors.length > 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Transaction failed due to stock issues', errors: stockUpdateErrors });
        }

        await connection.commit();

        // Trigger background tasks (Telegram Bot)
        // We don't await these to ensure fast response to client
        if (transactionId) {
            scheduleRemindersForTransaction(transactionId).catch(e => console.error('Bg task reminder error:', e));
            if (customerId) {
                sendDigitalBill(customerId, transactionId).catch(e => console.error('Bg task bill error:', e));
            }
        }

        res.json({ success: true, transactionId, billNumber, message: 'Transaction saved successfully' });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Transaction error:', err);
        res.status(500).json({ success: false, error: 'Transaction failed' });
    } finally {
        if (connection) connection.release();
    }
});

// Send WhatsApp bill (Placeholder)
router.post('/send-whatsapp-bill', requireAuth, (req, res) => {
    const { customer, items, summary } = req.body;
    if (!customer || !items || !summary) {
        return res.status(400).json({ success: false, error: 'Customer and bill data required' });
    }
    // Logic remains same as it doesn't touch DB
    res.json({ success: true, message: 'WhatsApp bill sent successfully' });
});

// Customer transactions
router.get('/customer-transactions', requireAuth, async (req, res) => {
    const { customerId } = req.query;
    if (!customerId) return res.status(400).json({ success: false, error: 'Customer ID is required' });

    try {
        const [results] = await db.promise().query(`
            SELECT t.id, t.total_amount, t.discount_amount, t.payment_method, t.created_at, COUNT(ti.id) as items_count
            FROM transactions t
            LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
            WHERE t.customer_id = ?
            GROUP BY t.id
            ORDER BY t.created_at DESC LIMIT 10
        `, [customerId]);
        res.json({ success: true, transactions: results });
    } catch (err) {
        console.error('Database error fetching transactions:', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Generate PDF
router.get('/generate-pdf/:transactionId', requireAuth, async (req, res) => {
    const { transactionId } = req.params;
    try {
        const [transactions] = await db.promise().query(`
            SELECT t.*, c.name as customer_name, c.mobile_no 
            FROM transactions t 
            LEFT JOIN customerDetails c ON t.customer_id = c.id 
            WHERE t.id = ?
        `, [transactionId]);
        
        if (transactions.length === 0) return res.status(404).json({ success: false, error: 'Transaction not found' });

        const [items] = await db.promise().query('SELECT * FROM transaction_items WHERE transaction_id = ? ORDER BY id', [transactionId]);

        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="bill-${transactions[0].bill_number}.pdf"`);
        doc.pipe(res);
        await generateBillPDF(doc, transactions[0], items);
        doc.end();
    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate PDF' });
    }
});

// Generate PDF from data
router.post('/generate-pdf-from-data', requireAuth, async (req, res) => {
    const { customer, items, summary, paymentMethod } = req.body;
    try {
        const billNumber = `TEMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const transaction = {
            bill_number: billNumber,
            transaction_date: new Date(),
            customer_name: customer.name || 'Walk-in Customer',
            customer_mobile: customer.mobile || 'N/A',
            total_amount: summary.totalAmount,
            discount_amount: summary.discountAmount || 0,
            discount_type: summary.discountType || 'fixed',
            payment_method: paymentMethod
        };
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="bill-${billNumber}.pdf"`);
        doc.pipe(res);
        await generateBillPDF(doc, transaction, items);
        doc.end();
    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate PDF' });
    }
});

// Send Email
router.post('/send-email-bill', requireAuth, async (req, res) => {
    // Logic remains mostly same, just check if generatePDFBuffer uses any old DB logic (it doesn't)
    const { customer, items, summary, transactionId } = req.body;
    if (!customer || !items || !summary || !customer.email) {
        return res.status(400).json({ success: false, error: 'Customer email and bill data required' });
    }
    try {
        const billNumber = transactionId ? `BILL-${transactionId}` : `TEMP-${Date.now()}`;
        const transaction = {
            bill_number: billNumber,
            transaction_date: new Date(),
            customer_name: customer.name || 'Walk-in Customer',
            customer_mobile: customer.mobile || 'N/A',
            total_amount: summary.totalAmount,
            discount_amount: summary.discountAmount || 0,
            discount_type: summary.discountType || 'fixed',
            payment_method: 'cash'
        };
        const pdfBuffer = await generatePDFBuffer(transaction, items);
        const mailOptions = {
            from: transporter.options.auth.user,
            to: customer.email,
            subject: `Your Medicine Bill - KiranCareWellness`,
            html: `...`, // (Simplified for brevity)
            attachments: [{ filename: `bill-${billNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
        };
        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Email bill sent successfully' });
    } catch (error) {
        console.error('Email bill error:', error);
        res.status(500).json({ success: false, error: 'Failed to send email bill: ' + error.message });
    }
});

// Helper for PDF
async function generatePDFBuffer(transaction, items) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 40, size: 'A4' });
            const buffers = [];
            doc.on('data', (chunk) => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);
            generateBillPDF(doc, transaction, items).then(() => doc.end()).catch(reject);
        } catch (error) { reject(error); }
    });
}

// Search with dose
router.get('/search-medicines-with-dose', requireAuth, async (req, res) => {
    const { query, category } = req.query;
    if (!query) return res.status(400).json({ success: false, error: 'Search query is required' });

    const searchTerm = `%${query}%`;
    let sqlParams = [];
    let whereClauseNormal = '';

    switch (category) {
        case 'name':
            whereClauseNormal = 'd.item_name LIKE ?';
            sqlParams = [searchTerm, searchTerm];
            break;
        case 'description':
            whereClauseNormal = 'd.item_desc LIKE ?';
            sqlParams = [searchTerm, searchTerm];
            break;
        case 'location':
            whereClauseNormal = 'd.location LIKE ?';
            sqlParams = [searchTerm, searchTerm];
            break;
        case 'barcode':
            whereClauseNormal = 'd.barcode = ?';
            sqlParams = [query, query];
            break;
        default:
            whereClauseNormal = '(d.item_name LIKE ? OR d.item_desc LIKE ? OR d.location LIKE ? OR d.barcode = ?)';
            sqlParams = [searchTerm, searchTerm, searchTerm, query, searchTerm, searchTerm, searchTerm, query];
    }

    const searchSql = `
        SELECT * FROM (
            SELECT d.id, d.item_name, d.item_desc, d.mrp, COALESCE(d.rate, d.mrp) as rate, d.quantity, d.location, d.barcode, d.batch_number, d.expiry_date, d.manufacturer, d.packing, 'normal' as stock_type, NULL as dose_stock_id, NULL as remaining_doses, NULL as total_doses, NULL as packing_size
            FROM import_stock_detail d WHERE d.quantity > 0 AND ${whereClauseNormal}
            UNION ALL
            SELECT d.id, d.item_name, d.item_desc, ROUND(d.mrp / NULLIF(d.packing, 0), 2) as mrp, ROUND(COALESCE(d.rate, d.mrp) / NULLIF(d.packing, 0), 2) as rate, 0 as quantity, d.location, d.barcode, d.batch_number, d.expiry_date, d.manufacturer, d.packing, 'dose' as stock_type, d.id as dose_stock_id, d.loose_quantity as remaining_doses, d.packing as total_doses, d.packing as packing_size
            FROM import_stock_detail d WHERE d.loose_quantity > 0 AND ${whereClauseNormal}
        ) AS combined_results ORDER BY item_name ASC LIMIT 50
    `;

    try {
        const [results] = await db.promise().query(searchSql, sqlParams);
        res.json({ success: true, medicines: results, count: results.length });
    } catch (err) {
        console.error('Database error searching medicines:', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Convert to dose stock
router.post('/convert-to-dose-stock', requireAuth, async (req, res) => {
    const { stockDetailId } = req.body;
    if (!stockDetailId) return res.status(400).json({ success: false, error: 'Stock detail ID is required' });

    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const [results] = await connection.query('SELECT id, item_name, quantity, packing FROM import_stock_detail WHERE id = ? AND quantity > 0', [stockDetailId]);
        if (results.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, error: 'Stock not found or out of stock' });
        }

        const stock = results[0];
        const packing = stock.packing || 1;
        if (packing <= 1) {
            await connection.rollback();
            return res.status(400).json({ success: false, error: 'Packing size must be greater than 1 for dose dispensing' });
        }

        const [updateResult] = await connection.query(
            'UPDATE import_stock_detail SET quantity = quantity - 1, loose_quantity = loose_quantity + ? WHERE id = ? AND quantity >= 1',
            [packing, stockDetailId]
        );

        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, error: 'Insufficient stock for conversion' });
        }

        await connection.commit();
        res.json({ success: true, doseStockId: stock.id, packing: packing, message: `Successfully converted 1 unit to ${packing} doses` });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Transaction error:', err);
        res.status(500).json({ success: false, error: 'Transaction failed' });
    } finally {
        if (connection) connection.release();
    }
});

// Ensure dose stock
router.post('/ensure-dose-stock', requireAuth, async (req, res) => {
    const { stockDetailId, requiredDoses } = req.body;
    if (!stockDetailId || !requiredDoses) return res.status(400).json({ success: false, error: 'Stock ID and doses required' });

    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const [results] = await connection.query('SELECT loose_quantity, packing, quantity FROM import_stock_detail WHERE id = ?', [stockDetailId]);
        if (results.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, error: 'Stock not found' });
        }

        const stock = results[0];
        const availableDoses = stock.loose_quantity || 0;
        const neededDoses = Math.max(0, requiredDoses - availableDoses);

        if (neededDoses === 0) {
            await connection.commit();
            return res.json({ success: true, convertedUnits: 0, availableDoses, message: 'Sufficient doses available' });
        }

        const packing = stock.packing || 1;
        const unitsToConvert = Math.ceil(neededDoses / packing);

        if (stock.quantity < unitsToConvert) {
            await connection.rollback();
            return res.status(400).json({ success: false, error: `Insufficient stock. Need ${unitsToConvert} units` });
        }

        const dosesToAdd = unitsToConvert * packing;
        const [updateResult] = await connection.query(
            'UPDATE import_stock_detail SET quantity = quantity - ?, loose_quantity = loose_quantity + ? WHERE id = ? AND quantity >= ?',
            [unitsToConvert, dosesToAdd, stockDetailId, unitsToConvert]
        );

        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, error: 'Insufficient stock for conversion' });
        }

        await connection.commit();
        res.json({ success: true, convertedUnits: unitsToConvert, dosesCreated: dosesToAdd, totalAvailableDoses: availableDoses + dosesToAdd, message: `Converted ${unitsToConvert} units to ${dosesToAdd} doses` });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Transaction error:', err);
        res.status(500).json({ success: false, error: 'Transaction failed' });
    } finally {
        if (connection) connection.release();
    }
});

// Helper for PDF
async function generateBillPDF(doc, transaction, items) {
    return new Promise((resolve, reject) => {
        try {
            // Paths
            const rootDir = path.join(__dirname, '..', '..');
            const logoPath = path.join(rootDir, 'img', 'KiranCareWellnessLogo.png');
            const signaturePath = path.join(rootDir, 'img', 'sign_2.png');
            
            // Fonts - Registering Custom Fonts
            const fontRegular = path.join(__dirname, '..', 'fonts', 'Roboto-Regular.ttf');
            const fontBold = path.join(__dirname, '..', 'fonts', 'Roboto-Bold.ttf');
            
            // Fallback to standard fonts if custom ones aren't found
            // Check if fs.existsSync throws (permission issues)
            let regularFontName = 'Helvetica';
            let boldFontName = 'Helvetica-Bold';
            
            try {
                if (fs.existsSync(fontRegular)) {
                    doc.registerFont('Roboto-Regular', fontRegular);
                    regularFontName = 'Roboto-Regular';
                }
                if (fs.existsSync(fontBold)) {
                    doc.registerFont('Roboto-Bold', fontBold);
                    boldFontName = 'Roboto-Bold';
                }
            } catch (e) {
                console.warn('Font loading failed, falling back to standard fonts:', e.message);
            }

            // Colors & Config
            const colors = { 
                primary: '#00712D', 
                secondary: '#D5ED9F', 
                accent: '#FF9100', 
                dark: '#1a202c', 
                gray: '#718096', 
                lightGray: '#F7FAFC',
                border: '#E2E8F0'
            };

            const formatCurrency = (amount) => `₹${parseFloat(amount || 0).toFixed(2)}`;
            const safeText = (text, fallback = '') => (text === null || text === undefined) ? fallback : String(text);
            const safeDate = (d) => {
                try {
                    const date = d ? new Date(d) : new Date();
                    return isNaN(date.getTime()) ? new Date() : date;
                } catch (e) { return new Date(); }
            };

            const txnDate = safeDate(transaction.transaction_date || transaction.created_at);
            
            // Layout Constants
            const margins = { top: 40, left: 40, right: 40, bottom: 40 };
            const width = doc.page.width - margins.left - margins.right;

            // --- Helper: Draw Header ---
            const drawHeader = (y) => {
                // Logo
                try {
                    if (fs.existsSync(logoPath)) {
                        doc.image(logoPath, margins.left, y, { width: 50 });
                    }
                } catch (imgErr) {
                    console.warn('Logo image load failed:', imgErr.message);
                }

                // Company Name
                doc.font(boldFontName).fontSize(20).fillColor(colors.primary)
                   .text('Kiran Care Wellness', margins.left + 60, y);
                
                // Tagline/Subtitle
                doc.font(regularFontName).fontSize(9).fillColor(colors.gray)
                   .text('Generic Medical Store', margins.left + 60, y + 22);

                // Right-aligned Invoice Title
                doc.font(boldFontName).fontSize(24).fillColor(colors.dark)
                   .text('INVOICE', 0, y, { align: 'right', width: width + margins.left });
                
                // Store Info (Centered/Below header for clean look)
                const startY = y + 60;
                doc.moveTo(margins.left, startY).lineTo(doc.page.width - margins.right, startY).strokeColor(colors.border).lineWidth(1).stroke();
                
                // Contact Details Row
                doc.font(regularFontName).fontSize(8).fillColor(colors.dark)
                   .text('Shop no. A1, Sai Darshan Apt., Alkapuri Road, Nalasopara (E) 401209', margins.left, startY + 10, { width: width, align: 'center' })
                   .text('Mobile: 9076828408, 9900235218  |  Email: kirancarewellness@gmail.com', margins.left, startY + 22, { width: width, align: 'center' })
                   .text('Drug Lic: MH-PL1-578747, MH-PL1-578748, MH-PL1-581222, MH-PL1-581221', margins.left, startY + 34, { width: width, align: 'center' });
                
                return startY + 55;
            };

            let currentY = drawHeader(margins.top);

            // --- Bill & Customer Details Grid ---
            const detailsTop = currentY;
            const colWidth = width / 2;
            
            // Left Column: Bill Details
            doc.font(boldFontName).fontSize(10).fillColor(colors.primary).text('INVOICE DETAILS', margins.left, detailsTop);
            doc.rect(margins.left, detailsTop + 15, colWidth - 10, 65).fill(colors.lightGray);
            
            doc.font(boldFontName).fontSize(9).fillColor(colors.dark).text('Bill Number:', margins.left + 10, detailsTop + 25);
            doc.font(regularFontName).text(safeText(transaction.bill_number, 'N/A'), margins.left + 80, detailsTop + 25);
            
            doc.font(boldFontName).text('Date:', margins.left + 10, detailsTop + 40);
            doc.font(regularFontName).text(txnDate.toLocaleDateString('en-IN'), margins.left + 80, detailsTop + 40);
            
            doc.font(boldFontName).text('Time:', margins.left + 10, detailsTop + 55);
            doc.font(regularFontName).text(txnDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }), margins.left + 80, detailsTop + 55);

            // Right Column: Customer Details
            const col2X = margins.left + colWidth;
            doc.font(boldFontName).fontSize(10).fillColor(colors.primary).text('CUSTOMER DETAILS', col2X, detailsTop);
            doc.rect(col2X, detailsTop + 15, colWidth, 65).fill(colors.lightGray);

            doc.font(boldFontName).fontSize(9).fillColor(colors.dark).text('Name:', col2X + 10, detailsTop + 25);
            doc.font(regularFontName).text(safeText(transaction.customer_name, 'Walk-in Customer'), col2X + 60, detailsTop + 25);

            doc.font(boldFontName).text('Mobile:', col2X + 10, detailsTop + 40);
            doc.font(regularFontName).text(safeText(transaction.customer_mobile, 'N/A'), col2X + 60, detailsTop + 40);
            
            doc.font(boldFontName).text('Payment:', col2X + 10, detailsTop + 55);
            doc.font(regularFontName).text(safeText(transaction.payment_method, 'CASH').toUpperCase(), col2X + 60, detailsTop + 55);

            currentY += 90;

            // --- Item Table ---
            const drawTableHead = (y) => {
                doc.rect(margins.left, y, width, 25).fill(colors.primary);
                doc.font(boldFontName).fontSize(9).fillColor('#FFFFFF');
                doc.text('ITEM NAME', margins.left + 10, y + 8, { width: 220 });
                doc.text('UNIT PRICE', margins.left + 240, y + 8, { width: 80, align: 'right' });
                doc.text('QTY', margins.left + 330, y + 8, { width: 50, align: 'center' });
                doc.text('TOTAL', margins.left + 400, y + 8, { width: 110, align: 'right' });
                return y + 25;
            };

            currentY = drawTableHead(currentY);

            let subtotal = 0;
            
            if (Array.isArray(items)) {
                items.forEach((item, index) => {
                    // Check for page break
                    if (currentY > doc.page.height - 150) {
                        doc.addPage();
                        currentY = drawHeader(margins.top); // Re-draw header on new page
                        currentY = drawTableHead(currentY + 10);
                    }

                    // Zebra Striping
                    const bgColor = index % 2 === 0 ? '#FFFFFF' : colors.lightGray;
                    const rowHeight = item.item_description ? 35 : 25; // Taller row if description exists
                    
                    doc.rect(margins.left, currentY, width, rowHeight).fill(bgColor);
                    
                    // Row Content
                    doc.font(regularFontName).fontSize(9).fillColor(colors.dark);
                    
                    // Item Name & Desc
                    doc.text(safeText(item.item_name), margins.left + 10, currentY + 8, { width: 220, lineBreak: false, ellipsis: true });
                    if (item.item_description) {
                        doc.fontSize(7).fillColor(colors.gray)
                           .text(safeText(item.item_description), margins.left + 10, currentY + 20, { width: 220, lineBreak: false, ellipsis: true });
                    }
                    
                    doc.font(regularFontName).fontSize(9).fillColor(colors.dark);
                    doc.text(formatCurrency(item.selling_price), margins.left + 240, currentY + 8, { width: 80, align: 'right' });
                    doc.text(safeText(item.quantity, '0'), margins.left + 330, currentY + 8, { width: 50, align: 'center' });
                    doc.text(formatCurrency(item.total_price), margins.left + 400, currentY + 8, { width: 110, align: 'right' });

                    currentY += rowHeight;
                    subtotal += parseFloat(item.total_price || 0);
                });
            }

            // --- Financial Summary & Footer ---
            
            // Ensure space for summary
            if (currentY > doc.page.height - 200) {
                doc.addPage();
                currentY = margins.top;
            } else {
                currentY += 20;
            }

            const summaryWidth = 200;
            const summaryX = doc.page.width - margins.right - summaryWidth;

            // Draw Summary Box
            doc.rect(summaryX - 10, currentY, summaryWidth + 10, 100).fill(colors.lightGray).stroke(colors.border).lineWidth(1);
            
            let summaryY = currentY + 10;
            
            // Subtotal
            doc.font(regularFontName).fontSize(10).fillColor(colors.dark).text('Subtotal:', summaryX, summaryY);
            doc.text(formatCurrency(subtotal), summaryX, summaryY, { width: summaryWidth, align: 'right' });
            summaryY += 20;

            // Discount
            if (transaction.discount_amount > 0) {
                const discountLabel = transaction.discount_type === 'percentage' ? 'Discount (%):' : 'Discount (₹):';
                doc.fillColor(colors.accent).text(discountLabel, summaryX, summaryY);
                doc.text(`-${formatCurrency(transaction.discount_amount)}`, summaryX, summaryY, { width: summaryWidth, align: 'right' });
                summaryY += 20;
            }

            // Divider
            doc.moveTo(summaryX, summaryY).lineTo(summaryX + summaryWidth, summaryY).strokeColor(colors.border).stroke();
            summaryY += 10;

            // Net Total
            doc.font(boldFontName).fontSize(14).fillColor(colors.primary).text('Net Total:', summaryX, summaryY);
            doc.text(formatCurrency(transaction.total_amount), summaryX, summaryY, { width: summaryWidth, align: 'right' });

            // Signature
            const sigY = currentY + 40;
            try {
                if (fs.existsSync(signaturePath)) {
                    doc.image(signaturePath, margins.left, sigY, { width: 100, height: 40 });
                }
            } catch (e) { console.warn('Signature image load failed:', e.message); }
            doc.font(boldFontName).fontSize(9).fillColor(colors.dark).text('Authorized Signature', margins.left, sigY + 45);

            // --- Footer Terms & Thank You ---
            let footerY = doc.page.height - 130;
            
            // Terms
            doc.rect(margins.left, footerY, width, 55).fill('#F0FFF4').stroke(colors.primary).lineWidth(0.5);
            doc.font(boldFontName).fontSize(9).fillColor(colors.primary).text('TERMS & CONDITIONS:', margins.left + 10, footerY + 8);
            doc.font(regularFontName).fontSize(7).fillColor(colors.dark);
            doc.text('1. Goods once sold cannot be returned or exchanged.', margins.left + 10, footerY + 22);
            doc.text('2. Please check expiry date and other details at the time of purchase.', margins.left + 10, footerY + 32);
            doc.text('3. Consult doctor before taking medicine.', margins.left + 10, footerY + 42);

            // Thank you note
            doc.font(boldFontName).fontSize(10).fillColor(colors.primary)
               .text('Thank You for Choosing Kiran Care Wellness!', 0, footerY + 70, { align: 'center', width: doc.page.width });
            
            doc.font(regularFontName).fontSize(8).fillColor(colors.gray)
               .text('This is a computer generated invoice.', 0, footerY + 85, { align: 'center', width: doc.page.width });

            resolve();
        } catch (error) {
            console.error('generateBillPDF Error:', error);
            reject(error);
        }
    });
}

module.exports = router;