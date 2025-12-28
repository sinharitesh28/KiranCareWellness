// server/middleware/auth.js
const path = require('path');

/**
 * Middleware to check if a user is authenticated.
 * It checks for 'req.session.code' which is set upon successful OTP validation.
 * Also supports Bearer token authentication.
 */
const requireAuth = (req, res, next) => {
    // 1. Check Session
    if (req.session && req.session.code) {
        return next();
    }

    // 2. Check Bearer Token (for API calls where cookies might fail)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            // Simple Base64 decode (In production, use JWT)
            const decodedCode = Buffer.from(token, 'base64').toString('utf-8');
            if (decodedCode) {
                // Mock session for compatibility with downstream routes
                req.session = req.session || {};
                req.session.code = decodedCode;
                return next();
            }
        } catch (e) {
            console.warn('Token decode failed:', e.message);
        }
    }

    // 3. Unauthorized Handling
    // Check if the request is an API call
    if (req.path.startsWith('/api/') || req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Session expired or invalid.' });
    }

    // User is not authenticated, redirect to the login page
    // Use an absolute path to the logIn.html file in the project root
    return res.redirect('/'); 
    // Note: Since app.js maps '/' to logIn.html, this is the correct redirect.
    // If your login page was /login, you would use res.redirect('/login');
};

module.exports = requireAuth;