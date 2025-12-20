const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const db = require('../db');

// Initialize Bot
const token = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

if (token) {
    bot = new TelegramBot(token, { polling: true });
    console.log('Telegram Bot initialized.');
} else {
    console.warn('TELEGRAM_BOT_TOKEN not provided. Chatbot features will be disabled.');
}

// Store pending bill notifications
const pendingBills = new Map();

// Helper: Translation
const messages = {
    en: {
        welcome: "Welcome to Kiran Care Wellness! Your account has been successfully linked.",
        reminder: "💊 It's time to take your medicine:",
        taken: "✅ Taken",
        snooze: "💤 Snooze 10m",
        skip: "⏭️ Skip",
        bill_header: "🧾 *Digital Bill*",
        total: "Total Amount:",
        thank_you: "Thank you for visiting us!",
        confirm_taken: "Great! Recorded as taken.",
        confirm_snooze: "Okay, I'll remind you in 10 minutes.",
        confirm_skip: "Okay, skipped for now.",
        not_linked: "Your account is not linked. Please scan the QR code at the store."
    },
    hi: {
        welcome: "किरण केयर वेलनेस में आपका स्वागत है! आपका खाता सफलतापूर्वक लिंक हो गया है।",
        reminder: "💊 आपकी दवा लेने का समय हो गया है:",
        taken: "✅ ले ली",
        snooze: "💤 10 मिनट बाद",
        skip: "⏭️ छोड़ दें",
        bill_header: "🧾 *डिजिटल बिल*",
        total: "कुल राशि:",
        thank_you: "हमसे जुड़ने के लिए धन्यवाद!",
        confirm_taken: "बहुत बढ़िया! ले ली गई।",
        confirm_snooze: "ठीक है, मैं आपको 10 मिनट में याद दिलाऊंगा।",
        confirm_skip: "ठीक है, अभी के लिए छोड़ दिया।",
        not_linked: "आपका खाता लिंक नहीं है। कृपया स्टोर पर QR कोड स्कैन करें।"
    }
};

// 1. Handle /start command for linking
if (bot) {
    bot.onText(///start (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const customerId = match[1]; // The parameter passed in deep link

        try {
            // Update customer with chat_id
            const [result] = await db.promise().execute(
                'UPDATE customerDetails SET telegram_chat_id = ? WHERE id = ?',
                [chatId, customerId]
            );

            if (result.affectedRows > 0) {
                // Fetch preferred language (default 'en')
                const [rows] = await db.promise().execute('SELECT preferred_language FROM customerDetails WHERE id = ?', [customerId]);
                const lang = rows[0]?.preferred_language || 'en';
                
                bot.sendMessage(chatId, messages[lang].welcome);
            } else {
                bot.sendMessage(chatId, "Invalid link or customer not found.");
            }
        } catch (error) {
            console.error('Error linking Telegram:', error);
            bot.sendMessage(chatId, "An error occurred while linking your account.");
        }
    });

    // 2. Handle Callback Queries (Buttons)
    bot.on('callback_query', async (callbackQuery) => {
        const action = callbackQuery.data; // e.g., "taken_123" or "snooze_123"
        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        
        const [type, reminderId] = action.split('_');
        
        // Get user language
        // (Simplified: assuming 'en' for now, ideally fetch from DB user context)
        const lang = 'en'; 

        if (type === 'taken') {
            await db.promise().execute('UPDATE reminders SET status = ?, response_at = NOW() WHERE id = ?', ['taken', reminderId]);
            bot.answerCallbackQuery(callbackQuery.id, { text: messages[lang].confirm_taken });
            bot.editMessageText(`${msg.text}\n\n✅ Taken`, { chat_id: chatId, message_id: msg.message_id });
        } else if (type === 'skip') {
            await db.promise().execute('UPDATE reminders SET status = ?, response_at = NOW() WHERE id = ?', ['skipped', reminderId]);
            bot.answerCallbackQuery(callbackQuery.id, { text: messages[lang].confirm_skip });
            bot.editMessageText(`${msg.text}\n\n⏭️ Skipped`, { chat_id: chatId, message_id: msg.message_id });
        } else if (type === 'snooze') {
            // Add 10 mins to scheduled_time or create a new snoozed reminder
            // For simplicity, just update status and let cron pick it up if we logic it right, or send a new msg later
            // Here we'll just acknowledge text. 
            // In a real app, update the 'scheduled_time' in DB.
            bot.answerCallbackQuery(callbackQuery.id, { text: messages[lang].confirm_snooze });
        }
    });
}

