// server/bot/handlers/cart.js
const { getSession, clearSession } = require('../session');
const db = require('../../db');
const path = require('path');
const fs = require('fs');

module.exports = (bot) => {

    // Helper: Update Message with new state
    const updateCartMessage = async (ctx, chatItem, stockItem, createNew = false) => {
        try {
            const qty = chatItem ? chatItem.quantity : 0;
            const isLoose = chatItem ? chatItem.isLoose : false;
            const isLocked = chatItem ? chatItem.locked : false;
            
            let price;
            let stockStr;

            if (isLoose) {
                const packing = stockItem.packing || 1;
                price = chatItem?.customPrice || ((stockItem.mrp || stockItem.rate) / packing);
                stockStr = `Loose Stock: ${stockItem.loose_quantity}`;
            } else {
                price = chatItem?.customPrice || (stockItem.mrp || stockItem.rate);
                stockStr = `Stock: ${stockItem.quantity}`;
            }
            
            // Ensure price is float
            price = parseFloat(price);
            const total = (qty * price).toFixed(2);
            const looseLabel = isLoose ? ' (Loose)' : '';

            // Detect Manual Item
            const isManual = stockItem.item_desc && (stockItem.item_desc.startsWith('Manual Entry') || stockItem.item_desc.startsWith('Manual Item'));

            let text;
            if (isManual) {
                text = `💊 *${stockItem.item_name}*${looseLabel}\n💰 Unit: ₹${price.toFixed(2)}\n\n*Qty: ${qty} | Total: ₹${total}*`;
            } else {
                text = `💊 *${stockItem.item_name}*${looseLabel}\n📦 ${stockStr}\n📍 Rack: ${stockItem.location}\n💰 Unit: ₹${price.toFixed(2)}\n\n*Qty: ${qty} | Total: ₹${total}*`;
            }

            if (isLocked) {
                text = `✅ *Added to Cart*\n\n${text}`;
            }

            const suffix = isLoose ? '_loose' : '';

            // Construct keyboard
            const keyboard = [];

            if (isLocked) {
                // Locked View: Only Remove
                keyboard.push([
                    { text: '❌ Remove from Cart', callback_data: `cart_remove${suffix}_${stockItem.id}` }
                ]);
            } else {
                // Unlocked View: Full Controls
                keyboard.push([
                    { text: '➖', callback_data: `cart_sub${suffix}_${stockItem.id}` },
                    { text: `${qty}${looseLabel}`, callback_data: `cart_check_rate${suffix}_${stockItem.id}` },
                    { text: '➕', callback_data: `cart_add${suffix}_${stockItem.id}` }
                ]);

                // Action Row
                const addAction = qty > 0 
                    ? { text: '✅ Add to Cart', callback_data: `cart_lock${suffix}_${stockItem.id}` }
                    : { text: '🗑️ Clear', callback_data: `cart_remove${suffix}_${stockItem.id}` };

                keyboard.push([
                    { text: `₹${price.toFixed(2)}`, callback_data: `cart_price${suffix}_${stockItem.id}` },
                    addAction
                ]);

                // Switch Row (only if not manual)
                if (!isManual) {
                    keyboard.push([
                        { text: isLoose ? '📦 Switch to Strip' : '✂️ Switch to Loose', callback_data: isLoose ? `cart_mode_strip_${stockItem.id}` : `cart_mode_${stockItem.id}` }
                    ]);
                }
            }

            if (createNew) {
                await ctx.reply(text, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            } else {
                await ctx.editMessageText(text, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            }
        } catch (e) {
            // Ignore "message is not modified" errors
            if (e.description && e.description.includes('message is not modified')) return;
            console.error('[Cart] Update Cart Msg Error:', e.message);
        }
    };


    // Helper: Consolidate Cart Items (Merge duplicates)
    const consolidateCart = (session) => {
        const uniqueItems = new Map();
        
        for (const item of session.items) {
            const key = `${item.stockId}_${!!item.isLoose}`;
            if (uniqueItems.has(key)) {
                const existing = uniqueItems.get(key);
                existing.quantity += item.quantity;
                // Prefer the one with a custom price if available, or the last one encountered
                if (item.customPrice !== null) existing.customPrice = item.customPrice;
                // Merge locked status (if any is locked, the merged one is locked)
                if (item.locked) existing.locked = true;
            } else {
                uniqueItems.set(key, item);
            }
        }
        
        session.items = Array.from(uniqueItems.values());
    };

    // 1. ADD / SUBTRACT (Supports Loose)
    bot.action(/cart_(add|sub)(_loose)?_(\d+)/, async (ctx) => {
        const action = ctx.match[1];
        const isLoose = !!ctx.match[2]; // "_loose" or undefined
        const stockId = parseInt(ctx.match[3]);
        const chatId = ctx.from.id;
        const session = getSession(chatId);
        
        consolidateCart(session); // Ensure clean state

        console.log(`[Cart Action] ${action} | Loose: ${isLoose} | StockID: ${stockId} | User: ${chatId}`);

        // Fetch db item detail
        const [rows] = await db.promise().execute('SELECT * FROM import_stock_detail WHERE id = ?', [stockId]);
        if (rows.length === 0) return ctx.answerCbQuery('Item not found');
        const stockItem = rows[0];

        // Find or init item in session
        let cartItem = session.items.find(i => i.stockId === stockId && !!i.isLoose === isLoose);
        if (!cartItem) {
            cartItem = { stockId, quantity: 0, customPrice: null, isLoose }; 
            session.items.push(cartItem);
        }

        if (action === 'add') {
            cartItem.quantity++;
        } else {
            if (cartItem.quantity > 0) cartItem.quantity--;
        }

        await updateCartMessage(ctx, cartItem, stockItem);
        ctx.answerCbQuery(isLoose ? (action === 'add' ? 'Added loose unit' : 'Removed loose unit') : undefined);
    });

    // 2. REMOVE (Split handlers for safety)
    const handleRemove = async (ctx, isLoose) => {
        console.log(`[Cart] Remove triggered: ${ctx.match[0]} (Loose: ${isLoose})`);
        const stockId = parseInt(ctx.match[1]);
        const chatId = ctx.from.id;
        const session = getSession(chatId);

        const cartItem = session.items.find(i => i.stockId === stockId && !!i.isLoose === isLoose);

        if (cartItem) {
            cartItem.quantity = 0;
            cartItem.locked = false;

            // Refresh view
            const [rows] = await db.promise().execute('SELECT * FROM import_stock_detail WHERE id = ?', [stockId]);
            if (rows.length > 0) {
                const stockItem = rows[0];
                await updateCartMessage(ctx, cartItem, stockItem);
            }
        } else {
            // If item not in session, try to delete message
            ctx.deleteMessage().catch((e) => console.error('[Cart] Delete failed:', e.message)); 
        }
        
        ctx.answerCbQuery('Removed from cart');
    };

    bot.action(/cart_remove_loose_(\d+)/, (ctx) => handleRemove(ctx, true));
    bot.action(/cart_remove_(\d+)/, (ctx) => handleRemove(ctx, false));



    // Checkout: Save as Web Draft
    bot.action('checkout_web_draft', async (ctx) => {
        ctx.answerCbQuery();
        processCheckout(ctx, null, 'pending');
    });

    // Hidden Rate Check (Split Handlers)
    const handleRateCheck = async (ctx, isLoose) => {
        console.log(`[Cart] Rate check triggered: ${ctx.match[0]} (Loose: ${isLoose})`);
        const stockId = parseInt(ctx.match[1]);
        
        try {
            const [rows] = await db.promise().execute('SELECT rate, packing FROM import_stock_detail WHERE id = ?', [stockId]);
            if (rows.length > 0) {
                const item = rows[0];
                let displayRate = parseFloat(item.rate);
                
                if (isLoose) {
                    const packing = item.packing || 1;
                    displayRate = displayRate / packing;
                }
                
                await ctx.answerCbQuery(`💰: ₹${displayRate.toFixed(2)}`, { show_alert: false });
            } else {
                ctx.answerCbQuery('Item not found');
            }
        } catch (e) {
            console.error('Rate Check Error:', e);
            ctx.answerCbQuery('Error fetching rate');
        }
    };

    bot.action(/cart_check_rate_loose_(\d+)/, (ctx) => handleRateCheck(ctx, true));
    bot.action(/cart_check_rate_(\d+)/, (ctx) => handleRateCheck(ctx, false));

    // 3. LOCK / ADD TO CART
    bot.action(/cart_lock(_loose)?_(\d+)/, async (ctx) => {
        const isLoose = !!ctx.match[1];
        const stockId = parseInt(ctx.match[2]);
        const chatId = ctx.from.id;
        const session = getSession(chatId);
        
        consolidateCart(session);

        const cartItem = session.items.find(i => i.stockId === stockId && !!i.isLoose === isLoose);
        if (cartItem) {
            cartItem.locked = true;
            
            // Re-fetch stock item for display
            const [rows] = await db.promise().execute('SELECT * FROM import_stock_detail WHERE id = ?', [stockId]);
            if (rows.length > 0) {
                const stockItem = rows[0];
                await updateCartMessage(ctx, cartItem, stockItem);
            }
        }
        ctx.answerCbQuery('Item added to cart');
    });

    // 3. EDIT PRICE (Trigger ForceReply)
    bot.action(/cart_price(_loose)?_(\d+)/, async (ctx) => {
        console.log('[Cart] Price action triggered:', ctx.match[0]);
        const isLoose = !!ctx.match[1];
        const stockId = parseInt(ctx.match[2]);
        const chatId = ctx.from.id;
        const session = getSession(chatId);
        
        consolidateCart(session);

        session.tempPriceEditId = stockId;
        session.tempPriceEditIsLoose = isLoose;

        // Ensure item exists in session to avoid "Item not found" error later
        let cartItem = session.items.find(i => i.stockId === stockId && !!i.isLoose === isLoose);
        if (!cartItem) {
            cartItem = { stockId, quantity: 1, customPrice: null, isLoose };
            session.items.push(cartItem);
            console.log(`[Cart] Auto-added item ${stockId} (Loose: ${isLoose}) with qty 1 during price edit.`);
        }

        // Use bot.telegram.sendMessage to safely target the user, even if ctx.reply fails for inline messages
        try {
            await ctx.telegram.sendMessage(chatId, 'Reply with new unit price:', {
                reply_markup: { force_reply: true }
            });
        } catch (e) {
            console.error('[Cart] Failed to send price prompt:', e.message);
            return ctx.answerCbQuery('Error: Could not send prompt.');
        }
        
        ctx.answerCbQuery();
    });

    // 4. Handle Text Reply (for Price Edit)
    bot.on('text', async (ctx, next) => {
        const chatId = ctx.from.id;
        const session = getSession(chatId);
        const text = ctx.message.text;

        // Case A: Price Edit (Check Session State)
        if (session.tempPriceEditId) {
            console.log(`[Price Edit] Processing text: "${text}" for StockID: ${session.tempPriceEditId}`);

            // Check if user wants to cancel
            if (text.toLowerCase() === 'cancel' || text.startsWith('/')) {
                session.tempPriceEditId = null;
                session.tempPriceEditIsLoose = null;
                return ctx.reply('❌ Price edit cancelled.');
            }

            // Sanitize input: remove currency symbols, spaces, keep digits and dots
            const cleanText = text.replace(/[^0-9.]/g, '');
            const newPrice = parseFloat(cleanText);

            if (isNaN(newPrice) || cleanText.length === 0) {
                console.log(`[Price Edit] Failed to parse price from: "${text}"`);
                return ctx.reply('⚠️ Invalid price format. Please enter a number (e.g. 45.50) or type "cancel".');
            }
            
            consolidateCart(session);

            const cartItem = session.items.find(i => i.stockId === session.tempPriceEditId && !!i.isLoose === !!session.tempPriceEditIsLoose);
            if (cartItem) {
                cartItem.customPrice = newPrice;
                // Confirm update
                await ctx.reply(`✅ Price updated to ₹${newPrice.toFixed(2)}`);

                // Re-send the updated card to reflect changes visually
                const [rows] = await db.promise().execute('SELECT * FROM import_stock_detail WHERE id = ?', [session.tempPriceEditId]);
                if (rows.length > 0) {
                    const stockItem = rows[0];
                    await updateCartMessage(ctx, cartItem, stockItem);
                }
            } else {
                ctx.reply('⚠️ Item not found in cart. Edit cancelled.');
            }

            session.tempPriceEditId = null; // Clear flag
            session.tempPriceEditIsLoose = null;
            return; // Stop propagation
        } else {
            // Debug: Log if we received text but had no price edit session active
            // This helps confirm if the bot can SEE the messages (Privacy Settings) or if Session is lost
            // console.log(`[Cart] Text received but no edit session active. Text: "${text}"`);
        }
        next();
    });

    // 5. VIEW BILL / CHECKOUT
    const showBill = async (ctx) => {
        const chatId = ctx.from.id;
        const session = getSession(chatId);
        
        consolidateCart(session);

        const lockedItems = session.items.filter(i => i.locked && i.quantity > 0);

        if (lockedItems.length === 0) {
            return ctx.reply('🛒 Cart is empty.\n(Make sure to click "✅ Add to Cart" for your selected items)');
        }

        // Calculate totals and fetch names
        let totalAmount = 0;
        let billText = "🧾 *Current Cart*\n\n";

        for (const item of lockedItems) {
            if (item.quantity <= 0) continue;

            const [rows] = await db.promise().execute('SELECT item_name, mrp, rate FROM import_stock_detail WHERE id = ?', [item.stockId]);
            if (rows.length > 0) {
                const stock = rows[0];
                const price = item.customPrice || stock.rate || stock.mrp;
                const lineTotal = price * item.quantity;
                totalAmount += lineTotal;
                billText += `- ${stock.item_name} x${item.quantity} = ₹${lineTotal.toFixed(2)}\n`;
            }
        }

        billText += `\n*TOTAL: ₹${totalAmount.toFixed(2)}*`;

        ctx.reply(billText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🏃 Walk-in', callback_data: 'checkout_walkin' }
                    ],
                    [
                        { text: '🔍 Search Mobile (Existing)', callback_data: 'checkout_search' }
                    ],
                    [
                        { text: '☁️ Save as Draft', callback_data: 'checkout_web_draft' }
                    ],
                    [{ text: '❌ Clear Cart', callback_data: 'cart_clear' }]
                ]
            }
        });
    };

    // Manual Item Logic Helper
    const addManualItem = async (ctx, customName = null) => {
        const chatId = ctx.from.id;
        const session = getSession(chatId);
        
        const itemName = customName || 'Manual Item - Other';
        const itemDesc = customName ? `Manual Entry: ${customName}` : 'Manually added item';

        try {
            // Check if this specific manual item exists (to reuse ID if re-added)
            const [rows] = await db.promise().execute("SELECT * FROM import_stock_detail WHERE item_name = ? LIMIT 1", [itemName]);
            let item;

            if (rows.length === 0) {
                // Dependency: We need a valid master_id
                let masterId;
                const [masters] = await db.promise().execute("SELECT id FROM import_stock_master WHERE vendor_name = 'Manual Entry' LIMIT 1");
                
                if (masters.length > 0) {
                    masterId = masters[0].id;
                } else {
                    // Create dummy master and template
                    let templateId;
                    const [temps] = await db.promise().execute("SELECT id FROM importTemplate WHERE template_name = 'Manual Template' LIMIT 1");
                    
                    if (temps.length > 0) {
                        templateId = temps[0].id;
                    } else {
                         const [tRes] = await db.promise().execute(
                            "INSERT INTO importTemplate (template_name, vendor_detail_col, item_name_col, quantity_col, rate_col, mrp_col) VALUES (?, ?, ?, ?, ?, ?)",
                            ['Manual Template', 'NA', 'NA', 'NA', 'NA', 'NA']
                        );
                        templateId = tRes.insertId;
                    }

                    const [mRes] = await db.promise().execute(
                        "INSERT INTO import_stock_master (template_id, vendor_name, invoice_no, invoice_date, import_date) VALUES (?, ?, ?, NOW(), NOW())",
                        [templateId, 'Manual Entry', 'MANUAL-001']
                    );
                    masterId = mRes.insertId;
                }

                // Create Detail with master_id
                const [res] = await db.promise().execute(
                    "INSERT INTO import_stock_detail (master_id, item_name, item_desc, location, quantity, loose_quantity, packing, mrp, rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [masterId, itemName, itemDesc, 'Manual', 1, 1, 1, 0, 0]
                );
                const [newRows] = await db.promise().execute("SELECT * FROM import_stock_detail WHERE id = ?", [res.insertId]);
                item = newRows[0];
            } else {
                item = rows[0];
            }

            // Add to session
            const stockId = item.id;
            let cartItem = session.items.find(i => i.stockId === stockId);
            if (!cartItem) {
                cartItem = { stockId, quantity: 1, customPrice: 0, isLoose: false };
                session.items.push(cartItem);
            }
            
            // Show Card
            const isNew = ctx.updateType === 'message';
            await updateCartMessage(ctx, cartItem, item, isNew);
            
            // Note: User must click the price button to set the price. We do not prompt automatically.

        } catch (err) {
            console.error('Manual Item Error:', err);
            ctx.reply('❌ Error creating manual item: ' + (err.sqlMessage || err.message));
        }
    };

    // Manual Item Entry - Direct via "? Name"
    // Replaces previous search functionality for ? prefix
    bot.hears(/^\? (.+)/, async (ctx) => {
        const query = ctx.match[1].trim();
        if (query.length < 1) return;
        addManualItem(ctx, query);
    });
    
    // Create specific manual item from search (Legacy support or if invoked)
    bot.action('manual_create_from_search', async (ctx) => {
        const session = getSession(ctx.from.id);
        const query = session.lastSearchQuery;
        
        await ctx.answerCbQuery();
        
        if (!query) {
            return ctx.reply('⚠️ Search context expired. Please search again.');
        }
        
        addManualItem(ctx, query);
    });

    bot.command('bill', showBill);
    bot.action('view_cart_cmd', async (ctx) => {
        await ctx.answerCbQuery();
        showBill(ctx);
    });

    // Clear Cart
    bot.action('cart_clear', (ctx) => {
        clearSession(ctx.from.id);
        ctx.editMessageText('🗑️ Cart cleared.');
    });

    // Checkout: Walk-in (Anonymous/Just Name?)
    bot.action('checkout_walkin', async (ctx) => {
        ctx.answerCbQuery();
        processCheckout(ctx, null);
    });

    // Checkout: Search Customer Trigger
    bot.action('checkout_search', async (ctx) => {
        const chatId = ctx.from.id;
        const session = getSession(chatId);
        session.awaitingCustomerMobile = true;
        
        await ctx.reply('📱 Please enter the Customer Mobile Number:', {
            reply_markup: { force_reply: true }
        });
        ctx.answerCbQuery();
    });

    // Handle Text Input (Price Edit OR Customer Search)
    bot.on('text', async (ctx, next) => {
        const chatId = ctx.from.id;
        const session = getSession(chatId);
        const text = ctx.message.text;

        // Case A: Price Edit
        if (ctx.message.reply_to_message && ctx.message.reply_to_message.text === 'Reply with new unit price:') {
            if (!session.tempPriceEditId) return next();

            const newPrice = parseFloat(text);
            if (isNaN(newPrice)) return ctx.reply('Invalid price. Try again.');

            const cartItem = session.items.find(i => i.stockId === session.tempPriceEditId && !!i.isLoose === !!session.tempPriceEditIsLoose);
            if (cartItem) {
                cartItem.customPrice = newPrice;
                ctx.reply(`✅ Price updated to ₹${newPrice}`);

                const [rows] = await db.promise().execute('SELECT * FROM import_stock_detail WHERE id = ?', [session.tempPriceEditId]);
                if (rows.length > 0) {
                    const stockItem = rows[0];
                    await updateCartMessage(ctx, cartItem, stockItem);
                }
            }

            session.tempPriceEditId = null; // Clear flag
            session.tempPriceEditIsLoose = null;
            return; // Stop propagation
        }

        // Case B: Customer Search
        if (session.awaitingCustomerMobile) {
            session.awaitingCustomerMobile = false; // Reset flag
            const mobile = text.replace(/\D/g, '').slice(-10);

            if (mobile.length < 10) {
                 return ctx.reply('❌ Invalid mobile number. Please click "Search Customer" again.');
            }

            const [cust] = await db.promise().execute('SELECT id, name FROM customerDetails WHERE mobile_no LIKE ?', [`%${mobile}`]);
            
            if (cust.length > 0) {
                const customer = cust[0];
                ctx.reply(`✅ Customer Found: *${customer.name}*\nProceeding to checkout...`, { parse_mode: 'Markdown' });
                processCheckout(ctx, customer.id);
            } else {
                ctx.reply('❌ Customer not found.\n1. Try "Search Customer" again\n2. Or proceed as "Walk-in" via /bill');
            }
            return;
        }

        next();
    });

    // Helper: Finalize Checkout
    async function processCheckout(ctx, customerId, status = 'completed') {
        const chatId = ctx.from.id;
        const session = getSession(chatId);
        
        consolidateCart(session);
        
        const lockedItems = session.items.filter(i => i.locked && i.quantity > 0);

        if (lockedItems.length === 0) return ctx.reply('Cart empty. Please click "✅ Add to Cart" on your items first.');

        const userId = ctx.state.employee ? ctx.state.employee.code : 'TELEGRAM-BOT';

        let connection;
        try {
            connection = await db.promise().getConnection();
            await connection.beginTransaction();

            const itemsToSave = [];
            let grandTotal = 0;

            // Prepare items and Validate Stock
            for (const item of lockedItems) {
                if (item.quantity <= 0) continue;

                const [rows] = await connection.query('SELECT * FROM import_stock_detail WHERE id = ?', [item.stockId]);
                if (rows.length === 0) continue;
                const stock = rows[0];

                // Update Manual Item Stock to match transaction quantity (so it becomes 0 after deduction)
                if (stock.location === 'Manual' || (stock.item_desc && stock.item_desc.startsWith('Manual Entry'))) {
                     if (item.isLoose) {
                         stock.loose_quantity = item.quantity;
                         await connection.query('UPDATE import_stock_detail SET loose_quantity = ? WHERE id = ?', [item.quantity, stock.id]);
                     } else {
                         stock.quantity = item.quantity;
                         await connection.query('UPDATE import_stock_detail SET quantity = ? WHERE id = ?', [item.quantity, stock.id]);
                     }
                }

                let sellingPrice;
                if (item.isLoose) {
                    // Loose Mode
                    if (stock.loose_quantity < item.quantity) {
                        throw new Error(`Insufficient loose stock for ${stock.item_name} (Req: ${item.quantity}, Avail: ${stock.loose_quantity})`);
                    }
                    const packing = stock.packing || 1;
                    sellingPrice = item.customPrice || ((stock.mrp || stock.rate) / packing);
                } else {
                    // Strip Mode
                    if (stock.quantity < item.quantity) {
                        throw new Error(`Insufficient stock for ${stock.item_name} (Req: ${item.quantity}, Avail: ${stock.quantity})`);
                    }
                    sellingPrice = item.customPrice || stock.mrp || stock.rate;
                }

                const lineTotal = sellingPrice * item.quantity;
                grandTotal += lineTotal;

                itemsToSave.push({
                    stock_detail_id: stock.id,
                    item_name: stock.item_name,
                    item_description: stock.item_desc,
                    mrp: stock.mrp,
                    selling_price: sellingPrice,
                    quantity: item.quantity,
                    total_price: lineTotal,
                    location: stock.location,
                    isLoose: item.isLoose
                });
            }

            // Check Walk-in Customer if customerId is null
            if (!customerId) {
                const [walkIn] = await connection.query("SELECT id FROM customerDetails WHERE mobile_no = '0000000000'");
                if (walkIn.length > 0) {
                    customerId = walkIn[0].id;
                } else {
                    const [res] = await connection.query("INSERT INTO customerDetails (name, mobile_no) VALUES ('Walk-in Customer', '0000000000')");
                    customerId = res.insertId;
                }
            }

            // Create Transaction
            const billNumber = `BILL-${Date.now()}`;
            const [tRes] = await connection.query(
                `INSERT INTO transactions (customer_id, total_amount, payment_method, bill_number, created_by_user_id, status) VALUES (?, ?, 'cash', ?, ?, ?)`,
                [customerId, grandTotal, billNumber, userId, status]
            );
            const transactionId = tRes.insertId;

            // Save Items & Deduct Stock
            for (const item of itemsToSave) {
                // Insert Item
                // For loose items, we set dose_dispensing = true and dose_quantity = quantity
                // We also store selling_price as dose_unit_price
                await connection.query(
                    `INSERT INTO transaction_items 
                    (transaction_id, stock_detail_id, item_name, item_description, mrp, selling_price, quantity, total_price, location, dose_dispensing, dose_quantity, dose_unit_price) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        transactionId, 
                        item.stock_detail_id, 
                        item.item_name + (item.isLoose ? ' (Loose)' : ''), 
                        item.item_description, 
                        item.mrp, 
                        item.selling_price, 
                        item.quantity, 
                        item.total_price, 
                        item.location,
                        item.isLoose ? true : false,
                        item.isLoose ? item.quantity : null,
                        item.isLoose ? item.selling_price : null
                    ]
                );

                // Update Stock
                if (item.isLoose) {
                    await connection.query(
                        'UPDATE import_stock_detail SET loose_quantity = loose_quantity - ? WHERE id = ?',
                        [item.quantity, item.stock_detail_id]
                    );
                } else {
                    await connection.query(
                        'UPDATE import_stock_detail SET quantity = quantity - ? WHERE id = ?',
                        [item.quantity, item.stock_detail_id]
                    );
                }
            }

            await connection.commit();
            clearSession(chatId);

            if (status === 'pending') {
                ctx.reply(`✅ Saved as Web Draft!\nReference: ${billNumber}\nResume on Web Portal.`);
            } else {
                ctx.reply(`✅ Transaction Complete!\nBill: ${billNumber}\nAmt: ₹${grandTotal.toFixed(2)}`);
            }

            // Check if customer has telegram linked to send digital bill
            if (customerId) {
                // We need to require services/telegramService but circular dependency risk if we reuse the one that imports bot.
                // Best to invoke a function that takes the ID.
                // Or just query the ID here and send message directly since we are IN the bot context.
                const [cRows] = await db.promise().execute('SELECT telegram_chat_id FROM customerDetails WHERE id = ?', [customerId]);
                if (cRows.length > 0 && cRows[0].telegram_chat_id) {
                    bot.telegram.sendMessage(cRows[0].telegram_chat_id, `🧾 Thank you! Your bill ${billNumber} for ₹${grandTotal} is ready.`);
                }
            }

        } catch (err) {
            if (connection) await connection.rollback();
            console.error('Checkout Error Full:', err);
            const errMsg = err.message || err.sqlMessage || 'Unknown Database Error';
            ctx.reply(`❌ Checkout Failed: ${errMsg}`);
        } finally {
            if (connection) connection.release();
        }
    }
};
