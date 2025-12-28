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
        // We ignore date filters for Inventory ABC Analysis as it's a snapshot of CURRENT stock
        // Logic: 
        // 1. Get current Quantity (Unit Count) for each item
        // 2. Get Last Import Rate (Cost Price)
        // 3. Calculate Value = Quantity * Last Rate
        
        const abcSql = `
            SELECT 
                d.item_name,
                SUM(d.quantity) as unit_count,
                (
                    SELECT d2.rate
                    FROM import_stock_detail d2
                    JOIN import_stock_master m2 ON d2.master_id = m2.id
                    WHERE d2.item_name = d.item_name
                    ORDER BY m2.import_date DESC, d2.id DESC
                    LIMIT 1
                ) as last_import_rate
            FROM import_stock_detail d
            GROUP BY d.item_name
            ORDER BY unit_count DESC
        `;

        const [results] = await db.promise().query(abcSql);

        // Process data
        let processedData = results.map(item => {
            const count = parseFloat(item.unit_count) || 0;
            const rate = parseFloat(item.last_import_rate) || 0;
            const value = count * rate;
            
            return {
                item_name: item.item_name,
                unit_count: count,
                last_import_rate: rate,
                inventory_value: value
            };
        });

        // Filter out negative stock if any (optional, but good for safety)
        // processedData = processedData.filter(i => i.unit_count >= 0);

        // Sort by Inventory Value DESC
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
                item_name: item.item_name,
                unit_count: item.unit_count,
                unit_rate: item.last_import_rate,
                value: item.inventory_value, // Total Inventory Value
                percentage: percentage,
                cumulative_percentage: cumulativePercentage,
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