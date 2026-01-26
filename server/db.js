const mysql = require('mysql2');

const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kiranrxsmart',
    ssl: {
        rejectUnauthorized: false
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Function to check if column exists and add it if not
function addColumnIfNotExists(tableName, columnName, columnDefinition) {
    return new Promise((resolve, reject) => {
        const checkColumnSql = `
            SELECT COUNT(*) as column_exists 
            FROM information_schema.columns 
            WHERE table_schema = ? 
            AND table_name = ? 
            AND column_name = ?
        `;

        db.query(checkColumnSql, [db.config.database, tableName, columnName], (err, results) => {
            if (err) {
                console.error(`Error checking column ${columnName}:`, err);
                reject(err);
                return;
            }

            const columnExists = results[0].column_exists > 0;

            if (!columnExists) {
                const addColumnSql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`;
                db.query(addColumnSql, (addErr) => {
                    if (addErr) {
                        console.error(`Error adding column ${columnName}:`, addErr);
                        reject(addErr);
                    } else {
                        console.log(`Column ${columnName} added to ${tableName}`);
                        resolve();
                    }
                });
            } else {
                console.log(`Column ${columnName} already exists in ${tableName}`);
                resolve();
            }
        });
    });
}

// Connect and ensure necessary tables exist
// Pool handles connections automatically
console.log('Database pool created.');

// SQL to create Import Template Table
const createImportTemplateTable = `
CREATE TABLE IF NOT EXISTS importTemplate (
    id INT AUTO_INCREMENT PRIMARY KEY,
    template_name VARCHAR(255) NOT NULL UNIQUE,
    vendor_detail_col VARCHAR(255) NOT NULL,
    invoice_no_col VARCHAR(255),
    invoice_date_col VARCHAR(255),
    invoice_date_format VARCHAR(50),
    item_name_col VARCHAR(255) NOT NULL,
    item_desc_col VARCHAR(255),
    manufacturer_col VARCHAR(255),
    batch_number_col VARCHAR(255),
    hsn_code_col VARCHAR(255),
    quantity_col VARCHAR(255) NOT NULL,
    free_col VARCHAR(255),
    rate_col VARCHAR(255) NOT NULL,
    mrp_col VARCHAR(255) NOT NULL,
    packing_col VARCHAR(255),  -- CHANGED: Replaced mfg_date_col with packing_col
    expiry_date_col VARCHAR(255),
    expiry_date_format VARCHAR(50)
);`;

// SQL to create Import Stock Master Table WITH invoice_date
const createImportStockMasterTable = `
    CREATE TABLE IF NOT EXISTS import_stock_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        template_id INT NOT NULL,
        invoice_no VARCHAR(255),
        invoice_date DATE,
        vendor_name VARCHAR(255),
        import_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        imported_by_user_id VARCHAR(255),
        FOREIGN KEY (template_id) REFERENCES importTemplate(id)
    );`;

// SQL to create Import Stock Detail Table WITH ALL COLUMNS
const createImportStockDetailTable = `
CREATE TABLE IF NOT EXISTS import_stock_detail (
    id INT AUTO_INCREMENT PRIMARY KEY,
    master_id INT NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    item_desc VARCHAR(255),
    manufacturer VARCHAR(255),
    hsn_code VARCHAR(255),
    batch_number VARCHAR(255),
    expiry_date DATE,
    packing INT NULL,  -- CHANGED: Allow NULL values
    quantity INT NOT NULL,
    loose_quantity INT DEFAULT 0, -- NEW: Track loose units in the same table
    free_quantity INT DEFAULT 0,
    rate DECIMAL(10, 2) NOT NULL,
    mrp DECIMAL(10, 2),
    location VARCHAR(255) NOT NULL,
    barcode VARCHAR(100),
    barcode_printed BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (master_id) REFERENCES import_stock_master(id)
);`;

// SQL to create Barcode Print Log Table
const createBarcodePrintLogTable = `
    CREATE TABLE IF NOT EXISTS barcode_print_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        stock_detail_id INT NOT NULL,
        printed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        printed_by_user_id VARCHAR(255),
        print_reason ENUM('initial_import', 'reprint', 'damaged'),
        print_count INT DEFAULT 1,
        FOREIGN KEY (stock_detail_id) REFERENCES import_stock_detail(id)
    );`;

// Execute table creation queries
db.query(createImportTemplateTable, (err) => {
    if (err) console.error('Error creating importTemplate table:', err.message);
    else console.log('importTemplate table checked/created.');
});

db.query(createImportStockMasterTable, (err) => {
    if (err) console.error('Error creating import_stock_master table:', err.message);
    else console.log('import_stock_master table checked/created.');
});

db.query(createImportStockDetailTable, (err) => {
    if (err) console.error('Error creating import_stock_detail table:', err.message);
    else console.log('import_stock_detail table checked/created.');
});

db.query(createBarcodePrintLogTable, (err) => {

    if (err) console.error('Error creating barcode_print_log table:', err.message);

    else console.log('barcode_print_log table checked/created.');

});



// Add missing columns after a delay to ensure tables are created

setTimeout(() => {
    console.log('Checking and adding missing columns...');

    const columnAdditions = [
        // Add missing columns to import_stock_master
        { table: 'import_stock_master', column: 'invoice_date', definition: 'DATE' },

        // Add missing columns to import_stock_detail
        { table: 'import_stock_detail', column: 'item_desc', definition: 'VARCHAR(255)' },
        { table: 'import_stock_detail', column: 'manufacturer', definition: 'VARCHAR(255)' },
        { table: 'import_stock_detail', column: 'hsn_code', definition: 'VARCHAR(255)' },
        { table: 'import_stock_detail', column: 'packing', definition: 'INT NULL' },
        { table: 'import_stock_detail', column: 'loose_quantity', definition: 'INT DEFAULT 0' },
        { table: 'import_stock_detail', column: 'barcode', definition: 'VARCHAR(100)' },
        { table: 'import_stock_detail', column: 'barcode_printed', definition: 'BOOLEAN DEFAULT FALSE' },

        // ADD THIS: Add packing_col to importTemplate table
        { table: 'importTemplate', column: 'packing_col', definition: 'VARCHAR(255)' },

        // Add gmail_thread_id to distributor_email_config
        { table: 'distributor_email_config', column: 'gmail_thread_id', definition: 'VARCHAR(255) NULL' },

        // Add Smart Invoice Extraction columns to distributor_email_config
        { table: 'distributor_email_config', column: 'invoice_no_regex', definition: 'VARCHAR(500) NULL' },
        { table: 'distributor_email_config', column: 'invoice_date_regex', definition: 'VARCHAR(500) NULL' },
        { table: 'distributor_email_config', column: 'invoice_no_source', definition: "ENUM('subject', 'body') NULL" },
        { table: 'distributor_email_config', column: 'invoice_date_source', definition: "ENUM('subject', 'body') NULL" }
    ];

    // Process column additions sequentially
    async function processColumnAdditions() {
        for (const addition of columnAdditions) {
            try {
                await addColumnIfNotExists(addition.table, addition.column, addition.definition);
                // Small delay between operations
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`Failed to process column ${addition.column}:`, error);
            }
        }
        console.log('All column checks completed.');
    }

    processColumnAdditions();
}, 2000);
// Wait 2 seconds for tables to be created

// TRANSACTION TABLES - Updated to make customer details optional
// In db.js, add to the customerDetails table creation
const createCustomerDetailsTable = `
CREATE TABLE IF NOT EXISTS customerDetails (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mobile_no VARCHAR(15) NULL,
    name VARCHAR(255) NULL,
    email VARCHAR(255) NULL,  -- NEW: Add email column
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_mobile (mobile_no),
    INDEX idx_email (email)  -- NEW: Add index for email
);`;

// Add email column if it doesn't exist
setTimeout(() => {
    console.log('Checking and adding customer email column...');

    const customerColumnAdditions = [
        { table: 'customerDetails', column: 'email', definition: 'VARCHAR(255) NULL' }
    ];

    async function processCustomerColumnAdditions() {
        for (const addition of customerColumnAdditions) {
            try {
                await addColumnIfNotExists(addition.table, addition.column, addition.definition);
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`Failed to process column ${addition.column}:`, error);
            }
        }
        console.log('Customer email column check completed.');
    }

    processCustomerColumnAdditions();
}, 3500);

const createTransactionsTable = `
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NULL,  -- Changed to NULL to allow optional customer
    total_amount DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    discount_type ENUM('fixed', 'percentage') DEFAULT 'fixed',
    payment_method ENUM('cash', 'card', 'upi', 'pay_later') DEFAULT 'cash',
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    bill_number VARCHAR(100) UNIQUE,
    bill_pdf_path VARCHAR(500),
    whatsapp_sent BOOLEAN DEFAULT FALSE,
    status ENUM('completed', 'pending', 'cancelled') DEFAULT 'completed',
    created_by_user_id VARCHAR(255),
    customer_mobile VARCHAR(15) NULL,  -- Store customer mobile directly for quick reference
    customer_name VARCHAR(255) NULL,   -- Store customer name directly for quick reference
    FOREIGN KEY (customer_id) REFERENCES customerDetails(id) ON DELETE SET NULL
);`;

const createTransactionItemsTable = `
CREATE TABLE IF NOT EXISTS transaction_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT NOT NULL,
    stock_detail_id INT NULL,
    item_name VARCHAR(255) NOT NULL,
    item_description TEXT,
    mrp DECIMAL(10,2) NOT NULL,
    selling_price DECIMAL(10,2) NOT NULL,
    quantity INT NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    location VARCHAR(100),
    is_manual BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
    FOREIGN KEY (stock_detail_id) REFERENCES import_stock_detail(id)
);`;

// SQL to create Reminders Table
const createRemindersTable = `
CREATE TABLE IF NOT EXISTS reminders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    transaction_id INT NOT NULL,
    transaction_item_id INT NOT NULL,
    medicine_name VARCHAR(255) NOT NULL,
    dosage_time VARCHAR(50) NOT NULL,
    scheduled_time TIME NOT NULL,
    status ENUM('pending', 'sent', 'taken', 'skipped', 'snoozed') DEFAULT 'pending',
    sent_at DATETIME NULL,
    response_at DATETIME NULL,
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customerDetails(id) ON DELETE CASCADE,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
    FOREIGN KEY (transaction_item_id) REFERENCES transaction_items(id) ON DELETE CASCADE
);`;

// Execute new table creation queries
db.query(createCustomerDetailsTable, (err) => {
    if (err) console.error('Error creating customerDetails table:', err.message);
    else console.log('customerDetails table checked/created.');
});

db.query(createTransactionsTable, (err) => {
    if (err) console.error('Error creating transactions table:', err.message);
    else console.log('transactions table checked/created.');
});

db.query(createTransactionItemsTable, (err) => {
    if (err) console.error('Error creating transaction_items table:', err.message);
    else console.log('transaction_items table checked/created.');
});

db.query(createRemindersTable, (err) => {
    if (err) console.error('Error creating reminders table:', err.message);
    else console.log('reminders table checked/created.');
});

/*
// SQL to create Dose Stock Table
const createDoseStockTable = `
CREATE TABLE IF NOT EXISTS dose_stock (
    id INT AUTO_INCREMENT PRIMARY KEY,
    original_stock_id INT NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    item_description TEXT,
    mrp DECIMAL(10, 2),
    rate DECIMAL(10, 2),
    total_doses INT NOT NULL,
    remaining_doses INT NOT NULL,
    packing_size INT NOT NULL,
    location VARCHAR(255),
    created_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (original_stock_id) REFERENCES import_stock_detail(id),
    INDEX idx_original_stock (original_stock_id),
    INDEX idx_remaining_doses (remaining_doses)
);`;

// Execute table creation query
db.query(createDoseStockTable, (err) => {
    if (err) console.error('Error creating dose_stock table:', err.message);
    else console.log('dose_stock table checked/created.');
});
*/

// Add missing columns to transactions table
setTimeout(() => {
    console.log('Checking and adding dose dispensing columns to transaction_items table...');

    const transactionItemsColumnAdditions = [
        { table: 'transaction_items', column: 'dose_dispensing', definition: 'BOOLEAN DEFAULT FALSE' },
        { table: 'transaction_items', column: 'dose_stock_id', definition: 'INT NULL' },
        { table: 'transaction_items', column: 'dose_quantity', definition: 'INT NULL' },
        { table: 'transaction_items', column: 'dose_unit_price', definition: 'DECIMAL(10,2) NULL' },
        // New columns for reminders
        { table: 'transaction_items', column: 'dosage_schedule', definition: 'VARCHAR(50) NULL' }, // e.g., "1-0-1-0" (M-A-E-N)
        { table: 'transaction_items', column: 'dosage_days', definition: 'INT DEFAULT 1' }
    ];

    // NEW: Add auditing columns to transactions table
    const transactionColumnAdditions = [
        { table: 'transactions', column: 'is_modified', definition: 'BOOLEAN DEFAULT FALSE' },
        { table: 'transactions', column: 'original_amount', definition: 'DECIMAL(10,2) NULL' }
    ];

    async function processTransactionItemsColumnAdditions() {
        // Process items columns
        for (const addition of transactionItemsColumnAdditions) {
            try {
                await addColumnIfNotExists(addition.table, addition.column, addition.definition);
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`Failed to process column ${addition.column}:`, error);
            }
        }

        // Process transactions columns
        for (const addition of transactionColumnAdditions) {
            try {
                await addColumnIfNotExists(addition.table, addition.column, addition.definition);
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`Failed to process column ${addition.column}:`, error);
            }
        }

        console.log('All transaction schema checks completed.');
    }

    processTransactionItemsColumnAdditions();
}, 4000);

// Add missing columns to customerDetails table
setTimeout(() => {
    console.log('Checking and adding extra columns to customerDetails table...');

    const customerExtraColumnAdditions = [
        { table: 'customerDetails', column: 'telegram_chat_id', definition: 'VARCHAR(100) NULL' },
        { table: 'customerDetails', column: 'preferred_language', definition: "VARCHAR(10) DEFAULT 'en'" }
    ];

    async function processCustomerExtraColumnAdditions() {
        for (const addition of customerExtraColumnAdditions) {
            try {
                await addColumnIfNotExists(addition.table, addition.column, addition.definition);
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`Failed to process column ${addition.column}:`, error);
            }
        }
        console.log('Customer extra columns check completed.');
    }

    processCustomerExtraColumnAdditions();
}, 4500);

// Add is_admin column to employeedetails
setTimeout(() => {
    console.log('Checking and adding is_admin column to employeedetails table...');

    async function setupEmployeeAdmin() {
        try {
            await addColumnIfNotExists('employeedetails', 'is_admin', 'BOOLEAN DEFAULT FALSE');

            // Set user ID 3 as admin for now
            const updateAdminSql = 'UPDATE employeedetails SET is_admin = TRUE WHERE code = 3';
            db.query(updateAdminSql, (err) => {
                if (err) console.error('Error setting initial admin:', err.message);
                else console.log('Admin user updated (ID 3).');
            });
        } catch (error) {
            console.error('Failed to setup employee admin column:', error);
        }
    }

    setupEmployeeAdmin();
}, 5000);

// Add telegram_chat_id to employeedetails
setTimeout(() => {
    console.log('Checking and adding telegram_chat_id to employeedetails table...');
    addColumnIfNotExists('employeedetails', 'telegram_chat_id', 'VARCHAR(100) NULL')
        .then(() => console.log('Employee Telegram ID column check completed.'))
        .catch(err => console.error('Failed to add Employee Telegram ID column:', err));
}, 5500);

// Add Indexes
setTimeout(() => {
    console.log('Checking and adding indexes...');

    const indexAdditions = [
        { table: 'employeedetails', column: 'telegram_chat_id', indexName: 'idx_telegram_chat_id' },
        { table: 'import_stock_detail', column: 'item_name', indexName: 'idx_item_name' },
        { table: 'import_stock_detail', column: 'barcode', indexName: 'idx_barcode' }
    ];

    async function processIndexAdditions() {
        for (const addition of indexAdditions) {
            try {
                // Check if index exists
                const [rows] = await db.promise().query(
                    `SELECT COUNT(1) as IndexIsThere FROM INFORMATION_SCHEMA.STATISTICS 
                     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
                    [addition.table, addition.indexName]
                );

                if (rows[0].IndexIsThere === 0) {
                    await db.promise().query(`CREATE INDEX ${addition.indexName} ON ${addition.table} (${addition.column})`);
                    console.log(`Index ${addition.indexName} created on ${addition.table}`);
                }
            } catch (error) {
                console.error(`Index check/create failed for ${addition.indexName}:`, error.message);
            }
        }
        console.log('Index checks completed.');
    }

    processIndexAdditions();
}, 6000);

module.exports = db;
