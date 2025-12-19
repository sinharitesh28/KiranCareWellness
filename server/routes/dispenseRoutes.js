const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const transporter = require('../mailer');

const router = express.Router();

// Search customer by mobile number (without balance)
router.get('/search-customer', requireAuth, (req, res) => {
    const { mobile } = req.query;
    
    if (!mobile) {
        return res.status(400).json({ success: false, error: 'Mobile number is required' });
    }

    const sql = `SELECT * FROM customerDetails WHERE mobile_no = ?`;
    
    db.query(sql, [mobile], (err, results) => {
        if (err) {
            console.error('Database error searching customer:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (results.length > 0) {
            res.json({ 
                success: true, 
                customer: results[0],
                exists: true 
            });
        } else {
            res.json({ 
                success: true, 
                customer: null,
                exists: false 
            });
        }
    });
});

// Save or update customer (without balance)
router.post('/save-customer', requireAuth, (req, res) => {
    const { mobile_no, name, email } = req.body;  // NEW: Add email
    
    if (!mobile_no || !name) {
        return res.status(400).json({ success: false, error: 'Mobile number and name are required' });
    }

    const customerSql = `
        INSERT INTO customerDetails (mobile_no, name, email) 
        VALUES (?, ?, ?) 
        ON DUPLICATE KEY UPDATE name = ?, email = ?, updated_at = CURRENT_TIMESTAMP
    `;
    
    db.query(customerSql, [mobile_no, name, email, name, email], (err, results) => {
        if (err) {
            console.error('Database error saving customer:', err);
            return res.status(500).json({ success: false, error: 'Failed to save customer' });
        }

        res.json({ 
            success: true, 
            message: 'Customer saved successfully',
            customerId: results.insertId 
        });
    });
});

// Search medicines from import_stock_detail with rate information
router.get('/search-medicines', requireAuth, (req, res) => {
    const { query, category } = req.query;
    
    if (!query) {
        return res.status(400).json({ success: false, error: 'Search query is required' });
    }

    let searchSql = '';
    let searchParams = [];

    // Enhanced search with rate information
    switch (category) {
        case 'name':
            searchSql = `
                SELECT 
                    id, item_name, item_desc, mrp, 
                    COALESCE(rate, mrp) as rate, 
                    quantity, location, barcode,
                    batch_number, expiry_date, manufacturer
                FROM import_stock_detail 
                WHERE item_name LIKE ? AND quantity > 0
            `;
            searchParams = [`%${query}%`];
            break;
        case 'description':
            searchSql = `
                SELECT 
                    id, item_name, item_desc, mrp, 
                    COALESCE(rate, mrp) as rate, 
                    quantity, location, barcode,
                    batch_number, expiry_date, manufacturer
                FROM import_stock_detail 
                WHERE item_desc LIKE ? AND quantity > 0
            `;
            searchParams = [`%${query}%`];
            break;
        case 'location':
            searchSql = `
                SELECT 
                    id, item_name, item_desc, mrp, 
                    COALESCE(rate, mrp) as rate, 
                    quantity, location, barcode,
                    batch_number, expiry_date, manufacturer
                FROM import_stock_detail 
                WHERE location LIKE ? AND quantity > 0
            `;
            searchParams = [`%${query}%`];
            break;
        case 'barcode':
            searchSql = `
                SELECT 
                    id, item_name, item_desc, mrp, 
                    COALESCE(rate, mrp) as rate, 
                    quantity, location, barcode,
                    batch_number, expiry_date, manufacturer
                FROM import_stock_detail 
                WHERE barcode = ? AND quantity > 0
            `;
            searchParams = [query];
            break;
        case 'rate':
            searchSql = `
                SELECT 
                    id, item_name, item_desc, mrp, 
                    COALESCE(rate, mrp) as rate, 
                    quantity, location, barcode,
                    batch_number, expiry_date, manufacturer
                FROM import_stock_detail 
                WHERE (rate <= ? OR mrp <= ?) AND quantity > 0
            `;
            searchParams = [query, query];
            break;
        default:
            searchSql = `
                SELECT 
                    id, item_name, item_desc, mrp, 
                    COALESCE(rate, mrp) as rate, 
                    quantity, location, barcode,
                    batch_number, expiry_date, manufacturer
                FROM import_stock_detail 
                WHERE (item_name LIKE ? OR item_desc LIKE ? OR location LIKE ? OR barcode = ?) 
                AND quantity > 0
            `;
            searchParams = [`%${query}%`, `%${query}%`, `%${query}%`, query];
    }

    db.query(searchSql, searchParams, (err, results) => {
        if (err) {
            console.error('Database error searching medicines:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        res.json({ 
            success: true, 
            medicines: results,
            count: results.length 
        });
    });
});

// Search medicine by barcode
router.get('/search-by-barcode', requireAuth, (req, res) => {
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

    db.query(sql, [barcode], (err, results) => {
        if (err) {
            console.error('Database error searching by barcode:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }

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
                found: false 
            });
        }
    });
});

