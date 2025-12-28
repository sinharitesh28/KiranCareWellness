// server/bot/bot.js
const { Telegraf, Markup } = require('telegraf');
const db = require('../db');
const { getSession } = require('./session');

// Auth Cache
const staffCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Auth Middleware: Checks if user is a verified Staff member
const requireStaffAuth = async (ctx, next) => {
    const chatId = String(ctx.from?.id);
    if (!chatId) return;

    // Check Cache
    if (staffCache.has(chatId)) {
        const cached = staffCache.get(chatId);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            ctx.state.employee = cached.employee;
            return next();
        }
    }

    try {
        const [rows] = await db.promise().execute(
            'SELECT code, name FROM employeedetails WHERE telegram_chat_id = ?',
            [chatId]
        );

        if (rows.length > 0) {
            const employee = rows[0];
            staffCache.set(chatId, { employee, timestamp: Date.now() });
            ctx.state.employee = employee;
            return next();
        } else {
            // Allow /start command even if not auth
            if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/start')) {
                return next();
            }
            return next();
        }
    } catch (err) {
        console.error('Auth Middleware Error:', err);
    }
};

// Initialize Bot
let botToken = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

if (botToken) {
    // Sanitize token: remove whitespace and surrounding quotes if present
    botToken = botToken.trim();
    if ((botToken.startsWith('"') && botToken.endsWith('"')) || (botToken.startsWith("'") && botToken.endsWith("'"))) {
        botToken = botToken.slice(1, -1);
        console.warn('Warning: TELEGRAM_BOT_TOKEN was stripped of quotes. Please remove quotes in .env file.');
    }

    bot = new Telegraf(botToken);
    bot.use(requireStaffAuth);

    // Error Handling
    bot.catch((err, ctx) => {
        console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
    });

    console.log('Telegraf Bot Instance Created');
} else {
    console.warn('TELEGRAM_BOT_TOKEN missing. Bot features disabled.');
}

// Start the bot if this file is run directly
if (require.main === module && bot) {
    bot.launch().then(() => console.log('Bot launched independently'));
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = bot;
