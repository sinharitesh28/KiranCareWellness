const express = require('express');
const db = require('../db');
const transporter = require('../mailer');
const bot = require('../bot/bot'); // Import Telegram Bot
// Import the requireAuth middleware
const requireAuth = require('../middleware/auth');

const router = express.Router();

// In-memory OTP store
const otpStore = {}; // { employeeCode: { otp: '123456', expires: Date } }

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP
router.post('/send-otp', async (req, res) => {
    try {
        // normalize input
        const employeeCode = String((req.body && req.body.employeeCode) || '').trim();
        if (!employeeCode) return res.status(400).json({ error: 'Employee code required' });

        // table `employeedetails` columns: code, name, position, gmail, contact_no, branch, telegram_chat_id
        // select gmail and telegram_chat_id
        const [results] = await db.promise().query(
            'SELECT gmail AS email, telegram_chat_id, name FROM employeedetails WHERE code = ?',
            [employeeCode]
        );

        if (!results || results.length === 0) {
            return res.status(404).json({ error: 'Invalid employee code' });
        }

        const user = results[0];
        if (!user.email) {
            return res.status(500).json({ error: 'No email configured for this employee' });
        }

        const otp = generateOTP();
        otpStore[String(employeeCode)] = {
            otp,
            expires: Date.now() + 5 * 60 * 1000 // 5 minutes
        };

        const mailOptions = {
            from: transporter.options && transporter.options.auth ? transporter.options.auth.user : 'no-reply@example.com',
            to: user.email,
            subject: 'Kiran Care Wellness - Your OTP',
            text: `Your OTP for Kiran Care Wellness login is: ${otp}. It will expire in 5 minutes.`
        };

        // Send Email
        await transporter.sendMail(mailOptions);
        let message = 'OTP sent to official email id';

        // Send via Telegram if linked
        if (user.telegram_chat_id && bot) {
            try {
                await bot.telegram.sendMessage(user.telegram_chat_id, `🔐 *Login OTP*\n\nYour OTP is: *${otp}*\n\nValid for 5 minutes.`, { parse_mode: 'Markdown' });
                message += ' and Telegram Bot';
            } catch (teleErr) {
                console.error('Failed to send Telegram OTP:', teleErr.message);
                // Don't fail the request, just log it
            }
        }

        res.json({ message });
    } catch (err) {
        console.error('send-otp error:', err);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
});

// Validate OTP
router.post('/validate-otp', (req, res) => {
    try {
        const { employeeCode, otp } = req.body;
        if (!employeeCode || !otp) return res.status(400).json({ error: 'Employee code and OTP required' });

        const record = otpStore[String(employeeCode)];
        if (!record) return res.status(400).json({ error: 'OTP not requested or expired' });

        if (Date.now() > record.expires) {
            delete otpStore[String(employeeCode)];
            return res.status(400).json({ error: 'OTP expired' });
        }

        if (record.otp !== String(otp)) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        delete otpStore[String(employeeCode)];

        // store employeeCode in session (requires express-session configured in app)
        if (req.session) {
            req.session.code = employeeCode; 
        }
        
        // Generate Token (Base64 of employeeCode) for API clients
        const token = Buffer.from(employeeCode).toString('base64');
        
        res.json({ message: 'OTP validated', token });
    } catch (err) {
        console.error('validate-otp error:', err);
        res.status(500).json({ error: 'Validation failed' });
    }
});

/**
 * @route GET /auth/user-data
 * @description Protected route to fetch the logged-in user's name from the DB.
 * It uses the 'code' stored in the session to query the kirancarewellness.employeedetails table.
 */
router.get('/user-data', requireAuth, async (req, res) => {
    // The 'code' is stored in the session upon successful login
    const employeeCode = req.session.code; 

    try {
        // SQL to fetch the 'name' and 'is_admin' columns
        const [results] = await db.promise().query(
            'SELECT name, is_admin FROM employeedetails WHERE code = ?',
            [employeeCode]
        );

        if (results.length > 0) {
            // Found the user, return their name and admin status
            res.json({ 
                name: results[0].name,
                is_admin: results[0].is_admin ? true : false
            });
        } else {
            // User not found (should not happen if authentication succeeded)
            console.warn(`Authenticated code ${employeeCode} not found in DB.`);
            res.status(404).json({ error: 'User data not found.' });
        }
    } catch (err) {
        console.error('Database query error fetching user data:', err);
        // Send a generic error response, but log the specific error
        res.status(500).json({ error: 'Internal server error while fetching user data.' });
    }
});

module.exports = router;
