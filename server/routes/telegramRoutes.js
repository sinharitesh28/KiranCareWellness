const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { bot } = require('../services/telegramService');

// Configure Multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Helper to calculate adherence stats
const getAdherenceStats = async () => {
    // This query is complex. We need customers, their reminders, and the status.
    // Logic for "Non-Active": 4 consecutive 'sent' status without 'taken'/'skipped' response? 
    // Simplified Logic for MVP:
    // 1. Get all customers with Telegram ID.
    // 2. For each, count total reminders vs taken/skipped.
    // 3. Check last 4 reminders for non-response.

    // We'll fetching raw data and processing in JS for flexibility
    const [customers] = await db.promise().execute(`
        SELECT c.id, c.name, c.mobile_no, c.telegram_chat_id 
        FROM customerDetails c 
        WHERE c.telegram_chat_id IS NOT NULL
    `);

    const results = [];

    for (const customer of customers) {
        // Get reminders
        const [reminders] = await db.promise().execute(`
            SELECT status, scheduled_time, date, response_at, medicine_name
            FROM reminders 
            WHERE customer_id = ?
            ORDER BY date DESC, scheduled_time DESC
        `, [customer.id]);

        if (reminders.length === 0) continue;

        let totalReminders = reminders.length;
        let respondedCount = reminders.filter(r => ['taken', 'skipped', 'snoozed'].includes(r.status)).length;
        let responseRate = totalReminders > 0 ? (respondedCount / totalReminders) * 100 : 0;

        // Check last 4 reminders for "Non-Active"
        // If last 4 statuses are all 'sent' (and date is in past), then inactive.
        let isNonActive = false;
        if (reminders.length >= 4) {
            const last4 = reminders.slice(0, 4);
            const nonResponded = last4.filter(r => r.status === 'sent').length;
            if (nonResponded === 4) isNonActive = true;
        }

        // Check "Completed Dosage"
        // We probably need transaction_items info for therapy duration. 
        // For now, let's assume if responseRate > 80% and they have > 0 reminders.
        // Enhance: Check if their latest transaction items have "dosage_days" passed. 
        // This query joins transaction_items to see max end date.
        const [therapyInfo] = await db.promise().execute(`
            SELECT MAX(DATE_ADD(t.transaction_date, INTERVAL ti.dosage_days DAY)) as therapy_end_date
            FROM transaction_items ti
            JOIN transactions t ON ti.transaction_id = t.id
            WHERE t.customer_id = ?
        `, [customer.id]);

        let therapyEnded = false;
        if (therapyInfo[0].therapy_end_date) {
            therapyEnded = new Date() > new Date(therapyInfo[0].therapy_end_date);
        }

        let isCompletedDosage = therapyEnded && responseRate > 80;

        results.push({
            customerId: customer.id,
            name: customer.name || 'Unknown',
            mobile: customer.mobile_no,
            remindersSent: totalReminders,
            responseRate: responseRate.toFixed(1),
            lastActive: reminders.find(r => r.response_at)?.date || 'N/A',
            status: isNonActive ? 'Non-Active' : (isCompletedDosage ? 'Completed Dosage' : 'Active'),
            therapyEnded: therapyEnded
        });
    }

    return results;
};

// GET /api/telegram/info
router.get('/info', async (req, res) => {
    console.log('GET /api/telegram/info called.');
    
    // Debugging Bot State
    const botState = {
        isDefined: !!bot,
        hasTelegram: !!(bot && bot.telegram),
        hasGetMe: !!(bot && bot.telegram && typeof bot.telegram.getMe === 'function'),
        tokenPrefix: (bot && bot.telegram && bot.telegram.token) ? bot.telegram.token.substring(0, 5) : 'N/A'
    };
    console.log('Bot State Debug:', JSON.stringify(botState));

    if (!bot) return res.status(503).json({ error: 'Bot inactive', debug: botState });
    
    if (!bot.telegram || typeof bot.telegram.getMe !== 'function') {
        console.error('Bot instance is malformed:', bot);
        return res.status(500).json({ error: 'Bot instance malformed', debug: botState });
    }

    try {
        console.log('Calling bot.telegram.getMe()...');
        const me = await bot.telegram.getMe();
        console.log('Bot info retrieved successfully:', me.username);
        res.json({ username: me.username });
    } catch (error) {
        console.error('Error fetching bot info detailed:', error);
        
        const errorResponse = {
            error: 'Failed to fetch bot info',
            message: error.message,
            code: error.code,
            response: error.response ? {
                errorCode: error.response.error_code,
                description: error.response.description
            } : null,
            debug: botState
        };

        // If unauthorized, the token is invalid.
        if (error.response && error.response.error_code === 401) {
             return res.status(503).json({ ...errorResponse, error: 'Invalid Bot Token' });
        }
        res.status(500).json(errorResponse);
    }
});

// GET /api/telegram/adherence
router.get('/adherence', async (req, res) => {
    try {
        const stats = await getAdherenceStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching adherence:', error);
        res.status(500).json({ error: 'Failed to fetch adherence data' });
    }
});


// POST /api/telegram/broadcast
router.post('/broadcast', upload.single('image'), async (req, res) => {
    try {
        const { message } = req.body;
        const imageFile = req.file;

        if (!message && !imageFile) {
            return res.status(400).json({ error: 'Message or Image is required' });
        }

        if (!bot) {
            return res.status(503).json({ error: 'Telegram Bot not initialized' });
        }

        // Get all linked customers
        const [customers] = await db.promise().execute(`
            SELECT telegram_chat_id FROM customerDetails WHERE telegram_chat_id IS NOT NULL
        `);

        let sentCount = 0;
        for (const customer of customers) {
            try {
                if (imageFile) {
                    // Check file size (10MB limit for photos)
                    const stats = fs.statSync(imageFile.path);
                    const fileSizeInBytes = stats.size;
                    const fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);

                    if (fileSizeInMegabytes > 10) {
                        // Send as document if > 10MB
                        await bot.telegram.sendDocument(customer.telegram_chat_id, { source: imageFile.path }, { caption: message });
                    } else {
                        // Send as photo
                        await bot.telegram.sendPhoto(customer.telegram_chat_id, { source: imageFile.path }, { caption: message });
                    }
                } else {
                    await bot.telegram.sendMessage(customer.telegram_chat_id, message);
                }
                sentCount++;
            } catch (err) {
                console.error(`Failed to broadcast to ${customer.telegram_chat_id}:`, err.message);
            }
        }

        res.json({ success: true, sentCount, totalTargets: customers.length });

    } catch (error) {
        console.error('Broadcast error:', error);
        res.status(500).json({ error: 'Broadcast failed: ' + error.message });
    }
});

// POST /api/telegram/remind-refill
router.post('/remind-refill', async (req, res) => {
    const { customerId } = req.body;

    if (!bot) return res.status(503).json({ error: 'Bot inactive' });

    try {
        const [rows] = await db.promise().execute(
            'SELECT telegram_chat_id, name FROM customerDetails WHERE id = ?',
            [customerId]
        );

        if (rows.length === 0 || !rows[0].telegram_chat_id) {
            return res.status(404).json({ error: 'Customer not found or not linked' });
        }

        const chatId = rows[0].telegram_chat_id;
        const text = `Hello ${rows[0].name}, we noticed your prescribed therapy period has ended. Do you need a refill? Visit us or reply here to order!`;

        await bot.telegram.sendMessage(chatId, text);
        res.json({ success: true });

    } catch (error) {
        console.error('Refill reminder error:', error);
        res.status(500).json({ error: 'Failed to send reminder' });
    }
});

module.exports = router;
