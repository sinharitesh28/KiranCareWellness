const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');

// Get Telegram Bot Info
router.get('/bot-info', (req, res) => {
    res.json({ 
        success: true, 
        username: process.env.TELEGRAM_BOT_USERNAME || 'KiranCareBot' // Fallback or from env
    });
});

// Get all customers with their last 3 transactions
router.get('/', requireAuth, async (req, res) => {
    try {
        // Fetch all customers
        const [customers] = await db.promise().execute(`
            SELECT 
                c.id, 
                c.name, 
                c.mobile_no, 
                c.email, 
                c.created_at,
                COUNT(t.id) as total_orders,
                SUM(t.total_amount) as total_spent
            FROM customerDetails c
            LEFT JOIN transactions t ON c.id = t.customer_id
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `);

        // For each customer, fetch last 3 orders
        // This could be optimized, but for now, simple loop is fine for moderate data
        const customersWithOrders = await Promise.all(customers.map(async (customer) => {
            const [orders] = await db.promise().execute(`
                SELECT 
                    id, 
                    bill_number, 
                    total_amount, 
                    transaction_date 
                FROM transactions 
                WHERE customer_id = ? 
                ORDER BY transaction_date DESC 
                LIMIT 3
            `, [customer.id]);

            return {
                ...customer,
                last_orders: orders
            };
        }));

        res.json({
            success: true,
            customers: customersWithOrders
        });

    } catch (error) {
        console.error('Error fetching customers:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch customer data' 
        });
    }
});

module.exports = router;