// server/services/telegramService.js
const bot = require('../bot/bot');
const cron = require('node-cron');
const db = require('../db');

// Load Handlers
if (bot) {
    require('../bot/handlers/auth')(bot);
    // require('../bot/handlers/search')(bot); // Inline query handler
    require('../bot/handlers/search')(bot);
    require('../bot/handlers/cart')(bot);

    // Graceful stop setup
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

const launchBot = async () => {
    if (bot) {
        try {
            await bot.launch();
            console.log('Telegram Bot Launched successfully!');
        } catch (err) {
            console.error('Failed to launch bot:', err);
        }
    }
};

// Store pending bill notifications
const pendingBills = new Map();

// Helper: Translation
const messages = {
    en: {
        reminder: "💊 It's time to take your medicine:",
        taken: "✅ Taken",
        snooze: "💤 Snooze 10m",
        skip: "⏭️ Skip",
        bill_header: "🧾 *Digital Bill*",
        total: "Total Amount:",
        thank_you: "Thank you for visiting us!",
    },
    hi: {
        reminder: "💊 आपकी दवा लेने का समय हो गया है:",
        taken: "✅ ले ली",
        snooze: "💤 10 मिनट बाद",
        skip: "⏭️ छोड़ दें",
        bill_header: "🧾 *डिजिटल बिल*",
        total: "कुल राशि:",
        thank_you: "हमसे जुड़ने के लिए धन्यवाद!",
    }
};

// Cron Job for Reminders
cron.schedule('* * * * *', async () => {
    if (!bot) return;

    try {
        const now = new Date();
        const currentTime = now.getHours().toString().padStart(2, '0') + ':' +
            now.getMinutes().toString().padStart(2, '0') + ':' +
            now.getSeconds().toString().padStart(2, '0');

        const [reminders] = await db.promise().execute(`
            SELECT r.*, c.telegram_chat_id, c.preferred_language 
            FROM reminders r
            JOIN customerDetails c ON r.customer_id = c.id
            WHERE r.date = CURDATE()
            AND r.status = 'pending' 
            AND r.scheduled_time <= CURTIME()
            AND c.telegram_chat_id IS NOT NULL
        `);

        for (const r of reminders) {
            const lang = r.preferred_language || 'en';
            const txt = messages[lang];

            try {
                // Telegraf API: telegram.sendMessage
                await bot.telegram.sendMessage(r.telegram_chat_id, `${txt.reminder}\n*${r.medicine_name}* (${r.dosage_time})`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: txt.taken, callback_data: `rem_taken_${r.id}` },
                                { text: txt.snooze, callback_data: `rem_snooze_${r.id}` },
                                { text: txt.skip, callback_data: `rem_skip_${r.id}` }
                            ]
                        ]
                    }
                });

                await db.promise().execute('UPDATE reminders SET status = ?, sent_at = NOW() WHERE id = ?', ['sent', r.id]);
            } catch (sendErr) {
                console.error(`[Cron] Failed to send reminder ${r.id}:`, sendErr.message);
            }
        }
    } catch (err) {
        console.error('Error in reminder cron:', err);
    }
});

