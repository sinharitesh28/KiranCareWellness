// server/middleware/auth.js
const path = require('path');

/**
 * Middleware to check if a user is authenticated.
 * It checks for 'req.session.code' which is set upon successful OTP validation.
 */
const requireAuth = (req, res, next) => {
    // Check if the employee code is stored in the session
    if (req.session && req.session.code) {
        // User is authenticated, proceed to the next middleware or route handler
        return next();
    } else {
        // Check if the request is an API call
        if (req.path.startsWith('/api/') || req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Session expired or invalid.' });
        }

        // User is not authenticated, redirect to the login page
        // Use an absolute path to the logIn.html file in the project root
        return res.redirect('/'); 
        // Note: Since app.js maps '/' to logIn.html, this is the correct redirect.
        // If your login page was /login, you would use res.redirect('/login');
    }
};

module.exports = requireAuth;