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

// Get all customers with their last 3 transactions (Optimized single query)
router.get('/', requireAuth, async (req, res) => {
    try {
        // Step 1: Fetch all customers with their aggregate totals
        const [customers] = await db.promise().execute(`
            SELECT 
                c.id, c.name, c.mobile_no, c.email, c.created_at,
                COUNT(t.id) as total_orders,
                SUM(COALESCE(t.total_amount, 0)) as total_spent
            FROM customerDetails c
            LEFT JOIN transactions t ON c.id = t.customer_id
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `);

        if (customers.length === 0) return res.json({ success: true, customers: [] });

        // Step 2: Fetch last 3 orders for ALL customers in one batch using window functions
        const [allRecentOrders] = await db.promise().execute(`
            WITH RankedOrders AS (
                SELECT 
                    customer_id, id, bill_number, total_amount, transaction_date,
                    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY transaction_date DESC) as rn
                FROM transactions
            )
            SELECT * FROM RankedOrders WHERE rn <= 3
        `);

        // Step 3: Map orders to their respective customers
        const ordersMap = allRecentOrders.reduce((acc, order) => {
            if (!acc[order.customer_id]) acc[order.customer_id] = [];
            acc[order.customer_id].push(order);
            return acc;
        }, {});

        const customersWithOrders = customers.map(c => ({
            ...c,
            last_orders: ordersMap[c.id] || []
        }));

        res.json({ success: true, customers: customersWithOrders });

    } catch (error) {
        console.error('Error fetching customers:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch customer data' });
    }
});

module.exports = router;