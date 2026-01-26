const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);

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

// Helper: Normalize Date String to YYYY-MM-DD
function normalizeDate(dateStr) {
    if (!dateStr) return null;
    const cleanStr = dateStr.trim();
    
    const formats = [
        'DD-MM-YYYY', 'D-M-YYYY',
        'DD/MM/YYYY', 'D/M/YYYY',
        'DD.MM.YYYY', 'D.M.YYYY',
        'YYYY-MM-DD', 'YYYY/MM/DD',
        'DD MMM YYYY', 'D MMM YYYY',
        'DD-MMM-YYYY'
    ];
    
    const d = dayjs(cleanStr, formats, true); // Strict parsing
    if (d.isValid()) return d.format('YYYY-MM-DD');
    
    // Fallback loose parse
    const loose = dayjs(cleanStr);
    if (loose.isValid()) return loose.format('YYYY-MM-DD');
    
    return null;
}

// Helper to safely extract filename from IMAP part
function getFilename(part) {
    // Try disposition params first (standard)
    if (part.disposition && part.disposition.params && part.disposition.params.filename) {
        return part.disposition.params.filename;
    }
    // Fallback to content-type params (sometimes used)
    if (part.params && part.params.name) {
        return part.params.name;
    }
    return null;
}

/**
 * Connects to Gmail, searches for emails based on filters,
 * and returns a list of emails with their valid attachments.
 * 
 * @param {Object} filters - Optional filters
 * @param {string} filters.sender - Filter by sender email
 * @param {string} filters.subjectKeyword - Filter by subject keyword
 * @param {string} filters.afterDate - Filter by date (YYYY-MM-DD)
 * @param {string} filters.fileType - 'csv', 'xlsx', or 'both'
 * @param {number} filters.periodDays - Number of days to look back
 * @param {Object} filters.regexConfig - { invoiceNoRegex, invoiceDateRegex, invoiceNoSource, invoiceDateSource }
 * @param {string} filters.specificInvoiceNo - Filter by extracted invoice no
 * @param {string} filters.specificDate - Filter by extracted date
 */