// Handle Reminder Callbacks (Defined here or in a handler file? Let's add listener here for legacy/cron features)
if (bot) {
    bot.action(/rem_(taken|snooze|skip)_(\d+)/, async (ctx) => {
        const action = ctx.match[1];
        const remId = ctx.match[2];

        let status = 'pending';
        let replyText = 'Updated.';

        if (action === 'taken') {
            status = 'taken';
            replyText = messages.en.taken; // Simplified lang support for now
        } else if (action === 'skip') {
            status = 'skipped';
            replyText = messages.en.skip;
        } else if (action === 'snooze') {
            // Just ack
            return ctx.answerCbQuery('Snoozed for 10 min');
        }

        if (status !== 'pending') {
            await db.promise().execute('UPDATE reminders SET status = ?, response_at = NOW() WHERE id = ?', [status, remId]);
            await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n${replyText}`);
        }
        ctx.answerCbQuery();
    });
}
// 5. Send Digital Bill
async function sendDigitalBill(customerId, transactionId) {
    if (!bot) return;

    try {
        const [rows] = await db.promise().execute(`
            SELECT c.telegram_chat_id, c.preferred_language, t.total_amount, t.bill_number 
            FROM transactions t
            JOIN customerDetails c ON t.customer_id = c.id
            WHERE t.id = ? AND c.telegram_chat_id IS NOT NULL
        `, [transactionId]);

        if (rows.length === 0) return;

        const data = rows[0];
        const lang = data.preferred_language || 'en';
        const txt = messages[lang];

        const [items] = await db.promise().execute(`
            SELECT item_name, quantity, total_price 
            FROM transaction_items 
            WHERE transaction_id = ?
        `, [transactionId]);

        let billText = `${txt.bill_header}\nBill #${data.bill_number}\n\n`;
        items.forEach(item => {
            billText += `- ${item.item_name} x${item.quantity}: ₹${item.total_price}\n`;
        });
        billText += `\n*${txt.total} ₹${data.total_amount}*`;
        billText += `\n\n${txt.thank_you}`;

        await bot.telegram.sendMessage(data.telegram_chat_id, billText, { parse_mode: 'Markdown' });

    } catch (err) {
        console.error('Error sending digital bill:', err);
    }
}

// 6. Generate Reminders from Transaction (Existing logic reused)
async function scheduleRemindersForTransaction(transactionId) {
    try {
        const [items] = await db.promise().execute(`
            SELECT ti.*, t.customer_id, t.transaction_date
            FROM transaction_items ti
            JOIN transactions t ON ti.transaction_id = t.id
            WHERE ti.transaction_id = ? AND ti.dosage_schedule IS NOT NULL
        `, [transactionId]);

        if (items.length === 0) return;

        const remindersValues = [];

        for (const item of items) {
            if (!item.dosage_schedule) continue;

            const times = item.dosage_schedule.split(',').map(t => t.trim()).filter(t => t);
            const days = item.dosage_days || 1;
            const startDate = new Date(item.transaction_date);

            for (let d = 0; d < days; d++) {
                const currentDate = new Date(startDate);
                currentDate.setDate(startDate.getDate() + d);

                const year = currentDate.getFullYear();
                const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
                const day = currentDate.getDate().toString().padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;

                times.forEach(rawTime => {
                    let time = rawTime.trim();
                    let hours, minutes;

                    if (/^\d{1,2}:\d{2}$/.test(time)) {
                        [hours, minutes] = time.split(':');
                    } else if (/^\d{1,2}$/.test(time)) {
                        hours = time;
                        minutes = '00';
                    } else {
                        return; // Skip invalid formats
                    }

                    // Pad hours and minutes
                    hours = hours.padStart(2, '0');
                    minutes = minutes.padStart(2, '0');
                    
                    const formattedTime = `${hours}:${minutes}`;
                    const scheduledTime = `${formattedTime}:00`;

                    remindersValues.push([
                        item.customer_id,
                        transactionId,
                        item.id,
                        item.item_name,
                        formattedTime, // dosage_time (HH:MM)
                        scheduledTime, // scheduled_time (HH:MM:SS)
                        dateStr
                    ]);
                });
            }
        }

        if (remindersValues.length > 0) {
            await db.promise().query(
                `INSERT INTO reminders 
                (customer_id, transaction_id, transaction_item_id, medicine_name, dosage_time, scheduled_time, date) 
                VALUES ?`,
                [remindersValues]
            );
            console.log(`Scheduled ${remindersValues.length} reminders.`);
        }

    } catch (err) {
        console.error('Error generating reminders:', err);
    }
}

module.exports = {
    bot,
    launchBot,
    sendDigitalBill,
    scheduleRemindersForTransaction
};