// Save transaction and bill - FIXED VERSION
router.post('/save-transaction', requireAuth, (req, res) => {
    const { customer, items, summary, paymentMethod } = req.body;
    const userId = req.session.code;

    if (!customer || !items || items.length === 0 || !summary) {
        return res.status(400).json({ success: false, error: 'Incomplete transaction data' });
    }

    // Start transaction
    db.beginTransaction((err) => {
        if (err) {
            console.error('Transaction error:', err);
            return res.status(500).json({ success: false, error: 'Transaction failed' });
        }

        console.log('Processing transaction with data:', {
            customer,
            itemsCount: items.length,
            summary,
            paymentMethod
        });

        // 1. Handle customer (optional)
        let customerId = null;
        
        if (customer && (customer.mobile || customer.name || customer.email)) {  // NEW: Add email check
        const cleanMobile = customer.mobile ? customer.mobile.trim() : null;
        const cleanName = customer.name ? customer.name.trim() : null;
        const cleanEmail = customer.email ? customer.email.trim() : null;  // NEW: Clean email

        if (cleanMobile) {
            // Check if customer exists with this mobile
            db.query(
                'SELECT id FROM customerDetails WHERE mobile_no = ?',
                [cleanMobile],
                (err, existingCustomer) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error('Database error checking customer:', err);
                            res.status(500).json({ success: false, error: 'Database error' });
                        });
                    }

                    if (existingCustomer.length > 0) {
                        customerId = existingCustomer[0].id;
                        // Update customer name and email if provided
                        if (cleanName || cleanEmail) {  // NEW: Include email
                            db.query(
                                'UPDATE customerDetails SET name = COALESCE(?, name), email = COALESCE(?, email), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                                [cleanName, cleanEmail, customerId],  // NEW: Include email
                                (err) => {
                                    if (err) {
                                        return db.rollback(() => {
                                            console.error('Database error updating customer:', err);
                                            res.status(500).json({ success: false, error: 'Database error' });
                                        });
                                    }
                                    proceedWithTransaction();
                                }
                            );
                        } else {
                            proceedWithTransaction();
                        }
                    } else {
                        // Create new customer with email
                        db.query(
                            'INSERT INTO customerDetails (mobile_no, name, email) VALUES (?, ?, ?)',  // NEW: Include email
                            [cleanMobile, cleanName, cleanEmail],
                            (err, customerResult) => {
                                if (err) {
                                    return db.rollback(() => {
                                        console.error('Database error creating customer:', err);
                                        res.status(500).json({ success: false, error: 'Database error' });
                                    });
                                }
                                customerId = customerResult.insertId;
                                console.log('Created new customer with ID:', customerId);
                                proceedWithTransaction();
                            }
                        );
                    }
                }
            );
        } else if (cleanName || cleanEmail) {  // NEW: Include email check
            // Create customer with name and/or email (no mobile)
            db.query(
                'INSERT INTO customerDetails (name, email) VALUES (?, ?)',  // NEW: Include email
                [cleanName, cleanEmail],
                (err, customerResult) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error('Database error creating customer:', err);
                            res.status(500).json({ success: false, error: 'Database error' });
                        });
                    }
                    customerId = customerResult.insertId;
                    console.log('Created new customer with name/email only, ID:', customerId);
                    proceedWithTransaction();
                }
            );
        } else {
            proceedWithTransaction();
        }
    } else {
        proceedWithTransaction();
    }

        function proceedWithTransaction() {
            // 2. Generate bill number
            function generateBillNumber() {
                const timestamp = Date.now();
                const random = Math.floor(Math.random() * 1000);
                return `BILL-${timestamp}-${random}`;
            }

            // 3. Create transaction record
            const billNumber = generateBillNumber();
            console.log('Generated bill number:', billNumber);

            db.query(
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
                ],
                (err, transactionResult) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error('Database error creating transaction:', err);
                            res.status(500).json({ success: false, error: 'Database error' });
                        });
                    }

                    const transactionId = transactionResult.insertId;
                    console.log('Created transaction with ID:', transactionId);

                    // 4. Save transaction items and update stock
                    let itemsProcessed = 0;
                    let stockUpdateErrors = [];

                    if (items.length === 0) {
                        return db.rollback(() => {
                            res.status(400).json({ success: false, error: 'No items in transaction' });
                        });
                    }

                    items.forEach((item) => {
                        console.log('Processing item:', {
                            name: item.item_name,
                            stock_detail_id: item.stock_detail_id,
                            quantity: item.quantity,
                            is_manual: item.is_manual
                        });

                        // Insert transaction item with dose dispensing support
db.query(
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
        item.dose_dispensing || false,  // NEW: Track if it's dose dispensing
        item.dose_stock_id || null,     // NEW: Reference to dose_stock table
        item.dose_quantity || null,     // NEW: Number of doses
        item.dose_unit_price || null    // NEW: Price per dose
    ],
    (err) => {
        if (err) {
            stockUpdateErrors.push({
                item: item.item_name,
                reason: 'Failed to insert transaction item: ' + err.message
            });
        }

        // Update stock based on item type
        if (item.dose_dispensing) {
            // Update dose stock - reduce loose_quantity from import_stock_detail
            // Note: dose_stock_id now refers to the id in import_stock_detail
            db.query(
                'UPDATE import_stock_detail SET loose_quantity = loose_quantity - ? WHERE id = ? AND loose_quantity >= ?',
                [item.dose_quantity, item.dose_stock_id, item.dose_quantity],
                (err, updateResult) => {
                    if (err) {
                        stockUpdateErrors.push({
                            item: item.item_name,
                            reason: 'Dose stock update error: ' + err.message
                        });
                    } else if (updateResult.affectedRows === 0) {
                        stockUpdateErrors.push({
                            item: item.item_name,
                            reason: 'Insufficient loose doses. Please ensure stock is converted.'
                        });
                    } else {
                        console.log(`Dose stock updated for item ${item.item_name}, reduced by ${item.dose_quantity} doses`);
                    }

                    itemsProcessed++;
                    if (itemsProcessed === items.length) {
                        finishTransaction();
                    }
                }
            );
        } else if (!item.is_manual && item.stock_detail_id) {
            // Update regular stock (full packs)
            db.query(
                'UPDATE import_stock_detail SET quantity = quantity - ? WHERE id = ? AND quantity >= ?',
                [item.quantity, item.stock_detail_id, item.quantity],
                (err, updateResult) => {
                    if (err) {
                        stockUpdateErrors.push({
                            item: item.item_name,
                            reason: 'Stock update error: ' + err.message
                        });
                    } else if (updateResult.affectedRows === 0) {
                        stockUpdateErrors.push({
                            item: item.item_name,
                            reason: 'Insufficient stock or item not found'
                        });
                    } else {
                        console.log(`Stock updated for item ${item.item_name}, reduced by ${item.quantity}`);
                    }

                    itemsProcessed++;
                    if (itemsProcessed === items.length) {
                        finishTransaction();
                    }
                }
            );
        } else {
            itemsProcessed++;
            if (itemsProcessed === items.length) {
                finishTransaction();
            }
        }
    }
);
                    });

                    function finishTransaction() {
                        if (stockUpdateErrors.length > 0) {
                            return db.rollback(() => {
                                console.error('Stock update errors:', stockUpdateErrors);
                                res.status(400).json({
                                    success: false,
                                    message: 'Transaction failed due to stock issues',
                                    errors: stockUpdateErrors
                                });
                            });
                        }

                        db.commit((err) => {
                            if (err) {
                                return db.rollback(() => {
                                    console.error('Commit error:', err);
                                    res.status(500).json({ success: false, error: 'Transaction commit failed' });
                                });
                            }

                            console.log('Transaction committed successfully');
                            const response = {
                                success: true,
                                transactionId: transactionId,
                                billNumber: billNumber,
                                message: 'Transaction saved successfully'
                            };

                            res.json(response);
                        });
                    }
                }
            );
        }
    });
});

