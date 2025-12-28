const db = require('../db');
const cron = require('node-cron');

const cleanupDrafts = () => {
    // Run every minute
    cron.schedule('* * * * *', async () => {
        let connection;
        try {
            connection = await db.promise().getConnection();
            await connection.beginTransaction();

            // 1. Find expired drafts (pending > 15 minutes)
            const [expiredDrafts] = await connection.execute(
                `SELECT id, bill_number FROM transactions 
                 WHERE status = 'pending' 
                 AND transaction_date < (NOW() - INTERVAL 15 MINUTE)`
            );

            if (expiredDrafts.length === 0) {
                await connection.rollback();
                connection.release();
                return;
            }

            console.log(`[Draft Cleanup] Found ${expiredDrafts.length} expired drafts.`);

            for (const draft of expiredDrafts) {
                // 2. Return stock
                // Get items for this transaction
                const [items] = await connection.execute(
                    'SELECT stock_detail_id, quantity FROM transaction_items WHERE transaction_id = ?',
                    [draft.id]
                );

                for (const item of items) {
                    if (item.stock_detail_id) {
                        await connection.execute(
                            'UPDATE import_stock_detail SET quantity = quantity + ? WHERE id = ?',
                            [item.quantity, item.stock_detail_id]
                        );
                    }
                }

                // 3. Mark transaction as expired (or cancelled)
                await connection.execute(
                    "UPDATE transactions SET status = 'cancelled' WHERE id = ?",
                    [draft.id]
                );
                
                console.log(`[Draft Cleanup] Expired draft ${draft.bill_number} (ID: ${draft.id}). Stock returned.`);
            }

            await connection.commit();

        } catch (error) {
            console.error('[Draft Cleanup] Error:', error);
            if (connection) await connection.rollback();
        } finally {
            if (connection) connection.release();
        }
    });
    
    console.log('[Cron] Draft cleanup job scheduled (every minute).');
};

module.exports = cleanupDrafts;
