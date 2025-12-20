// server/app.js
const express = require('express');
const path = require('path');
const session = require('express-session');
const authRoutes = require('./routes/authRoutes');
const requireAuth = require('./middleware/auth'); 
const templateRoutes = require('./routes/templateRoutes'); 
const stockRoutes = require('./routes/stockRoutes');
const barcodeRoutes = require('./routes/barcodeRoutes'); // NEW: Add barcode routes
const dispenseRoutes = require('./routes/dispenseRoutes');
const transactionRoutes = require('./routes/transactions');
const analyticsRoutes = require('./routes/analyticsRoutes'); // NEW: Analytics routes
const customerRoutes = require('./routes/customerRoutes'); // NEW: Customer routes
require('./services/telegramService'); // NEW: Initialize Telegram Bot Service

const app = express();

// JSON / form parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// session (required by authRoutes to store employeeCode)
app.use(session({
    secret: 'change_this_to_a_strong_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// mount auth routes at /auth (DO NOT PROTECT THIS ROUTE)
app.use('/auth', authRoutes);

// serve login page explicitly at / (DO NOT PROTECT THIS ROUTE)
app.get('/', (req, res) => {
    if (req.session && req.session.code) {
        return res.redirect('/index.html'); 
    }
    res.sendFile(path.join(__dirname, '..', 'logIn.html'));
});

// serve static files from project root
app.use(express.static(path.join(__dirname, '..')));

// 👇 APPLY AUTH MIDDLEWARE TO ALL REMAINING ROUTES
const protectedRouter = express.Router();
protectedRouter.use(requireAuth); 

// Protected routes
protectedRouter.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

protectedRouter.get('/ImportTemplate.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'html', 'ImportTemplate.html'));
});

protectedRouter.get('/importStock.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'html', 'importStock.html'));
});

// NEW: Barcode printing page route
protectedRouter.get('/barcode-printing.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'html', 'barcodePrinting.html'));
});

protectedRouter.get('/drugDispensing.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'html', 'drugDispensing.html'));
});


// Use the protected router
app.use(protectedRouter);

// Use the API routes
app.use('/api/template', templateRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/barcode', barcodeRoutes); // NEW: Mount barcode routes
app.use('/api/dispense', dispenseRoutes);
app.use('/api/dispense', transactionRoutes);
app.use('/api/analytics', analyticsRoutes); // NEW: Analytics API
app.use('/api/customers', customerRoutes); // NEW: Customer API

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

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});