// Send WhatsApp bill
router.post('/send-whatsapp-bill', requireAuth, (req, res) => {
    const { customer, items, summary } = req.body;
    
    if (!customer || !items || !summary) {
        return res.status(400).json({ success: false, error: 'Customer and bill data required' });
    }

    try {
        // Generate bill content for WhatsApp
        let billContent = `*KiranCareWellness - Medicine Bill*\n\n`;
        billContent += `*Customer:* ${customer.name}\n`;
        billContent += `*Mobile:* ${customer.mobile}\n`;
        billContent += `*Date:* ${new Date().toLocaleDateString()}\n\n`;
        billContent += `*Items:*\n`;
        
        items.forEach((item, index) => {
            billContent += `${index + 1}. ${item.item_name} - ${item.quantity} x ₹${item.selling_price} = ₹${item.total_price}\n`;
        });
        
        billContent += `\n*Subtotal:* ₹${summary.subtotal.toFixed(2)}\n`;
        if (summary.discountAmount > 0) {
            billContent += `*Discount:* -₹${summary.discountAmount.toFixed(2)}\n`;
        }
        billContent += `*Total Amount:* ₹${summary.totalAmount.toFixed(2)}\n\n`;
        billContent += `*Thank you for your purchase!* 🏥`;

        console.log('WhatsApp Bill Content:', billContent);
        
        res.json({ 
            success: true, 
            message: 'WhatsApp bill sent successfully',
            billContent: billContent
        });

    } catch (error) {
        console.error('WhatsApp bill error:', error);
        res.status(500).json({ success: false, error: 'Failed to send WhatsApp bill' });
    }
});

// Get customer transaction history
router.get('/customer-transactions', requireAuth, (req, res) => {
    const { customerId } = req.query;
    
    if (!customerId) {
        return res.status(400).json({ success: false, error: 'Customer ID is required' });
    }

    const sql = `
        SELECT 
            t.id, t.total_amount, t.discount_amount, t.payment_method, 
            t.created_at, COUNT(ti.id) as items_count
        FROM transactions t
        LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
        WHERE t.customer_id = ?
        GROUP BY t.id
        ORDER BY t.created_at DESC
        LIMIT 10
    `;

    db.query(sql, [customerId], (err, results) => {
        if (err) {
            console.error('Database error fetching transactions:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        res.json({ 
            success: true, 
            transactions: results 
        });
    });
});

