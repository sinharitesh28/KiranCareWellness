// routes/transactions.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Generate unique bill number
function generateBillNumber() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `BILL-${timestamp}-${random}`;
}

// Search customer by mobile
router.get('/search-customer', async (req, res) => {
    try {
        const { mobile } = req.query;
        
        if (!mobile) {
            return res.json({
                success: true,
                exists: false,
                message: 'No mobile number provided'
            });
        }

        const [customers] = await db.promise().execute(
            'SELECT * FROM customerDetails WHERE mobile_no = ?',
            [mobile]
        );

        if (customers.length > 0) {
            res.json({
                success: true,
                exists: true,
                customer: customers[0]
            });
        } else {
            res.json({
                success: true,
                exists: false,
                message: 'Customer not found'
            });
        }
    } catch (error) {
        console.error('Search customer error:', error);
        res.status(500).json({
            success: false,
            message: 'Error searching customer'
        });
    }
});

// Search medicines by various criteria
router.get('/search-medicines', async (req, res) => {
    try {
        const { query, category = 'all' } = req.query;
        
        if (!query || query.length < 2) {
            return res.json({
                success: true,
                medicines: []
            });
        }

        let sql = `
            SELECT 
                id, item_name, item_desc, manufacturer, 
                batch_number, expiry_date, mfg_date,
                quantity, free_quantity, rate, mrp, 
                location, barcode, barcode_printed
            FROM import_stock_detail 
            WHERE quantity > 0 AND 
        `;

        let params = [];

        switch (category) {
            case 'name':
                sql += 'item_name LIKE ?';
                params.push(`%${query}%`);
                break;
            case 'description':
                sql += 'item_desc LIKE ?';
                params.push(`%${query}%`);
                break;
            case 'location':
                sql += 'location LIKE ?';
                params.push(`%${query}%`);
                break;
            case 'barcode':
                sql += 'barcode = ?';
                params.push(query);
                break;
            case 'all':
            default:
                sql += '(item_name LIKE ? OR item_desc LIKE ? OR location LIKE ? OR barcode = ?)';
                params.push(`%${query}%`, `%${query}%`, `%${query}%`, query);
                break;
        }

        sql += ' ORDER BY item_name LIMIT 20';

        const [medicines] = await db.promise().execute(sql, params);

        res.json({
            success: true,
            medicines: medicines
        });

    } catch (error) {
        console.error('Search medicines error:', error);
        res.status(500).json({
            success: false,
            message: 'Error searching medicines'
        });
    }
});

// Search medicine by barcode
router.get('/search-by-barcode', async (req, res) => {
    try {
        const { barcode } = req.query;
        
        if (!barcode) {
            return res.status(400).json({
                success: false,
                message: 'Barcode is required'
            });
        }

        const [medicines] = await db.promise().execute(
            `SELECT 
                id, item_name, item_desc, manufacturer, 
                batch_number, expiry_date, mfg_date,
                quantity, free_quantity, rate, mrp, 
                location, barcode, barcode_printed
            FROM import_stock_detail 
            WHERE barcode = ? AND quantity > 0`,
            [barcode]
        );

        if (medicines.length > 0) {
            res.json({
                success: true,
                medicine: medicines[0]
            });
        } else {
            res.json({
                success: false,
                message: 'Medicine not found for this barcode'
            });
        }
    } catch (error) {
        console.error('Barcode search error:', error);
        res.status(500).json({
            success: false,
            message: 'Error searching by barcode'
        });
    }
});