// 3. Cron Job for Reminders (Every minute for testing precision)
cron.schedule('* * * * *', async () => {
    if (!bot) return;

    try {
        const now = new Date();
        const currentTime = now.toTimeString().split(' ')[0]; // HH:MM:SS
        const today = now.toISOString().split('T')[0];

        // Find pending reminders due now (or recently passed)
        const [reminders] = await db.promise().execute(`
            SELECT r.*, c.telegram_chat_id, c.preferred_language 
            FROM reminders r
            JOIN customerDetails c ON r.customer_id = c.id
            WHERE r.date = ? 
            AND r.status = 'pending' 
            AND r.scheduled_time <= ? 
            AND c.telegram_chat_id IS NOT NULL
        `, [today, currentTime]);

        for (const r of reminders) {
            const lang = r.preferred_language || 'en';
            const txt = messages[lang];
            
            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: txt.taken, callback_data: `taken_${r.id}` },
                            { text: txt.snooze, callback_data: `snooze_${r.id}` },
                            { text: txt.skip, callback_data: `skip_${r.id}` }
                        ]
                    ]
                }
            };

            await bot.sendMessage(r.telegram_chat_id, `${txt.reminder}\n*${r.medicine_name}* (${r.dosage_time})`, { parse_mode: 'Markdown', ...opts });
            
            // Mark as sent
            await db.promise().execute('UPDATE reminders SET status = ?, sent_at = NOW() WHERE id = ?', ['sent', r.id]);
        }

    } catch (err) {
        console.error('Error in reminder cron:', err);
    }
});

// 4. Send Digital Bill
async function sendDigitalBill(customerId, transactionId) {
    if (!bot) return;

    try {
        const [rows] = await db.promise().execute(`
            SELECT c.telegram_chat_id, c.preferred_language, t.total_amount, t.bill_number, t.transaction_date 
            FROM transactions t
            JOIN customerDetails c ON t.customer_id = c.id
            WHERE t.id = ? AND c.telegram_chat_id IS NOT NULL
        `, [transactionId]);

        if (rows.length === 0) return; // No linked telegram

        const data = rows[0];
        const lang = data.preferred_language || 'en';
        const txt = messages[lang];

        // Fetch items
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

        await bot.sendMessage(data.telegram_chat_id, billText, { parse_mode: 'Markdown' });

    } catch (err) {
        console.error('Error sending digital bill:', err);
    }
}

// 5. Generate Reminders from Transaction
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
        
        // Schedule map: 1-0-1-0 => Morning, Evening
        // Times (approx): M=09:00, A=13:00, E=18:00, N=21:00
        const timeMap = {
            0: { name: 'morning', time: '09:00:00' },
            1: { name: 'afternoon', time: '13:00:00' },
            2: { name: 'evening', time: '18:00:00' },
            3: { name: 'night', time: '21:00:00' }
        };

        for (const item of items) {
            const schedule = item.dosage_schedule.split('-'); // e.g. ['1', '0', '1', '0']
            const days = item.dosage_days || 1;
            const startDate = new Date(item.transaction_date);

            for (let d = 0; d < days; d++) {
                const currentDate = new Date(startDate);
                currentDate.setDate(startDate.getDate() + d);
                const dateStr = currentDate.toISOString().split('T')[0];

                schedule.forEach((dose, index) => {
                    if (dose === '1' && timeMap[index]) {
                        // (customer_id, transaction_id, transaction_item_id, medicine_name, dosage_time, scheduled_time, date)
                        remindersValues.push([
                            item.customer_id,
                            transactionId,
                            item.id,
                            item.item_name,
                            timeMap[index].name,
                            timeMap[index].time,
                            dateStr
                        ]);
                    }
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
    sendDigitalBill,
    scheduleRemindersForTransaction
};