// Generate and download PDF bill for saved transaction
router.get('/generate-pdf/:transactionId', requireAuth, async (req, res) => {
    const { transactionId } = req.params;

    try {
        // Fetch transaction details
        const transactionSql = `
            SELECT t.*, c.name as customer_name, c.mobile_no 
            FROM transactions t 
            LEFT JOIN customerDetails c ON t.customer_id = c.id 
            WHERE t.id = ?
        `;
        
        const [transactions] = await db.promise().execute(transactionSql, [transactionId]);
        
        if (transactions.length === 0) {
            return res.status(404).json({ success: false, error: 'Transaction not found' });
        }

        const transaction = transactions[0];

        // Fetch transaction items
        const itemsSql = `
            SELECT * FROM transaction_items 
            WHERE transaction_id = ? 
            ORDER BY id
        `;
        const [items] = await db.promise().execute(itemsSql, [transactionId]);

        // Create PDF document
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        
        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="bill-${transaction.bill_number}.pdf"`);

        // Pipe PDF to response
        doc.pipe(res);

        // Generate PDF content
        await generateBillPDF(doc, transaction, items);

        // Finalize PDF
        doc.end();

    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate PDF' });
    }
});

// Generate PDF from current data (without saving)
router.post('/generate-pdf-from-data', requireAuth, async (req, res) => {
    const { customer, items, summary, paymentMethod } = req.body;

    try {
        // Generate temporary bill number
        function generateBillNumber() {
            const timestamp = Date.now();
            const random = Math.floor(Math.random() * 1000);
            return `TEMP-${timestamp}-${random}`;
        }

        const billNumber = generateBillNumber();
        
        // Create transaction object for PDF generation
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

        // Create PDF document
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        
        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="bill-${billNumber}.pdf"`);

        // Pipe PDF to response
        doc.pipe(res);

        // Generate PDF content
        await generateBillPDF(doc, transaction, items);

        // Finalize PDF
        doc.end();

    } catch (error) {
        console.error('PDF generation from data error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate PDF' });
    }
});