// Save transaction endpoint
router.post('/save-transaction', async (req, res) => {
    const { customer, items, summary, paymentMethod } = req.body;
    
    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        console.log('Processing transaction with data:', {
            customer,
            itemsCount: items.length,
            summary,
            paymentMethod
        });

        // 1. Handle customer (optional)
        let customerId = null;
        
        if (customer && (customer.mobile || customer.name)) {
            const cleanMobile = customer.mobile ? customer.mobile.trim() : null;
            const cleanName = customer.name ? customer.name.trim() : null;

            if (cleanMobile) {
                // Check if customer exists with this mobile
                const [existingCustomer] = await connection.execute(
                    'SELECT id FROM customerDetails WHERE mobile_no = ?',
                    [cleanMobile]
                );

                if (existingCustomer.length > 0) {
                    customerId = existingCustomer[0].id;
                    // Update customer name if provided
                    if (cleanName) {
                        await connection.execute(
                            'UPDATE customerDetails SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                            [cleanName, customerId]
                        );
                    }
                } else {
                    // Create new customer
                    const [customerResult] = await connection.execute(
                        'INSERT INTO customerDetails (mobile_no, name) VALUES (?, ?)',
                        [cleanMobile, cleanName]
                    );
                    customerId = customerResult.insertId;
                    console.log('Created new customer with ID:', customerId);
                }
            } else if (cleanName) {
                // Create customer with only name (no mobile)
                const [customerResult] = await connection.execute(
                    'INSERT INTO customerDetails (name) VALUES (?)',
                    [cleanName]
                );
                customerId = customerResult.insertId;
                console.log('Created new customer with name only, ID:', customerId);
            }
        }

        // Fallback to Walk-in Customer if no customer identified
        if (!customerId) {
            const [walkIn] = await connection.execute("SELECT id FROM customerDetails WHERE mobile_no = '0000000000'");
            if (walkIn.length > 0) {
                customerId = walkIn[0].id;
            } else {
                const [res] = await connection.execute("INSERT INTO customerDetails (name, mobile_no) VALUES ('Walk-in Customer', '0000000000')");
                customerId = res.insertId;
            }
             console.log('Assigned to Walk-in Customer ID:', customerId);
        }

        // 2. Create transaction record
        const billNumber = generateBillNumber();
        console.log('Generated bill number:', billNumber);

        const [transactionResult] = await connection.execute(
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
                'PHARM-1001', // In production, get from session/auth
                customer && customer.mobile ? customer.mobile.trim() : null,
                customer && customer.name ? customer.name.trim() : null
            ]
        );
        const transactionId = transactionResult.insertId;
        console.log('Created transaction with ID:', transactionId);

        // 3. Save transaction items and update stock
        let stockUpdateErrors = [];
        
        for (const item of items) {
            console.log('Processing item:', {
                name: item.item_name,
                stock_detail_id: item.stock_detail_id,
                quantity: item.quantity,
                is_manual: item.is_manual
            });

            // Insert transaction item
            await connection.execute(
                `INSERT INTO transaction_items 
                (transaction_id, stock_detail_id, item_name, item_description, mrp, selling_price, quantity, total_price, location, is_manual) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                    item.is_manual || false
                ]
            );

            // Update stock for non-manual items with valid stock_detail_id
            if (!item.is_manual && item.stock_detail_id) {
                try {
                    const [updateResult] = await connection.execute(
                        'UPDATE import_stock_detail SET quantity = quantity - ? WHERE id = ? AND quantity >= ?',
                        [item.quantity, item.stock_detail_id, item.quantity]
                    );

                    if (updateResult.affectedRows === 0) {
                        stockUpdateErrors.push({
                            item: item.item_name,
                            reason: 'Insufficient stock or item not found'
                        });
                        console.warn(`Stock update failed for item ${item.item_name} (ID: ${item.stock_detail_id})`);
                    } else {
                        console.log(`Stock updated for item ${item.item_name}, reduced by ${item.quantity}`);
                    }
                } catch (stockError) {
                    stockUpdateErrors.push({
                        item: item.item_name,
                        reason: stockError.message
                    });
                    console.error(`Stock update error for ${item.item_name}:`, stockError);
                }
            }
        }

        await connection.commit();
        console.log('Transaction committed successfully');

        // Prepare response
        const response = {
            success: true,
            transactionId: transactionId,
            billNumber: billNumber,
            message: 'Transaction saved successfully'
        };

        // Add stock update warnings if any
        if (stockUpdateErrors.length > 0) {
            response.warnings = stockUpdateErrors;
            response.message += ' with some stock update warnings';
        }

        res.json(response);

    } catch (error) {
        if (connection) {
            await connection.rollback();
            console.log('Transaction rolled back due to error');
        }
        console.error('Transaction save error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save transaction: ' + error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// Send WhatsApp bill
router.post('/send-whatsapp-bill', async (req, res) => {
    try {
        const { customer, items, summary, transactionId } = req.body;
        
        // For now, we'll just mark it as sent without actual WhatsApp integration
        // In production, integrate with WhatsApp Business API, Twilio, or other service
        
        if (transactionId) {
            await db.promise().execute(
                'UPDATE transactions SET whatsapp_sent = TRUE WHERE id = ?',
                [transactionId]
            );
        }

        // Simulate bill content generation
        const billContent = {
            customer: customer,
            items: items,
            summary: summary,
            timestamp: new Date().toISOString()
        };

        console.log('WhatsApp bill content:', billContent);

        // In a real implementation, you would:
        // 1. Generate a PDF bill
        // 2. Send via WhatsApp API to customer.mobile
        // 3. Handle success/failure responses

        res.json({
            success: true,
            message: 'WhatsApp bill sent successfully (simulated)',
            billContent: billContent
        });

    } catch (error) {
        console.error('WhatsApp bill error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send WhatsApp bill: ' + error.message
        });
    }
});

// Get transaction by ID
router.get('/transaction/:id', async (req, res) => {
    try {
        const [transactions] = await db.promise().execute(
            `SELECT 
                t.*, 
                c.mobile_no, 
                c.name as customer_name 
             FROM transactions t 
             LEFT JOIN customerDetails c ON t.customer_id = c.id 
             WHERE t.id = ?`,
            [req.params.id]
        );

        if (transactions.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Transaction not found' 
            });
        }

        const [items] = await db.promise().execute(
            `SELECT * FROM transaction_items WHERE transaction_id = ?`,
            [req.params.id]
        );

        res.json({
            success: true,
            transaction: transactions[0],
            items: items
        });

    } catch (error) {
        console.error('Get transaction error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch transaction' 
        });
    }
});

// Get transactions with pagination and filters
router.get('/transactions', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 20, 
            startDate, 
            endDate, 
            customerMobile,
            billNumber 
        } = req.query;

        const offset = (page - 1) * limit;
        let whereConditions = [];
        let params = [];

        if (startDate) {
            whereConditions.push('DATE(t.transaction_date) >= ?');
            params.push(startDate);
        }

        if (endDate) {
            whereConditions.push('DATE(t.transaction_date) <= ?');
            params.push(endDate);
        }

        if (customerMobile) {
            whereConditions.push('(t.customer_mobile LIKE ? OR c.mobile_no LIKE ?)');
            params.push(`%${customerMobile}%`, `%${customerMobile}%`);
        }

        if (billNumber) {
            whereConditions.push('t.bill_number LIKE ?');
            params.push(`%${billNumber}%`);
        }

        const whereClause = whereConditions.length > 0 
            ? 'WHERE ' + whereConditions.join(' AND ')
            : '';

        // Get total count
        const [countResult] = await db.promise().execute(
            `SELECT COUNT(*) as total 
             FROM transactions t 
             LEFT JOIN customerDetails c ON t.customer_id = c.id 
             ${whereClause}`,
            params
        );

        // Get transactions
        const [transactions] = await db.promise().execute(
            `SELECT 
                t.*,
                c.mobile_no,
                c.name as customer_name
             FROM transactions t 
             LEFT JOIN customerDetails c ON t.customer_id = c.id 
             ${whereClause}
             ORDER BY t.transaction_date DESC 
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );

        res.json({
            success: true,
            transactions: transactions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult[0].total,
                totalPages: Math.ceil(countResult[0].total / limit)
            }
        });

    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch transactions' 
        });
    }
});