async function fetchStockEmails(filters = {}) {
    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        // Build Search Criteria
        const searchCriteria = [];
        
        // 1. Date Filter
        // FROM Date
        let sinceDate = new Date();
        if (filters.fromDate) {
            sinceDate = new Date(filters.fromDate);
        } else {
            // Default to 30 days ago if no start date
            sinceDate.setDate(sinceDate.getDate() - 30);
        }
        searchCriteria.push(['SINCE', sinceDate]);

        // TO Date (Optional)
        if (filters.toDate) {
            const beforeDate = new Date(filters.toDate);
            // IMAP 'BEFORE' excludes the date, so add 1 day to include the selected 'toDate'
            beforeDate.setDate(beforeDate.getDate() + 1);
            searchCriteria.push(['BEFORE', beforeDate]);
        }

        // 2. Sender Filter
        if (filters.sender) {
            searchCriteria.push(['FROM', filters.sender]);
        }

        // 3. Subject Filter (Global keyword search, not regex)
        if (filters.subjectKeyword) {
            searchCriteria.push(['SUBJECT', filters.subjectKeyword]);
        }

        const fetchOptions = {
            bodies: ['HEADER', 'TEXT'],
            struct: true
        };

        const messages = await connection.search(searchCriteria, fetchOptions);
        const emailList = [];

        // Sort messages by date (newest first)
        messages.sort((a, b) => {
            const dateA = new Date(a.parts.find(p => p.which === 'HEADER').body.date[0]);
            const dateB = new Date(b.parts.find(p => p.which === 'HEADER').body.date[0]);
            return dateB - dateA;
        });

        // Limit to prevent overloading (higher limit for specific searches)
        const limit = (filters.sender || filters.subjectKeyword) ? 50 : 20;
        const recentMessages = messages.slice(0, limit);

        for (const message of recentMessages) {
            const headerPart = message.parts.find(part => part.which === 'HEADER');
            const subject = headerPart.body.subject[0];
            const from = headerPart.body.from[0];
            const date = headerPart.body.date[0];

            // Check if message has attachments
            const parts = imaps.getParts(message.attributes.struct);
            const attachments = parts.filter(part => {
                if (!part.disposition || part.disposition.type.toUpperCase() !== 'ATTACHMENT') {
                    return false;
                }
                
                const filename = getFilename(part);
                if (!filename) return false;

                const name = filename.toLowerCase();
                const isCsv = name.endsWith('.csv');
                const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls');

                if (filters.fileType === 'csv' && !isCsv) return false;
                if (filters.fileType === 'xlsx' && !isXlsx) return false;
                
                return isCsv || isXlsx;
            });

            if (attachments.length > 0) {
                // --- Smart Extraction & Filtering ---
                let extractedInvoice = null;
                let extractedDate = null;
                let matchFilter = true;

                if (filters.regexConfig) {
                    const textPart = message.parts.find(p => p.which === 'TEXT');
                    let bodyText = textPart ? textPart.body : '';
                    if (bodyText) bodyText = bodyText.replace(/<[^>]*>?/gm, ''); // Strip HTML

                    // Extract Invoice
                    if (filters.regexConfig.invoiceNoRegex) {
                        const sourceText = filters.regexConfig.invoiceNoSource === 'body' ? bodyText : subject;
                        try {
                            const regex = new RegExp(filters.regexConfig.invoiceNoRegex);
                            const match = sourceText.match(regex);
                            if (match) extractedInvoice = match[1] || match[0];
                        } catch (e) { console.error('Regex Error Inv:', e); }
                    }

                    // Extract Date
                    if (filters.regexConfig.invoiceDateRegex) {
                        const sourceText = filters.regexConfig.invoiceDateSource === 'body' ? bodyText : subject;
                        try {
                            const regex = new RegExp(filters.regexConfig.invoiceDateRegex);
                            const match = sourceText.match(regex);
                            if (match) {
                                const rawDate = match[1] || match[0];
                                extractedDate = normalizeDate(rawDate); // Normalize immediately
                            }
                        } catch (e) { console.error('Regex Error Date:', e); }
                    }

                    // Apply Secondary Filters
                    if (filters.specificInvoiceNo) {
                        if (!extractedInvoice || !extractedInvoice.includes(filters.specificInvoiceNo)) {
                            matchFilter = false;
                        }
                    }
                    
                    if (filters.specificDate) {
                        // Compare normalized dates (YYYY-MM-DD)
                        if (!extractedDate || extractedDate !== filters.specificDate) {
                             matchFilter = false;
                        }
                    }
                }

                if (matchFilter) {
                    emailList.push({
                        id: message.attributes.uid,
                        subject: subject,
                        from: from,
                        date: date,
                        attachments: attachments.map(part => getFilename(part)),
                        extractedInvoice: extractedInvoice,
                        extractedDate: extractedDate
                    });
                }
            }
        }

        connection.end();
        return { success: true, emails: emailList };

    } catch (error) {
        console.error('Error fetching emails:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Downloads a specific attachment from a specific email UID.
 * @param {number} uid - The Email UID
 * @param {string} filename - The filename to download
 */
async function downloadAttachment(uid, filename) {
    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const searchCriteria = [['UID', uid]];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT'],
            struct: true
        };

        const messages = await connection.search(searchCriteria, fetchOptions);
        if (messages.length === 0) {
            connection.end();
            throw new Error('Email not found');
        }

        const message = messages[0];
        const parts = imaps.getParts(message.attributes.struct);
        
        const attachmentPart = parts.find(part => 
            part.disposition && 
            part.disposition.type.toUpperCase() === 'ATTACHMENT' && 
            getFilename(part) === filename
        );

        if (!attachmentPart) {
            connection.end();
            throw new Error(`Attachment '${filename}' not found in email.`);
        }

        const partData = await connection.getPartData(message, attachmentPart);
        
        // Ensure temp directory exists
        const tempDir = path.join(__dirname, '..', 'uploads', 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Create a unique filename to avoid collisions
        // Sanitize original filename
        const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueFilename = `GMAIL_${Date.now()}_${safeFilename}`;
        const filePath = path.join(tempDir, uniqueFilename);

        // Write file
        fs.writeFileSync(filePath, partData);

        connection.end();
        return { success: true, filePath: filePath, filename: uniqueFilename };

    } catch (error) {
        console.error('Error downloading attachment:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    fetchStockEmails,
    downloadAttachment
};