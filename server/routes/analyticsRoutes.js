const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const dayjs = require('dayjs');

// Helper to get date range conditions
function getDateCondition(period, customStart, customEnd) {
    let dateCondition = '';
    let params = [];
    
    if (period === '15days') {
        dateCondition = 'AND t.transaction_date >= ?';
        params.push(dayjs().subtract(15, 'day').startOf('day').format('YYYY-MM-DD HH:mm:ss'));
    } else if (period === '1month') {
        dateCondition = 'AND t.transaction_date >= ?';
        params.push(dayjs().subtract(1, 'month').startOf('day').format('YYYY-MM-DD HH:mm:ss'));
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
        // Optimized ABC Analysis using a window function to find the last rate 
        // and standard aggregation for unit counts.
        const abcSql = `
            WITH LastRates AS (
                SELECT 
                    item_name, 
                    rate,
                    ROW_NUMBER() OVER (PARTITION BY item_name ORDER BY id DESC) as rn
                FROM import_stock_detail
            )
            SELECT 
                d.item_name,
                SUM(d.quantity) as unit_count,
                lr.rate as last_import_rate
            FROM import_stock_detail d
            LEFT JOIN LastRates lr ON d.item_name = lr.item_name AND lr.rn = 1
            GROUP BY d.item_name, lr.rate
            HAVING unit_count > 0
            ORDER BY unit_count DESC
        `;

        const [results] = await db.promise().query(abcSql);

        // Process data for classification
        let processedData = results.map(item => ({
            item_name: item.item_name,
            unit_count: parseFloat(item.unit_count) || 0,
            unit_rate: parseFloat(item.last_import_rate) || 0,
            inventory_value: (parseFloat(item.unit_count) || 0) * (parseFloat(item.last_import_rate) || 0)
        }));

        // Sort by Inventory Value DESC for ABC logic
        processedData.sort((a, b) => b.inventory_value - a.inventory_value);

        const totalValue = processedData.reduce((sum, item) => sum + item.inventory_value, 0);
        let accumulatedValue = 0;
        
        const classifiedData = processedData.map(item => {
            accumulatedValue += item.inventory_value;
            const percentage = totalValue > 0 ? (item.inventory_value / totalValue) * 100 : 0;
            const cumulativePercentage = totalValue > 0 ? (accumulatedValue / totalValue) * 100 : 0;
            
            let category = 'C';
            if (cumulativePercentage <= 70) category = 'A';
            else if (cumulativePercentage <= 90) category = 'B';
            
            return {
                ...item,
                value: item.inventory_value,
                percentage: percentage,
                cumulative_percentage: cumulativePercentage,
                category: category
            };
        });

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

// 4. Delete Stock Item (for housekeeping 0 qty items)
router.delete('/stock-item/:itemName', requireAuth, async (req, res) => {
    const itemName = req.params.itemName;
    
    if (!itemName) {
        return res.status(400).json({ success: false, error: 'Item name is required' });
    }

    try {
        // Verify if the item has 0 quantity before deleting
        const checkSql = `
            SELECT SUM(quantity) as total_qty 
            FROM import_stock_detail 
            WHERE item_name = ?
        `;
        const [checkResult] = await db.promise().query(checkSql, [itemName]);
        const totalQty = checkResult[0].total_qty || 0;

        if (totalQty > 0) {
            return res.status(400).json({ success: false, error: 'Cannot delete item with positive stock quantity.' });
        }

        const deleteSql = 'DELETE FROM import_stock_detail WHERE item_name = ?';
        await db.promise().query(deleteSql, [itemName]);

        res.json({ success: true, message: `Item '${itemName}' deleted successfully.` });
    } catch (err) {
        console.error('Error deleting stock item:', err);
        res.status(500).json({ success: false, error: 'Database error deleting item.' });
    }
});

module.exports = router;