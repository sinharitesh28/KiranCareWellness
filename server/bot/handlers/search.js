// server/bot/handlers/search.js
const db = require('../../db');

module.exports = (bot) => {
    // Shared Search Logic
    const searchStock = async (query) => {
        if (!query || query.length < 1) return [];

        const sql = `
            SELECT id, item_name, item_desc, location, quantity, loose_quantity, packing, mrp, rate, barcode 
            FROM import_stock_detail 
            WHERE (item_name LIKE ? OR item_desc LIKE ? OR location LIKE ? OR barcode = ?) 
            AND (quantity > 0 OR loose_quantity > 0) 
            LIMIT 10
        `;
        const param = `%${query}%`;
        const exactParam = query;

        const [results] = await db.promise().execute(sql, [param, param, param, exactParam]);
        return results;
    };

    // 1. Simplified Direct Search: "? <query>" - REMOVED per refactor req
    // Moved to cart.js for "Manual Add" shortcut
    
    // 2. Inline Query Handler: @BotName query (Legacy/Advanced)
    bot.on('inline_query', async (ctx) => {
        const query = ctx.inlineQuery.query;

        if (!query || query.length < 2) {
            return ctx.answerInlineQuery([]);
        }

        try {
            const results = await searchStock(query);

            const inlineResults = results.map(item => {
                const price = Number(item.rate || item.mrp || 0);
                const stockStr = `Stock: ${item.quantity} | Loose: ${item.loose_quantity}`;
                const desc = `${stockStr} | Rack: ${item.location || 'N/A'}`;
                const canSwitch = (item.packing && item.packing > 1) || item.loose_quantity > 0;

                const keyboard = [
                    [
                        { text: '➖', callback_data: `cart_sub_${item.id}` },
                        { text: '0', callback_data: `cart_check_rate_${item.id}` },
                        { text: '➕', callback_data: `cart_add_${item.id}` }
                    ],
                    [
                        { text: `₹${price.toFixed(2)}`, callback_data: `cart_price_${item.id}` },
                        { text: '🗑️ Remove', callback_data: `cart_remove_${item.id}` }
                    ]
                ];

                if (canSwitch) {
                    keyboard.push([{ text: '✂️ Switch to Loose', callback_data: `cart_mode_${item.id}` }]);
                }

                return {
                    type: 'article',
                    id: String(item.id),
                    title: item.item_name,
                    description: desc,
                    input_message_content: {
                        message_text: `💊 *${item.item_name}*\n📦 ${stockStr}\n📍 Rack: ${item.location || 'N/A'}\n💰 Price: ₹${price.toFixed(2)}`,
                        parse_mode: 'Markdown'
                    },
                    reply_markup: { inline_keyboard: keyboard }
                };
            });

            await ctx.answerInlineQuery(inlineResults, { cache_time: 0 }); 
        } catch (err) {
            console.error('Inline Search Error:', err);
        }
    });

    // Switch to Loose Mode
    bot.action(/cart_mode_(\d+)/, async (ctx) => {
        const stockId = parseInt(ctx.match[1]);
        console.log(`[Mode Switch] TO LOOSE | StockID: ${stockId} | User: ${ctx.from.id}`);
        const [rows] = await db.promise().execute('SELECT * FROM import_stock_detail WHERE id = ?', [stockId]);
        if (rows.length === 0) return ctx.answerCbQuery('Item not found');
        const item = rows[0];

        // Selection implies addition to cart? NO, user just switched view.
        const { getSession } = require('../session');
        const session = getSession(ctx.from.id);
        let cartItem = session.items.find(i => i.stockId === stockId && i.isLoose);
        // Do not auto-add. If not in cart, quantity will be 0.
        const qty = cartItem ? cartItem.quantity : 0;

        const packing = item.packing || 1;
        const loosePrice = (item.mrp || item.rate) / packing;
        
        const keyboard = [
            [
                { text: '➖', callback_data: `cart_sub_loose_${item.id}` },
                { text: `${qty} (Loose)`, callback_data: `cart_check_rate_loose_${item.id}` },
                { text: '➕', callback_data: `cart_add_loose_${item.id}` }
            ],
            [
                { text: `₹${loosePrice.toFixed(2)}`, callback_data: `cart_price_loose_${item.id}` },
                { text: '🗑️ Remove', callback_data: `cart_remove_${item.id}` }
            ],
            [
                { text: '📦 Switch to Strip', callback_data: `cart_mode_strip_${item.id}` }
            ]
        ];

        try {
            await ctx.editMessageText(
                `💊 *${item.item_name}* (Loose)\n✂️ Loose Stock: ${item.loose_quantity}\n📦 Pack Size: ${packing}\n💰 Loose Price: ₹${loosePrice.toFixed(2)}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                }
            );
            ctx.answerCbQuery('Switched to Loose Mode');
        } catch (e) {
            console.error(e);
            ctx.answerCbQuery('Error updating view');
        }
    });

    // Switch to Strip Mode
    bot.action(/cart_mode_strip_(\d+)/, async (ctx) => {
        const stockId = parseInt(ctx.match[1]);
        console.log(`[Mode Switch] TO STRIP | StockID: ${stockId} | User: ${ctx.from.id}`);
        const [rows] = await db.promise().execute('SELECT * FROM import_stock_detail WHERE id = ?', [stockId]);
        if (rows.length === 0) return ctx.answerCbQuery('Item not found');
        const item = rows[0];

        // Selection implies addition to cart? NO.
        const { getSession } = require('../session');
        const session = getSession(ctx.from.id);
        let cartItem = session.items.find(i => i.stockId === stockId && !i.isLoose);
        // Do not auto-add.
        const qty = cartItem ? cartItem.quantity : 0;

        const price = Number(item.mrp || item.rate || 0);
        const stockStr = `Stock: ${item.quantity} | Loose: ${item.loose_quantity}`;
        
        const keyboard = [
            [
                { text: '➖', callback_data: `cart_sub_${item.id}` },
                { text: `${qty}`, callback_data: `cart_check_rate_${item.id}` }, 
                { text: '➕', callback_data: `cart_add_${item.id}` }
            ],
            [
                { text: `₹${price.toFixed(2)}`, callback_data: `cart_price_${item.id}` },
                { text: '🗑️ Remove', callback_data: `cart_remove_${item.id}` }
            ],
            [
                { text: '✂️ Switch to Loose', callback_data: `cart_mode_${item.id}` }
            ]
        ];

        try {
            await ctx.editMessageText(
                `💊 *${item.item_name}*\n📦 ${stockStr}\n📍 Rack: ${item.location || 'N/A'}\n💰 Price: ₹${price.toFixed(2)}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                }
            );
            ctx.answerCbQuery('Switched to Strip Mode');
        } catch (e) {
            console.error(e);
            ctx.answerCbQuery('Error updating view');
        }
    });

    // 3. Handle selection from inline query list
    bot.on('chosen_inline_result', async (ctx) => {
        const stockId = parseInt(ctx.chosenInlineResult.result_id);
        const chatId = ctx.from.id;
        const { getSession } = require('../session');
        const session = getSession(chatId);

        console.log(`[Inline Selection] Item ${stockId} selected by user ${chatId}. Auto-adding to cart.`);

        try {
            // Fetch db item detail
            const [rows] = await db.promise().execute('SELECT * FROM import_stock_detail WHERE id = ?', [stockId]);
            if (rows.length === 0) return; // Should not happen if data integrity is fine
            const item = rows[0];

            // AUTO-ADD REMOVED: User must click '+' to add to cart.
            // This prevents "ghost" items in cart just by searching.
            
            // Note: We do NOT send a message here anymore to avoid duplication.
            // The user's click on the inline result already posted the message.

        } catch (err) {
            console.error('Error handling chosen inline result:', err);
        }
    });
};
