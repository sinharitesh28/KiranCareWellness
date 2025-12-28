const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
    const employeeCode = req.session.code;
    try {
        const [results] = await db.promise().query(
            'SELECT is_admin FROM employeedetails WHERE code = ?',
            [employeeCode]
        );

        if (results.length > 0 && results[0].is_admin) {
            next();
        } else {
            res.status(403).json({ success: false, error: 'Forbidden: Admin access required.' });
        }
    } catch (err) {
        console.error('requireAdmin error:', err);
        res.status(500).json({ success: false, error: 'Internal server error.' });
    }
};

// Check if current user is admin
router.get('/me', requireAuth, async (req, res) => {
    const employeeCode = req.session.code;
    try {
        const [results] = await db.promise().query(
            'SELECT code, name, is_admin FROM employeedetails WHERE code = ?',
            [employeeCode]
        );
        if (results.length > 0) {
            res.json({ success: true, user: results[0] });
        } else {
            res.status(404).json({ success: false, error: 'User not found.' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error.' });
    }
});

// List all users (Admin only)
router.get('/list', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [results] = await db.promise().query(
            'SELECT code, name, position, gmail, contact_no, branch, is_admin, telegram_chat_id FROM employeedetails'
        );
        res.json({ success: true, users: results });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch users.' });
    }
});

// Add new user (Admin only)
router.post('/add', requireAuth, requireAdmin, async (req, res) => {
    const { name, position, gmail, contact_no, branch, is_admin } = req.body;
    try {
        const [result] = await db.promise().query(
            'INSERT INTO employeedetails (name, position, gmail, contact_no, branch, is_admin) VALUES (?, ?, ?, ?, ?, ?)',
            [name, position, gmail, contact_no, branch, is_admin || false]
        );
        res.json({ success: true, message: 'User added successfully', code: result.insertId });
    } catch (err) {
        console.error('Add user error:', err);
        res.status(500).json({ success: false, error: 'Failed to add user.' });
    }
});

// Update user (Admin only)
router.put('/update/:code', requireAuth, requireAdmin, async (req, res) => {
    const { code } = req.params;
    const { name, position, gmail, contact_no, branch, is_admin } = req.body;
    
    // Safety check: Cannot remove admin status from ID 3
    let finalAdminStatus = is_admin;
    if (code == 3) {
        finalAdminStatus = true;
    }

    try {
        await db.promise().query(
            'UPDATE employeedetails SET name = ?, position = ?, gmail = ?, contact_no = ?, branch = ?, is_admin = ? WHERE code = ?',
            [name, position, gmail, contact_no, branch, finalAdminStatus, code]
        );
        res.json({ success: true, message: 'User updated successfully' });
    } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ success: false, error: 'Failed to update user.' });
    }
});

// Delete user (Admin only)
router.delete('/delete/:code', requireAuth, requireAdmin, async (req, res) => {
    const { code } = req.params;

    // Safety check: Cannot delete user ID 3
    if (code == 3) {
        return res.status(403).json({ success: false, error: 'Cannot delete the primary admin user.' });
    }

    try {
        await db.promise().query('DELETE FROM employeedetails WHERE code = ?', [code]);
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete user.' });
    }
});

module.exports = router;
