// server/bot/handlers/auth.js
const db = require('../../db');

module.exports = (bot) => {
    bot.start(async (ctx) => {
        const payload = ctx.startPayload; // "LINK_..." or "CUST_..."
        const chatId = String(ctx.from.id);

        if (!payload) {
            return ctx.reply(
                '👋 *Welcome to Kiran Care Wellness Bot!*\n\n' +
                'This bot helps staff dispense medicines and customers receive updates.\n\n' +
                '*How to Search:*',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🔍 Search Stock (Dynamic)', switch_inline_query_current_chat: '' }
                            ],
                            [
                                { text: '🛒 View Cart', callback_data: 'view_cart_cmd' } // Helper to trigger bill command
                            ]
                        ]
                    }
                }
            );
        }

        // 1. Staff Linking: LINK_{EmployeeCode}_{Secret} (Secret not impl in DB yet, using EmployeeCode for MVP)
        if (payload.startsWith('LINK_')) {
            const [_, empCode, secret] = payload.split('_');

            // Security: In production, verify 'secret' against a temporary token stored in Redis/DB with expiry.
            // For MVP: We assume if they have the link generated from their logged-in session, it's valid.

            try {
                // Check if employee exists
                const [emp] = await db.promise().execute('SELECT code, name FROM employeedetails WHERE code = ?', [empCode]);

                if (emp.length === 0) {
                    return ctx.reply('Invalid Staff Link. Employee not found.');
                }

                // Update DB
                await db.promise().execute(
                    'UPDATE employeedetails SET telegram_chat_id = ? WHERE code = ?',
                    [chatId, empCode]
                );

                ctx.reply(`✅ Welcome ${emp[0].name}! You are now successfully linked as Staff.\nYou can now use /search or Inline Mode (@BotName item) to dispense.`);
            } catch (err) {
                console.error('Staff Link Error:', err);
                ctx.reply('Failed to link staff account.');
            }
            return;
        }

        // 2. Customer Linking: CUST_{CustomerId}
        if (payload.startsWith('CUST_')) {
            const customerId = payload.replace('CUST_', '');

            try {
                const [cust] = await db.promise().execute('SELECT id, name FROM customerDetails WHERE id = ?', [customerId]);

                if (cust.length === 0) {
                    return ctx.reply('Invalid Customer Link.');
                }

                // Update DB
                await db.promise().execute(
                    'UPDATE customerDetails SET telegram_chat_id = ? WHERE id = ?',
                    [chatId, customerId]
                );

                ctx.reply(`👋 Welcome to Kiran Care Wellness! Your account is now linked. You will receive digital bills and reminders here.`);

                // Optional: Check if there's a recent transaction to send specific bill immediately?
                // The flow says "Result: Customer instantly receives the current bill PDF".
                // We'll rely on the Staff triggering the bill or generic welcome for now.

            } catch (err) {
                console.error('Customer Link Error:', err);
                ctx.reply('Failed to link customer account.');
            }
            return;
        }

        ctx.reply('Unknown link format.');
    });

    // Fallback contact sharing for customers (Old method support)
    bot.on('contact', async (ctx) => {
        const contact = ctx.message.contact;
        if (!contact || !contact.phone_number) return;

        const cleanPhone = contact.phone_number.replace(/\D/g, '').slice(-10);
        const chatId = String(ctx.from.id);

        try {
            const [rows] = await db.promise().execute(
                'SELECT id, name FROM customerDetails WHERE mobile_no LIKE ?',
                [`%${cleanPhone}`]
            );

            if (rows.length > 0) {
                await db.promise().execute(
                    'UPDATE customerDetails SET telegram_chat_id = ? WHERE id = ?',
                    [chatId, rows[0].id]
                );
                ctx.reply(`👋 Welcome back ${rows[0].name}! Your account is re-linked.`);
            } else {
                ctx.reply("Could not find a customer profile with this number.");
            }
        } catch (err) {
            console.error('Contact Link Error:', err);
        }
    });
};