// PDF Generation Function
async function generateBillPDF(doc, transaction, items) {
    return new Promise((resolve) => {
        // Get the root directory path
        const rootDir = path.join(__dirname, '..', '..');
        const logoPath = path.join(rootDir, 'img', 'KiranCareWellnessLogo.png');
        const signaturePath = path.join(rootDir, 'img', 'sign_2.png');

        // Professional color scheme
        const colors = {
            primary: '#00712D',
            secondary: '#D5ED9F',
            accent: '#FF9100',
            dark: '#2D3748',
            light: '#F8F9FA',
            gray: '#718096'
        };

        // Helper function to format currency without unwanted prefixes
        const formatCurrency = (amount) => {
            return `₹${parseFloat(amount || 0).toFixed(2)}`.replace('¹', '');
        };

        // Helper function to add new page with header
        const addNewPage = (doc) => {
            doc.addPage();
            // Add header on new page
            doc.fontSize(16)
               .font('Helvetica-Bold')
               .fillColor(colors.primary)
               .text('Kiran Care Wellness - INVOICE', 50, 30, { align: 'center' });
            doc.moveTo(50, 55)
               .lineTo(545, 55)
               .strokeColor(colors.primary)
               .lineWidth(0.5)
               .stroke();
            return 70; // Return new Y position
        };

        let currentY = 50;

        // Header Section with Logo
        try {
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, 50, currentY, { width: 45, height: 45 });
                doc.fontSize(18)
                   .font('Helvetica-Bold')
                   .fillColor(colors.primary)
                   .text('Kiran Care Wellness', 105, currentY + 5);
            } else {
                doc.fontSize(20)
                   .font('Helvetica-Bold')
                   .fillColor(colors.primary)
                   .text('Kiran Care Wellness', 50, currentY, { align: 'center' });
            }
        } catch (error) {
            doc.fontSize(20)
               .font('Helvetica-Bold')
               .fillColor(colors.primary)
               .text('Kiran Care Wellness', 50, currentY, { align: 'center' });
        }

        currentY += 50;

        // Pharmacy Details - Compact layout
        doc.fontSize(8)
           .font('Helvetica')
           .fillColor(colors.gray)
           .text('Generic Medical Store', 50, currentY, { align: 'center' })
           .text('Shop no. A1, Sai Darshan Apt., Alkapuri Road, Nalasopara (E) 401209', 50, currentY + 10, { align: 'center' })
           .text('Mobile: 9076828408, 9900235218 | Email: kirancarewellness@gmail.com', 50, currentY + 20, { align: 'center' })
           .text('Drug Lic: MH-PL1-578747, MH-PL1-578748, MH-PL1-581222, MH-PL1-581221', 50, currentY + 30, { align: 'center' });

        currentY += 50;

        // Invoice Header
        doc.fontSize(16)
           .font('Helvetica-Bold')
           .fillColor(colors.dark)
           .text('INVOICE', 50, currentY, { align: 'center' });

        currentY += 25;

        // Bill Information Section - Professional two-column layout
        const billInfoTop = currentY;
        
        // Left Column - Bill Details
        doc.fontSize(9)
           .font('Helvetica-Bold')
           .fillColor(colors.dark)
           .text('BILL DETAILS', 50, billInfoTop)
           .font('Helvetica')
           .fillColor(colors.gray)
           .text(`Bill No: ${transaction.bill_number}`, 50, billInfoTop + 12)
           .text(`Date: ${new Date(transaction.transaction_date).toLocaleDateString('en-IN')}`, 50, billInfoTop + 24)
           .text(`Time: ${new Date(transaction.transaction_date).toLocaleTimeString('en-IN', { 
               hour: '2-digit', 
               minute: '2-digit',
               hour12: true 
           })}`, 50, billInfoTop + 36);

        // Right Column - Customer Details
        doc.font('Helvetica-Bold')
           .fillColor(colors.dark)
           .text('CUSTOMER DETAILS', 300, billInfoTop)
           .font('Helvetica')
           .fillColor(colors.gray)
           .text(`Name: ${transaction.customer_name || 'Walk-in Customer'}`, 300, billInfoTop + 12)
           .text(`Mobile: ${transaction.customer_mobile || 'N/A'}`, 300, billInfoTop + 24)
           .text(`Payment: ${transaction.payment_method.toUpperCase()}`, 300, billInfoTop + 36);

        currentY += 60;

        // Items Table Header - Professional styling
        const tableTop = currentY;
        
        // Table header with background
        doc.rect(50, tableTop, 495, 22)
           .fill(colors.primary);
        
        // Table header text
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor('#FFFFFF')
           .text('ITEM NAME', 55, tableTop + 7)
           .text('UNIT PRICE', 350, tableTop + 7)
           .text('QTY', 430, tableTop + 7)
           .text('TOTAL', 470, tableTop + 7);

        // Items Table Rows
        currentY = tableTop + 27;
        let subtotal = 0;

        items.forEach((item, index) => {
            // Check if we need a new page
            if (currentY > 650) {
                currentY = addNewPage(doc);
                
                // Re-add table header on new page
                doc.rect(50, currentY, 495, 22)
                   .fill(colors.primary);
                doc.fontSize(10)
                   .font('Helvetica-Bold')
                   .fillColor('#FFFFFF')
                   .text('ITEM NAME', 55, currentY + 7)
                   .text('UNIT PRICE', 350, currentY + 7)
                   .text('QTY', 430, currentY + 7)
                   .text('TOTAL', 470, currentY + 7);
                currentY += 27;
            }

            // Alternate row background for readability
            const bgColor = index % 2 === 0 ? '#FFFFFF' : colors.light;
            
            doc.rect(50, currentY, 495, 20)
               .fill(bgColor);
            
            // Item details with clean formatting
            doc.fontSize(9)
               .font('Helvetica')
               .fillColor(colors.dark)
               .text(item.item_name, 55, currentY + 6, { width: 280 })
               .text(formatCurrency(item.selling_price), 350, currentY + 6)
               .text(item.quantity.toString(), 430, currentY + 6)
               .text(formatCurrency(item.total_price), 470, currentY + 6);

            // Add item description if available (smaller font)
            if (item.item_description && item.item_description.trim() !== '') {
                doc.fontSize(7)
                   .fillColor(colors.gray)
                   .text(item.item_description, 55, currentY + 18, { width: 280 });
                currentY += 8;
            }

            subtotal += parseFloat(item.total_price || 0);
            currentY += 25;
        });

        // Financial Summary Section - Professional box design
        const summaryTop = Math.max(currentY + 20, 600);
        
        // Check if we need new page for summary
        if (summaryTop > 700) {
            currentY = addNewPage(doc);
        } else {
            currentY = summaryTop;
        }

        // Summary container with shadow effect (simulated with border)
        doc.rect(300, currentY, 245, 90)
           .fill(colors.light)
           .stroke(colors.primary)
           .lineWidth(1);
        
        // Summary title
        doc.fontSize(11)
           .font('Helvetica-Bold')
           .fillColor(colors.primary)
           .text('FINANCIAL SUMMARY', 310, currentY + 8);

        // Subtotal
        doc.fontSize(9)
           .font('Helvetica')
           .fillColor(colors.dark)
           .text('Subtotal:', 310, currentY + 25)
           .text(formatCurrency(subtotal), 430, currentY + 25);

        // Discount Section - Highlighted
        if (transaction.discount_amount > 0) {
            const discountType = transaction.discount_type === 'percentage' ? '%' : '₹';
            doc.font('Helvetica-Bold')
               .fillColor(colors.accent)
               .text(`Discount (${discountType}):`, 310, currentY + 40)
               .font('Helvetica')
               .fillColor(colors.accent)
               .text(`-${formatCurrency(transaction.discount_amount)}`, 430, currentY + 40);
        }

        // Total Amount - Prominent
        doc.fontSize(12)
           .font('Helvetica-Bold')
           .fillColor(colors.primary)
           .text('NET TOTAL:', 310, currentY + 60)
           .text(formatCurrency(transaction.total_amount), 430, currentY + 60);

        currentY += 110;

        // Signature Section
        try {
            if (fs.existsSync(signaturePath)) {
                // Add signature with professional styling
                doc.image(signaturePath, 400, currentY - 8, { width: 100, height: 35 });
            }
        } catch (error) {
            console.warn('Signature not loaded:', error.message);
        }

        // Signature label
        doc.fontSize(8)
           .font('Helvetica-Bold')
           .fillColor(colors.dark)
           .text('Authorized Signature', 400, currentY + 15);

        currentY += 40;

        // Check if we need new page for terms and conditions
        if (currentY > 650) {
            currentY = addNewPage(doc);
        }

        // Footer with generation info
        doc.fontSize(8)
           .font('Helvetica')
           .fillColor(colors.gray)
           .text('Thank you for your business!', 50, currentY, { align: 'center' })
           .text('This is a computer generated invoice.', 50, currentY + 12, { align: 'center' })
           .text(`Generated on: ${new Date().toLocaleString('en-IN')}`, 50, currentY + 24, { align: 'center' });

        currentY += 50;

        // Terms and Conditions Section - Dedicated space
        // Check if we need new page for T&C
        if (currentY > 600) {
            currentY = addNewPage(doc);
        }

        // Terms and Conditions Header
        doc.fontSize(12)
           .font('Helvetica-Bold')
           .fillColor(colors.primary)
           .text('TERMS & CONDITIONS', 50, currentY);

        currentY += 20;

        // Terms and Conditions Content - Professional numbered list
        const terms = [
            'Goods once sold cannot be returned or exchanged.',
            'Please check expiry date and other details at the time of purchase.',
            'Prices inclusive of all applicable taxes.',
            'Consult doctor before taking medicine.'
        ];

        terms.forEach((term, index) => {
            // Check if we need new page for each term (if space is tight)
            if (currentY > 750) {
                currentY = addNewPage(doc);
                currentY += 20; // Add some space after header
            }

            doc.fontSize(9)
               .font('Helvetica-Bold')
               .fillColor(colors.dark)
               .text(`${index + 1}.`, 50, currentY)
               .font('Helvetica')
               .fillColor(colors.gray)
               .text(term, 65, currentY, { width: 480, align: 'justify' });

            currentY += 20;
        });

        // Final Thank You Note
        currentY += 20;
        if (currentY > 750) {
            currentY = addNewPage(doc);
        }

        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor(colors.primary)
           .text('Thank You for Choosing Kiran Care Wellness!', 50, currentY, { align: 'center' })
           .fontSize(8)
           .font('Helvetica')
           .fillColor(colors.gray)
           .text('We value your trust and look forward to serving you again.', 50, currentY + 15, { align: 'center' });

        resolve();
    });
}

