// server/bot/session.js

// Simple in-memory session store for MVP
// In a production environment, use Redis or database
const sessionStore = new Map();

// Helper to get session securely
const getSession = (chatId) => {
    if (!sessionStore.has(chatId)) {
        sessionStore.set(chatId, {
            items: [],           // Cart items
            customerId: null,    // Linked customer ID for this transaction (if any)
            tempPriceEditId: null, // ID of item being price-edited
            employeeId: null     // For staff sessions
        });
    }
    return sessionStore.get(chatId);
};

// Helper to clear session but keep auth info if needed
const clearSession = (chatId) => {
    const current = sessionStore.get(chatId);
    if (current) {
        // Reset transactional data, keep employee link if we want (though that's in DB)
        // Actually, we can just reset items and customerId
        current.items = [];
        current.customerId = null;
        current.tempPriceEditId = null;
    }
};

module.exports = {
    sessionStore,
    getSession,
    clearSession
};
