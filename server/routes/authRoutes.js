const express = require('express');
const db = require('../db');
const transporter = require('../mailer');
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

        // table `employeedetails` columns: code, name, position, gmail, contact_no, branch
        // select gmail and alias to email
        const [results] = await db.promise().query(
            'SELECT gmail AS email FROM employeedetails WHERE code = ?',
            [employeeCode]
        );

        if (!results || results.length === 0) {
            return res.status(404).json({ error: 'Invalid employee code' });
        }

        const email = results[0].email;
        if (!email) {
            return res.status(500).json({ error: 'No email configured for this employee' });
        }

        const otp = generateOTP();
        otpStore[String(employeeCode)] = {
            otp,
            expires: Date.now() + 5 * 60 * 1000 // 5 minutes
        };

        const mailOptions = {
            from: transporter.options && transporter.options.auth ? transporter.options.auth.user : 'no-reply@example.com',
            to: email,
            subject: 'Kiran Care Wellness - Your OTP',
            text: `Your OTP for Kiran Care Wellness login is: ${otp}. It will expire in 5 minutes.`
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: 'OTP sent to official email id' });
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
        res.json({ message: 'OTP validated' });
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
        // SQL to fetch the 'name' column based on the 'code' column
        const [results] = await db.promise().query(
            'SELECT name FROM employeedetails WHERE code = ?',
            [employeeCode]
        );

        if (results.length > 0) {
            // Found the user, return their name
            const userName = results[0].name;
            res.json({ name: userName });
        } else {
            // User not found (should not happen if authentication succeeded)
            console.warn(`Authenticated code ${employeeCode} not found in DB.`);
            res.status(404).json({ error: 'User data not found.' });
        }
    } catch (err) {
        console.error('Database query error fetching user name:', err);
        // Send a generic error response, but log the specific error
        res.status(500).json({ error: 'Internal server error while fetching user data.' });
    }
});

module.exports = router;