// Send Email bill - FIXED VERSION
router.post('/send-email-bill', requireAuth, async (req, res) => {
    const { customer, items, summary, transactionId } = req.body;
    
    if (!customer || !items || !summary || !customer.email) {
        return res.status(400).json({ success: false, error: 'Customer email and bill data required' });
    }

    try {
        // Generate temporary bill number if no transactionId
        const billNumber = transactionId ? `BILL-${transactionId}` : `TEMP-${Date.now()}`;
        
        // Create transaction object for PDF generation
        const transaction = {
            bill_number: billNumber,
            transaction_date: new Date(),
            customer_name: customer.name || 'Walk-in Customer',
            customer_mobile: customer.mobile || 'N/A',
            total_amount: summary.totalAmount,
            discount_amount: summary.discountAmount || 0,
            discount_type: summary.discountType || 'fixed',
            payment_method: 'cash' // Default for email
        };

        // Generate PDF buffer
        const pdfBuffer = await generatePDFBuffer(transaction, items);
        
        // Send email with PDF attachment
        const mailOptions = {
            from: transporter.options.auth.user, // Use the email from mailer config
            to: customer.email,
            subject: `Your Medicine Bill - KiranCareWellness`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #00712D; text-align: center;">KiranCareWellness - Medicine Bill</h2>
                    <p>Dear ${customer.name || 'Valued Customer'},</p>
                    <p>Thank you for your purchase at KiranCareWellness. Please find your bill attached.</p>
                    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p style="margin: 0;"><strong>Bill Number:</strong> ${billNumber}</p>
                        <p style="margin: 5px 0 0 0;"><strong>Total Amount:</strong> ₹${summary.totalAmount.toFixed(2)}</p>
                        <p style="margin: 5px 0 0 0;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                    </div>
                    <p>If you have any questions, please contact us.</p>
                    <br>
                    <p>Best regards,<br><strong>KiranCareWellness Team</strong></p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 12px; color: #666;">
                        This is an automated email. Please do not reply to this message.
                    </p>
                </div>
            `,
            attachments: [
                {
                    filename: `bill-${billNumber}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        };

        await transporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            message: 'Email bill sent successfully'
        });

    } catch (error) {
        console.error('Email bill error:', error);
        res.status(500).json({ success: false, error: 'Failed to send email bill: ' + error.message });
    }
});

// Generate PDF Buffer Function (NEW)
async function generatePDFBuffer(transaction, items) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 40, size: 'A4' });
            const buffers = [];

            // Collect PDF data into buffers
            doc.on('data', (chunk) => buffers.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            // Generate PDF content using existing function
            generateBillPDF(doc, transaction, items)
                .then(() => doc.end())
                .catch(reject);

        } catch (error) {
            reject(error);
        }
    });
}

