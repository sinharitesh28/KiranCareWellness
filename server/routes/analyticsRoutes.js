const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');

// Helper to get date range conditions
function getDateCondition(period, customStart, customEnd) {
    let dateCondition = '';
    let params = [];
    
    const today = new Date();
    
    if (period === '15days') {
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - 15);
        dateCondition = 'AND t.transaction_date >= ?';
        params.push(pastDate.toISOString().split('T')[0]);
    } else if (period === '1month') {
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - 30);
        dateCondition = 'AND t.transaction_date >= ?';
        params.push(pastDate.toISOString().split('T')[0]);
    } else if (period === 'custom' && customStart && customEnd) {
        dateCondition = 'AND DATE(t.transaction_date) BETWEEN ? AND ?';
        params.push(customStart, customEnd);
    }

    return { dateCondition, params };
}

// 1. Selling Reports
router.get('/sales', requireAuth, async (req, res) => {
    try {
        const { period, startDate, endDate } = req.query;
        const { dateCondition, params } = getDateCondition(period, startDate, endDate);

        // Graph Data: Sales over time
        const graphSql = `
            SELECT 
                DATE(t.transaction_date) as date,
                SUM(t.total_amount) as total_sales,
                COUNT(t.id) as transaction_count
            FROM transactions t
            WHERE t.status = 'completed' ${dateCondition}
            GROUP BY DATE(t.transaction_date)
            ORDER BY date ASC
        `;

        // Table Data: Sales by Item
        const tableSql = `
            SELECT 
                ti.item_name,
                SUM(ti.quantity) as total_quantity,
                SUM(ti.total_price) as total_revenue,
                AVG(ti.selling_price) as avg_price
            FROM transaction_items ti
            JOIN transactions t ON ti.transaction_id = t.id
            WHERE t.status = 'completed' ${dateCondition}
            GROUP BY ti.item_name
            ORDER BY total_revenue DESC
            LIMIT 100
        `;

        // Execute queries in parallel using db.promise()
        const [graphData] = await db.promise().query(graphSql, params);
        const [tableData] = await db.promise().query(tableSql, params);

        res.json({ success: true, graphData, tableData });
    } catch (err) {
        console.error('Error fetching sales report:', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// 2. Stock Status (Active/Inactive/Distributor)
router.get('/stock-status', requireAuth, async (req, res) => {
    try {
        // Active vs Inactive (Active = quantity > 0)
        // Also consider "Inactive" as items with 0 quantity but present in system
        const statusSql = `
            SELECT 
                SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) as active_count,
                SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END) as inactive_count,
                SUM(CASE WHEN quantity > 0 THEN quantity * rate ELSE 0 END) as active_value
            FROM import_stock_detail
        `;

        // Stock by Distributor (Vendor)
        // Need to join with master table to get vendor
        const distributorSql = `
            SELECT 
                m.vendor_name,
                COUNT(d.id) as item_count,
                SUM(d.quantity * d.rate) as total_value
            FROM import_stock_detail d
            JOIN import_stock_master m ON d.master_id = m.id
            WHERE d.quantity > 0
            GROUP BY m.vendor_name
            ORDER BY total_value DESC
        `;

        const [statusResults] = await db.promise().query(statusSql);
        const [distributorData] = await db.promise().query(distributorSql);

        res.json({ success: true, statusData: statusResults[0], distributorData });
    } catch (err) {
        console.error('Error fetching stock status:', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// 3. ABC Analysis
router.get('/abc-analysis', requireAuth, async (req, res) => {
    try {
        const { period, startDate, endDate } = req.query;
        const { dateCondition, params } = getDateCondition(period, startDate, endDate);

        // Calculate consumption value for each item
        // Using Sales Value (Revenue) for ABC Classification
        const abcSql = `
            SELECT 
                ti.item_name,
                SUM(ti.total_price) as consumption_value
            FROM transaction_items ti
            JOIN transactions t ON ti.transaction_id = t.id
            WHERE t.status = 'completed' ${dateCondition}
            GROUP BY ti.item_name
            ORDER BY consumption_value DESC
        `;

        const [results] = await db.promise().query(abcSql, params);

        // Perform ABC Classification logic
        const totalValue = results.reduce((sum, item) => sum + parseFloat(item.consumption_value), 0);
        let accumulatedValue = 0;
        
        const classifiedData = results.map(item => {
            const val = parseFloat(item.consumption_value);
            accumulatedValue += val;
            const percentage = (accumulatedValue / totalValue) * 100;
            
            let category = 'C';
            if (percentage <= 70) category = 'A';
            else if (percentage <= 90) category = 'B';
            
            return {
                item_name: item.item_name,
                value: val,
                percentage: (val / totalValue) * 100,
                category: category
            };
        });

        // Group summary for chart
        const summary = {
            A: classifiedData.filter(i => i.category === 'A').length,
            B: classifiedData.filter(i => i.category === 'B').length,
            C: classifiedData.filter(i => i.category === 'C').length
        };

        res.json({ success: true, data: classifiedData, summary });
    } catch (err) {
        console.error('Error fetching ABC data:', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

module.exports = router;