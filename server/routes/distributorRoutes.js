const express = require('express');
const router = express.Router();
const db = require('../db');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx'); 
const csv = require('csv-parser');
const requireAuth = require('../middleware/auth');
const gmailService = require('../services/gmailService');

require('dotenv').config();

const config = {
    imap: {
        user: process.env.MAIL_USER,
        password: process.env.MAIL_PASS,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        authTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

// ... (Helper functions levenshtein, getSimilarity, getFilename, extractSubjectKeyword remain the same)
// Helper: Levenshtein Distance for Fuzzy Matching
function levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function getSimilarity(s1, s2) {
    const longer = s1.length > s2.length ? s1 : s2;
    if (longer.length === 0) return 1.0;
    return (longer.length - levenshtein(s1, s2)) / longer.length;
}

// Master System Columns (Aligned with importTemplate)
const SYSTEM_COLUMNS = [
    { key: 'item_name_col', label: 'Item Name', keywords: ['product', 'item', 'description', 'name', 'particular', 'material', 'desc'] },
    { key: 'item_desc_col', label: 'Item Description', keywords: ['description', 'desc', 'spec', 'type'] },
    { key: 'batch_number_col', label: 'Batch Number', keywords: ['batch', 'lot', 'serial'] },
    { key: 'expiry_date_col', label: 'Expiry Date', keywords: ['expiry', 'exp', 'validity', 'date'] },
    { key: 'quantity_col', label: 'Quantity', keywords: ['qty', 'quantity', 'units', 'stock', 'billed'] },
    { key: 'free_col', label: 'Free Quantity', keywords: ['free', 'scheme', 'bonus', 'f.q', 'free qty'] },
    { key: 'mrp_col', label: 'MRP', keywords: ['mrp', 'max price', 'maximum retail price'] },
    { key: 'rate_col', label: 'Rate/Price', keywords: ['rate', 'price', 'cost', 'pts', 'ptr', 'unit price'] },
    { key: 'hsn_code_col', label: 'HSN Code', keywords: ['hsn', 'sac'] },
    { key: 'manufacturer_col', label: 'Manufacturer', keywords: ['mfg', 'manufacturer', 'company', 'make', 'brand'] },
    { key: 'packing_col', label: 'Packing', keywords: ['pack', 'packing', 'size', 'unit'] },
    { key: 'invoice_no_col', label: 'Invoice No (Row)', keywords: ['invoice', 'bill', 'inv no'] },
    { key: 'invoice_date_col', label: 'Invoice Date (Row)', keywords: ['inv date', 'bill date', 'date'] }
];

function getFilename(part) {
    if (part.disposition && part.disposition.params && part.disposition.params.filename) {
        return part.disposition.params.filename;
    }
    if (part.params && part.params.name) {
        return part.params.name;
    }
    return null;
}

function extractSubjectKeyword(subject) {
    if (!subject) return 'Invoice';
    const clean = subject.replace(/re:|fwd:|\[.*?\]|\(.*?\)|[^a-zA-Z\s]/gi, ' ').trim();
    const types = ['invoice', 'bill', 'stock', 'statement', 'order', 'credit', 'debit', 'note', 'report', 'challan', 'summary', 'details'];
    const foundType = types.find(t => clean.toLowerCase().includes(t));
    if (foundType) return foundType.charAt(0).toUpperCase() + foundType.slice(1);
    const words = clean.split(/\s+/).filter(w => w.length > 3 && !/test|demo|mail/i.test(w));
    return words.length > 0 ? words[0] : 'Invoice';
}

// 1. Fetch Email Metadata (Enhanced for Re-fetch and Direct UID)
router.post('/fetch-email-metadata', requireAuth, async (req, res) => {
    const { emailUrl, searchSubject, searchSender, configId, directUid } = req.body;

    // Logic: If configId is present, we look up the gmail_thread_id from DB
    let threadId = null;
    let isUrl = false;
    let searchCriteria = [];
    let savedConfig = {};

    // 1. Priority: Direct UID (from Search List)
    if (directUid) {
        // IMAP uses UID for fetching, so we can set search criteria directly
        // Note: threadId logic below was for saving config. We can treat UID as threadId equivalent for now.
        threadId = directUid;
        searchCriteria = [['UID', directUid]];
    }
    // 2. Priority: Config ID (Re-fetch)
    else if (configId) {
        try {
            const [rows] = await db.promise().query('SELECT gmail_thread_id, email_sender, invoice_no_regex, invoice_date_regex, invoice_no_source, invoice_date_source FROM distributor_email_config WHERE id = ?', [configId]);
            if (rows.length > 0) {
                threadId = rows[0].gmail_thread_id;
                savedConfig = rows[0];
                // If we have a thread ID (or UID stored as threadID), ideally use it.
                // But for now, we just re-search by sender as a fallback if threadId isn't a direct UID
                // IF we stored actual UID in gmail_thread_id, we could use [['UID', threadId]]
                // For safety in this hybrid state:
                searchCriteria.push(['FROM', rows[0].email_sender]);
            }
        } catch (e) { console.error('DB Lookup error', e); }
    }

    if (!threadId && !directUid) {
        if (emailUrl) {
            if (emailUrl.includes('mail.google.com') || emailUrl.includes('://')) {
                isUrl = true;
                const parts = emailUrl.split('/');
                const lastPart = parts[parts.length - 1];
                threadId = lastPart.split('?')[0].split('#')[0]; 
            } else {
                isUrl = false;
                searchCriteria.push(['SUBJECT', emailUrl]);
            }
        }
        if (searchSender) searchCriteria.push(['FROM', searchSender]);
        if (searchSubject) searchCriteria.push(['SUBJECT', searchSubject]);
    }

    // Default: Recent 3 days
    if (searchCriteria.length === 0) {
        const date = new Date();
        date.setDate(date.getDate() - 3);
        searchCriteria = [['SINCE', date]]; 
    }

    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const fetchOptions = { bodies: ['HEADER', 'TEXT'], struct: true };
        const messages = await connection.search(searchCriteria, fetchOptions);

        messages.sort((a, b) => {
            const dateA = new Date(a.parts.find(p => p.which === 'HEADER').body.date[0]);
            const dateB = new Date(b.parts.find(p => p.which === 'HEADER').body.date[0]);
            return dateB - dateA;
        });

        // Search for attachment
        let targetMessage = null;
        let attachmentName = null;

        for (const msg of messages) {
            const parts = imaps.getParts(msg.attributes.struct);
            const attachment = parts.find(part => {
                if (!part.disposition || part.disposition.type.toUpperCase() !== 'ATTACHMENT') return false;
                const name = getFilename(part).toLowerCase();
                return name.endsWith('.csv') || name.endsWith('.xlsx');
            });

            if (attachment) {
                targetMessage = msg;
                attachmentName = getFilename(attachment);
                break;
            }
        }

        if (!targetMessage) {
            connection.end();
            return res.status(404).json({ success: false, error: 'No recent email found with CSV/Excel attachment.' });
        }

        const headerPart = targetMessage.parts.find(p => p.which === 'HEADER');
        const header = headerPart.body;

        // Extract Body Text
        let bodyText = '';
        const textPart = targetMessage.parts.find(p => p.which === 'TEXT');
        if (textPart) {
            bodyText = textPart.body;
        }
        
        // Clean up body text (basic cleanup)
        if (bodyText) bodyText = bodyText.replace(/<[^>]*>?/gm, ''); // Remove HTML tags

        const metadata = {
            id: targetMessage.attributes.uid,
            threadId: threadId || targetMessage.attributes.uid, // Store UID as ThreadID approx for now
            subject: header.subject[0],
            sender: header.from[0],
            date: header.date[0],
            fileName: attachmentName,
            fileType: attachmentName.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx',
            bodyText: bodyText, // Return the body text
            // Return Saved Configs if any
            invoiceNoRegex: savedConfig.invoice_no_regex,
            invoiceDateRegex: savedConfig.invoice_date_regex,
            invoiceNoSource: savedConfig.invoice_no_source,
            invoiceDateSource: savedConfig.invoice_date_source
        };

        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/; // Corrected escape for '.'
        const senderMatch = metadata.sender.match(emailRegex);
        metadata.senderEmail = senderMatch ? senderMatch[1] : metadata.sender;

        const nameMatch = metadata.sender.match(/^"?([^"<]+)"?/); // Corrected escape for '"'
        metadata.distributorName = nameMatch ? nameMatch[1].trim() : metadata.senderEmail.split('@')[0];
        metadata.subjectKeyword = extractSubjectKeyword(metadata.subject);

        connection.end();
        res.json({ success: true, metadata });

    } catch (err) {
        console.error('Fetch metadata error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. Analyze File (Same as before)
router.post('/analyze-file', requireAuth, async (req, res) => {
    const { uid, fileName } = req.body;
    if (!uid || !fileName) return res.status(400).json({ success: false, error: 'UID required' });

    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');
        const messages = await connection.search([['UID', uid]], { bodies: ['HEADER'], struct: true });
        if (messages.length === 0) throw new Error('Message not found');
        
        const message = messages[0];
        const parts = imaps.getParts(message.attributes.struct);
        const attachmentPart = parts.find(part => getFilename(part) === fileName);
        if (!attachmentPart) throw new Error('Attachment not found');

        const partData = await connection.getPartData(message, attachmentPart);
        connection.end();

        let fileHeaders = [];
        if (fileName.toLowerCase().endsWith('.csv')) {
            const content = partData.toString('utf8');
            const lines = content.split(/\r?\n/); // Corrected escape for '\n'
            if (lines.length > 0) fileHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '')); // Corrected escape for '"'
        } else {
            const workbook = xlsx.read(partData, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
            if (jsonData.length > 0) fileHeaders = jsonData[0];
        }

        const mapping = SYSTEM_COLUMNS.map(sysCol => {
            let bestMatch = '';
            let bestScore = 0;
            fileHeaders.forEach(header => {
                const lowerHeader = header.toLowerCase();
                let score = 0;
                if (sysCol.keywords.some(k => lowerHeader.includes(k))) score = 0.9;
                const similarity = getSimilarity(lowerHeader, sysCol.label.toLowerCase());
                if (similarity > score) score = similarity;
                if (score > bestScore) { bestScore = score; bestMatch = header; }
            });
            let confidence = bestScore >= 0.85 ? 'high' : (bestScore >= 0.5 ? 'moderate' : 'poor');
            if (bestScore < 0.4) bestMatch = '';
            return { systemColumn: sysCol.key, systemLabel: sysCol.label, suggestedHeader: bestMatch, confidence, score: bestScore };
        });

        res.json({ success: true, mapping, fileHeaders });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Save Config (Updated with gmail_thread_id)
router.post('/save-config', requireAuth, async (req, res) => {
    const { 
        distributorName, emailSender, subjectKeyword, fileType, mapping, gmailThreadId,
        invoiceNoRegex, invoiceDateRegex, invoiceNoSource, invoiceDateSource
    } = req.body;

    if (!distributorName || !emailSender || !mapping) return res.status(400).json({ success: false, error: 'Missing fields' });

    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const templateData = {};
        mapping.forEach(m => {
            if (m.systemColumn && m.fileHeader) templateData[m.systemColumn] = m.fileHeader;
        });

        const templateName = `Auto_${distributorName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
        const defaults = { item_name_col: 'ItemName', quantity_col: 'Qty', rate_col: 'Rate', mrp_col: 'MRP', vendor_detail_col: 'Vendor' };

        const [tplRes] = await connection.query(`
            INSERT INTO importTemplate (
                template_name, vendor_detail_col, item_name_col, item_desc_col,
                manufacturer_col, batch_number_col, hsn_code_col, quantity_col,
                free_col, rate_col, mrp_col, packing_col, expiry_date_col, invoice_no_col, invoice_date_col
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            templateName,
            defaults.vendor_detail_col,
            templateData.item_name_col || defaults.item_name_col,
            templateData.item_desc_col || null,
            templateData.manufacturer_col || null,
            templateData.batch_number_col || null,
            templateData.hsn_code_col || null,
            templateData.quantity_col || defaults.quantity_col,
            templateData.free_col || null,
            templateData.rate_col || defaults.rate_col,
            templateData.mrp_col || defaults.mrp_col,
            templateData.packing_col || null,
            templateData.expiry_date_col || null,
            templateData.invoice_no_col || null,
            templateData.invoice_date_col || null
        ]);

        const templateId = tplRes.insertId;

        const [existing] = await connection.query('SELECT id FROM distributor_email_config WHERE email_sender = ?', [emailSender]);
        
        if (existing.length > 0) {
            await connection.query(`
                UPDATE distributor_email_config 
                SET distributor_name = ?, subject_keyword = ?, file_type_preference = ?, template_id = ?, gmail_thread_id = ?,
                invoice_no_regex = ?, invoice_date_regex = ?, invoice_no_source = ?, invoice_date_source = ?
                WHERE email_sender = ?
            `, [
                distributorName, subjectKeyword, fileType || 'both', templateId, gmailThreadId || null,
                invoiceNoRegex || null, invoiceDateRegex || null, invoiceNoSource || null, invoiceDateSource || null,
                emailSender
            ]);
        } else {
            await connection.query(`
                INSERT INTO distributor_email_config 
                (distributor_name, email_sender, subject_match_type, subject_keyword, file_type_preference, template_id, gmail_thread_id,
                invoice_no_regex, invoice_date_regex, invoice_no_source, invoice_date_source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                distributorName, emailSender, 'contains', subjectKeyword, fileType || 'both', templateId, gmailThreadId || null,
                invoiceNoRegex || null, invoiceDateRegex || null, invoiceNoSource || null, invoiceDateSource || null
            ]);
        }

        await connection.commit();
        res.json({ success: true, message: 'Saved successfully.' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// 4. List Configs
router.get('/list-configs', requireAuth, async (req, res) => {
    try {
        const [rows] = await db.promise().query(`
            SELECT c.id, c.distributor_name, c.email_sender, c.subject_keyword, c.file_type_preference, c.gmail_thread_id, 
                   c.invoice_no_regex, c.invoice_date_regex, c.invoice_no_source, c.invoice_date_source,
                   t.template_name
            FROM distributor_email_config c
            LEFT JOIN importTemplate t ON c.template_id = t.id
            ORDER BY c.created_at DESC
        `);
        res.json({ success: true, configs: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. Delete Config
router.delete('/delete-config/:id', requireAuth, async (req, res) => {
    try {
        await db.promise().query('DELETE FROM distributor_email_config WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. List Recent Emails (Candidate Selection)
router.post('/list-recent-emails', requireAuth, async (req, res) => {
    try {
        const { keyword } = req.body;
        
        // Construct filters for gmailService
        const filters = {
            periodDays: 7 // Default to last 7 days for quick selection
        };

        if (keyword) {
            // Check if keyword is an email address
            if (keyword.includes('@')) {
                filters.sender = keyword;
            } else {
                filters.subjectKeyword = keyword;
            }
        }

        const result = await gmailService.fetchStockEmails(filters);
        
        if (result.success) {
            // Map to a lightweight format for the UI
            const candidates = result.emails.map(e => ({
                id: e.id,
                subject: e.subject,
                sender: e.from,
                date: e.date,
                hasAttachment: e.attachments.length > 0
            }));
            res.json({ success: true, candidates });
        } else {
            res.status(500).json(result);
        }
    } catch (err) {
        console.error('List candidates error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
