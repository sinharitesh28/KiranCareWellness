// server/app.js
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load .env from current dir or parent dir
const envPath = fs.existsSync(path.join(__dirname, '.env')) 
    ? path.join(__dirname, '.env') 
    : path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const db = require('./db');
const authRoutes = require('./routes/authRoutes');
const requireAuth = require('./middleware/auth');
const templateRoutes = require('./routes/templateRoutes');
const stockRoutes = require('./routes/stockRoutes');
const barcodeRoutes = require('./routes/barcodeRoutes'); // NEW: Add barcode routes
const dispenseRoutes = require('./routes/dispenseRoutes');
const transactionRoutes = require('./routes/transactions');
const analyticsRoutes = require('./routes/analyticsRoutes'); // NEW: Analytics routes
const customerRoutes = require('./routes/customerRoutes'); // NEW: Customer routes
const userRoutes = require('./routes/userRoutes'); // NEW: User management routes
const telegramRoutes = require('./routes/telegramRoutes'); // NEW: Telegram dashboard routes
const distributorRoutes = require('./routes/distributorRoutes'); // NEW: Distributor Config routes
const { launchBot } = require('./services/telegramService'); // NEW: Initialize Telegram Bot Service
launchBot();

const app = express();

// JSON / form parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// session store
const sessionStore = new MySQLStore({}, db);

// session (required by authRoutes to store employeeCode)
app.use(session({
    key: 'session_cookie_name',
    secret: 'change_this_to_a_strong_secret',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// mount auth routes at /auth (DO NOT PROTECT THIS ROUTE)
console.log('Mounting Auth Routes...');
app.use('/auth', authRoutes);

// serve login page explicitly at / (DO NOT PROTECT THIS ROUTE)
app.get('/', (req, res) => {
    if (req.session && req.session.code) {
        return res.redirect('/index.html');
    }
    res.sendFile(path.join(__dirname, '..', 'logIn.html'));
});

// Serve core public assets (logos, login css/js)
app.use('/img', express.static(path.join(__dirname, '..', 'img')));
app.use('/css/logIn.css', express.static(path.join(__dirname, '..', 'css', 'logIn.css')));
app.use('/js/logIn.js', express.static(path.join(__dirname, '..', 'js', 'logIn.js')));

// 👇 APPLY AUTH MIDDLEWARE TO ALL REMAINING ROUTES
app.use(requireAuth);

// serve all remaining static files from project root (PROTECTED)
app.use(express.static(path.join(__dirname, '..'), { maxAge: '0' }));

// API routes are already handled after middleware above if they are defined on app directly
// or we can mount them on app since app.use(requireAuth) was called.

// Use the API routes
app.use('/api/template', templateRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/barcode', barcodeRoutes); // NEW: Mount barcode routes
app.use('/api/dispense', dispenseRoutes);
app.use('/api/dispense', transactionRoutes);
app.use('/api/analytics', analyticsRoutes); // NEW: Analytics API
app.use('/api/customers', customerRoutes); // NEW: Customer API
app.use('/api/users', userRoutes); // NEW: User API
app.use('/api/telegram', telegramRoutes); // NEW: Telegram API
app.use('/api/distributor', distributorRoutes); // NEW: Distributor API

// simple error handler
app.use((err, req, res, next) => {
    console.error(err.stack);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({
        error: "Internal Server Error",
        message: err.message
    });
});

// Start Cron Jobs
const cleanupDrafts = require('./cron/draftCleanup');
cleanupDrafts();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});