// Search medicines with dose dispensing support
router.get('/search-medicines-with-dose', requireAuth, (req, res) => {
    const { query, category, doseDispensing } = req.query;
    
    if (!query) {
        return res.status(400).json({ success: false, error: 'Search query is required' });
    }

    const searchTerm = `%${query}%`;
    let sqlParams = [];
    let whereClauseNormal = '';
    let whereClauseDose = '';

    // Define WHERE clauses based on category
    switch (category) {
        case 'name':
            whereClauseNormal = 'd.item_name LIKE ?';
            whereClauseDose = 'ds.item_name LIKE ?';
            sqlParams = [searchTerm, searchTerm];
            break;
        case 'description':
            whereClauseNormal = 'd.item_desc LIKE ?';
            whereClauseDose = 'ds.item_description LIKE ?';
            sqlParams = [searchTerm, searchTerm];
            break;
        case 'location':
            whereClauseNormal = 'd.location LIKE ?';
            whereClauseDose = 'ds.location LIKE ?';
            sqlParams = [searchTerm, searchTerm];
            break;
        case 'barcode':
            whereClauseNormal = 'd.barcode = ?';
            // Dose stock doesn't have its own barcode usually, uses original item's
            whereClauseDose = 'd.barcode = ?'; 
            sqlParams = [query, query];
            break;
        default: // All
            whereClauseNormal = '(d.item_name LIKE ? OR d.item_desc LIKE ? OR d.location LIKE ? OR d.barcode = ?)';
            whereClauseDose = '(ds.item_name LIKE ? OR ds.item_description LIKE ? OR ds.location LIKE ? OR d.barcode = ?)';
            sqlParams = [searchTerm, searchTerm, searchTerm, query, searchTerm, searchTerm, searchTerm, query];
    }

    // UNION Query to fetch both Normal Packs and Dose Stock (FROM SINGLE TABLE)
    const searchSql = `
        SELECT * FROM (
            -- 1. Normal Stock (Full Packs)
            SELECT 
                d.id, 
                d.item_name, 
                d.item_desc, 
                d.mrp, 
                COALESCE(d.rate, d.mrp) as rate, 
                d.quantity, 
                d.location, 
                d.barcode,
                d.batch_number, 
                d.expiry_date, 
                d.manufacturer,
                d.packing,
                'normal' as stock_type,
                NULL as dose_stock_id, -- Not used for normal
                NULL as remaining_doses,
                NULL as total_doses,
                NULL as packing_size
            FROM import_stock_detail d
            WHERE d.quantity > 0 AND ${whereClauseNormal}

            UNION ALL

            -- 2. Dose Stock (Loose/Open Packs - Now in same table)
            SELECT 
                d.id, 
                d.item_name, 
                d.item_desc, 
                ROUND(d.mrp / NULLIF(d.packing, 0), 2) as mrp, -- Unit MRP
                ROUND(COALESCE(d.rate, d.mrp) / NULLIF(d.packing, 0), 2) as rate, -- Unit Rate
                0 as quantity, -- "0" full packs (display logic)
                d.location, 
                d.barcode,
                d.batch_number, 
                d.expiry_date, 
                d.manufacturer,
                d.packing,
                'dose' as stock_type,
                d.id as dose_stock_id, -- Reference same ID
                d.loose_quantity as remaining_doses, -- Use new column
                d.packing as total_doses,
                d.packing as packing_size
            FROM import_stock_detail d
            WHERE d.loose_quantity > 0 AND ${whereClauseNormal} -- Use same where clause as table is same
        ) AS combined_results
        ORDER BY item_name ASC
        LIMIT 50
    `;

    db.query(searchSql, sqlParams, (err, results) => {
        if (err) {
            console.error('Database error searching medicines:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        res.json({ 
            success: true, 
            medicines: results,
            count: results.length 
        });
    });
});


// Convert normal stock to dose dispensing stock
router.post('/convert-to-dose-stock', requireAuth, (req, res) => {
    const { stockDetailId } = req.body;

    if (!stockDetailId) {
        return res.status(400).json({ success: false, error: 'Stock detail ID is required' });
    }

    // Start transaction
    db.beginTransaction((err) => {
        if (err) {
            console.error('Transaction error:', err);
            return res.status(500).json({ success: false, error: 'Transaction failed' });
        }

        // 1. Get the stock details
        const getStockSql = `
            SELECT id, item_name, item_desc, mrp, rate, quantity, packing, location 
            FROM import_stock_detail 
            WHERE id = ? AND quantity > 0
        `;

        db.query(getStockSql, [stockDetailId], (err, results) => {
            if (err) {
                return db.rollback(() => {
                    console.error('Database error getting stock:', err);
                    res.status(500).json({ success: false, error: 'Database error' });
                });
            }

            if (results.length === 0) {
                return db.rollback(() => {
                    res.status(404).json({ success: false, error: 'Stock not found or out of stock' });
                });
            }

            const stock = results[0];
            const packing = stock.packing || 1; // Default to 1 if packing not set

            if (packing <= 1) {
                return db.rollback(() => {
                    res.status(400).json({ 
                        success: false, 
                        error: 'Packing size must be greater than 1 for dose dispensing' 
                    });
                });
            }

            // 2. Reduce the original stock by 1 unit AND increase loose_quantity
            const updateStockSql = `
                UPDATE import_stock_detail 
                SET quantity = quantity - 1,
                    loose_quantity = loose_quantity + packing
                WHERE id = ? AND quantity >= 1
            `;

            db.query(updateStockSql, [stockDetailId], (err, updateResult) => {
                if (err) {
                    return db.rollback(() => {
                        console.error('Database error updating stock:', err);
                        res.status(500).json({ success: false, error: 'Database error' });
                    });
                }

                if (updateResult.affectedRows === 0) {
                    return db.rollback(() => {
                        res.status(400).json({ success: false, error: 'Insufficient stock for conversion' });
                    });
                }

                // Commit transaction
                db.commit((err) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error('Commit error:', err);
                            res.status(500).json({ success: false, error: 'Transaction commit failed' });
                        });
                    }

                    res.json({
                        success: true,
                        doseStockId: stock.id, // Use same ID
                        packing: packing,
                        message: `Successfully converted 1 unit to ${packing} doses`
                    });
                });
            });
        });
    });
});