// Get transaction summary for dashboard
router.get('/transaction-summary', async (req, res) => {
    try {
        const { period = 'today' } = req.query; // today, week, month, year
        
        let dateFilter = '';
        let params = [];

        switch (period) {
            case 'today':
                dateFilter = 'DATE(transaction_date) = CURDATE()';
                break;
            case 'week':
                dateFilter = 'YEARWEEK(transaction_date) = YEARWEEK(CURDATE())';
                break;
            case 'month':
                dateFilter = 'YEAR(transaction_date) = YEAR(CURDATE()) AND MONTH(transaction_date) = MONTH(CURDATE())';
                break;
            case 'year':
                dateFilter = 'YEAR(transaction_date) = YEAR(CURDATE())';
                break;
            default:
                dateFilter = 'DATE(transaction_date) = CURDATE()';
        }

        const [summary] = await db.promise().execute(
            `SELECT 
                COUNT(*) as total_transactions,
                SUM(total_amount) as total_revenue,
                AVG(total_amount) as average_transaction,
                MIN(transaction_date) as first_transaction,
                MAX(transaction_date) as last_transaction
             FROM transactions 
             WHERE ${dateFilter} AND status = 'completed'`,
            params
        );

        const [paymentMethods] = await db.promise().execute(
            `SELECT 
                payment_method,
                COUNT(*) as count,
                SUM(total_amount) as amount
             FROM transactions 
             WHERE ${dateFilter} AND status = 'completed'
             GROUP BY payment_method`,
            params
        );

        res.json({
            success: true,
            summary: summary[0],
            paymentMethods: paymentMethods,
            period: period
        });

    } catch (error) {
        console.error('Transaction summary error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch transaction summary' 
        });
    }
});

// Cancel transaction
router.post('/transaction/:id/cancel', async (req, res) => {
    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        // Get transaction items first
        const [items] = await connection.execute(
            'SELECT * FROM transaction_items WHERE transaction_id = ?',
            [req.params.id]
        );

        // Restore stock for non-manual items
        for (const item of items) {
            if (!item.is_manual && item.stock_detail_id) {
                await connection.execute(
                    'UPDATE import_stock_detail SET quantity = quantity + ? WHERE id = ?',
                    [item.quantity, item.stock_detail_id]
                );
            }
        }

        // Mark transaction as cancelled
        await connection.execute(
            'UPDATE transactions SET status = "cancelled" WHERE id = ?',
            [req.params.id]
        );

        await connection.commit();

        res.json({
            success: true,
            message: 'Transaction cancelled successfully'
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Cancel transaction error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to cancel transaction' 
        });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;