// Ensure sufficient dose stock is available
router.post('/ensure-dose-stock', requireAuth, (req, res) => {
    const { stockDetailId, requiredDoses } = req.body;

    if (!stockDetailId || !requiredDoses) {
        return res.status(400).json({ 
            success: false, 
            error: 'Stock detail ID and required doses are required' 
        });
    }

    // Start transaction
    db.beginTransaction((err) => {
        if (err) {
            console.error('Transaction error:', err);
            return res.status(500).json({ success: false, error: 'Transaction failed' });
        }

        // 1. Check available doses for this stock (loose_quantity)
        const checkDoseSql = `
            SELECT loose_quantity as total_available_doses, packing, quantity
            FROM import_stock_detail 
            WHERE id = ?
        `;

        db.query(checkDoseSql, [stockDetailId], (err, results) => {
            if (err) {
                return db.rollback(() => {
                    console.error('Database error checking dose stock:', err);
                    res.status(500).json({ success: false, error: 'Database error' });
                });
            }

            if (results.length === 0) {
                return db.rollback(() => {
                    res.status(404).json({ success: false, error: 'Stock not found' });
                });
            }

            const stock = results[0];
            const availableDoses = stock.total_available_doses || 0;
            const neededDoses = Math.max(0, requiredDoses - availableDoses);

            if (neededDoses === 0) {
                // Enough doses available, no conversion needed
                db.commit((err) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error('Commit error:', err);
                            res.status(500).json({ success: false, error: 'Transaction commit failed' });
                        });
                    }

                    res.json({
                        success: true,
                        convertedUnits: 0,
                        availableDoses: availableDoses,
                        message: 'Sufficient doses available'
                    });
                });
                return;
            }

            // 2. Need conversion
            const packing = stock.packing || 1;
            const unitsToConvert = Math.ceil(neededDoses / packing);

            if (stock.quantity < unitsToConvert) {
                return db.rollback(() => {
                    res.status(400).json({ 
                        success: false, 
                        error: `Insufficient stock. Need ${unitsToConvert} units but only ${stock.quantity} available` 
                    });
                });
            }

            // 3. Convert units to doses (update same table)
            const updateStockSql = `
                UPDATE import_stock_detail 
                SET quantity = quantity - ?,
                    loose_quantity = loose_quantity + ?
                WHERE id = ? AND quantity >= ?
            `;
            
            const dosesToAdd = unitsToConvert * packing;

            db.query(updateStockSql, [unitsToConvert, dosesToAdd, stockDetailId, unitsToConvert], (err, updateResult) => {
                if (err) {
                    return db.rollback(() => {
                        console.error('Database error updating stock:', err);
                        res.status(500).json({ success: false, error: 'Database error' });
                    });
                }

                if (updateResult.affectedRows === 0) {
                    return db.rollback(() => {
                        res.status(400).json({ success: false, error: 'Insufficient stock for conversion' });
                    });
                }

                db.commit((err) => {
                    if (err) {
                        return db.rollback(() => {
                            console.error('Commit error:', err);
                            res.status(500).json({ success: false, error: 'Transaction commit failed' });
                        });
                    }

                    res.json({
                        success: true,
                        convertedUnits: unitsToConvert,
                        dosesCreated: dosesToAdd,
                        totalAvailableDoses: availableDoses + dosesToAdd,
                        message: `Converted ${unitsToConvert} units to ${dosesToAdd} doses`
                    });
                });
            });
        });
    });
});

function updateDoseStock(doseStockId, dosesUsed, callback) {
    // UPDATED: Update loose_quantity in import_stock_detail
    const updateSql = 'UPDATE import_stock_detail SET loose_quantity = loose_quantity - ? WHERE id = ? AND loose_quantity >= ?';
    
    db.query(updateSql, [dosesUsed, doseStockId, dosesUsed], (err, result) => {
        if (err) {
            console.error('Error updating dose stock:', err);
            callback(err);
        } else if (result.affectedRows === 0) {
            callback(new Error('Insufficient doses available'));
        } else {
            console.log(`Updated loose stock for item ${doseStockId}, reduced by ${dosesUsed} doses`);
            callback(null, result);
        }
    });
}

module.exports = router;