-- MySQL Schema for KiranCareWellness

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Employee Details Table
CREATE TABLE IF NOT EXISTS `employeedetails` (
    `code` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(255),
    `position` VARCHAR(255),
    `gmail` VARCHAR(255),
    `contact_no` VARCHAR(255),
    `branch` VARCHAR(255),
    `is_admin` BOOLEAN DEFAULT FALSE,
    `telegram_chat_id` VARCHAR(100) NULL,
    INDEX `idx_telegram_chat_id` (`telegram_chat_id`)
);

-- 2. Import Template Table
CREATE TABLE IF NOT EXISTS `importTemplate` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `template_name` VARCHAR(255) NOT NULL UNIQUE,
    `vendor_detail_col` VARCHAR(255) NOT NULL,
    `invoice_no_col` VARCHAR(255),
    `invoice_date_col` VARCHAR(255),
    `invoice_date_format` VARCHAR(50),
    `item_name_col` VARCHAR(255) NOT NULL,
    `item_desc_col` VARCHAR(255),
    `manufacturer_col` VARCHAR(255),
    `batch_number_col` VARCHAR(255),
    `hsn_code_col` VARCHAR(255),
    `quantity_col` VARCHAR(255) NOT NULL,
    `free_col` VARCHAR(255),
    `rate_col` VARCHAR(255) NOT NULL,
    `mrp_col` VARCHAR(255) NOT NULL,
    `packing_col` VARCHAR(255),
    `expiry_date_col` VARCHAR(255),
    `expiry_date_format` VARCHAR(50)
);

-- 3. Import Stock Master Table
CREATE TABLE IF NOT EXISTS `import_stock_master` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `template_id` INT NOT NULL,
    `invoice_no` VARCHAR(255),
    `invoice_date` DATE,
    `vendor_name` VARCHAR(255),
    `import_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `imported_by_user_id` VARCHAR(255),
    FOREIGN KEY (`template_id`) REFERENCES `importTemplate`(`id`)
);

-- 4. Import Stock Detail Table
CREATE TABLE IF NOT EXISTS `import_stock_detail` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `master_id` INT NOT NULL,
    `item_name` VARCHAR(255) NOT NULL,
    `item_desc` VARCHAR(255),
    `manufacturer` VARCHAR(255),
    `hsn_code` VARCHAR(255),
    `batch_number` VARCHAR(255),
    `expiry_date` DATE,
    `packing` INT NULL,
    `quantity` INT NOT NULL,
    `loose_quantity` INT DEFAULT 0,
    `free_quantity` INT DEFAULT 0,
    `rate` DECIMAL(10, 2) NOT NULL,
    `mrp` DECIMAL(10, 2),
    `location` VARCHAR(255) NOT NULL,
    `barcode` VARCHAR(100),
    `barcode_printed` BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (`master_id`) REFERENCES `import_stock_master`(`id`),
    INDEX `idx_item_name` (`item_name`),
    INDEX `idx_barcode` (`barcode`)
);

-- 5. Barcode Print Log Table
CREATE TABLE IF NOT EXISTS `barcode_print_log` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `stock_detail_id` INT NOT NULL,
    `printed_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `printed_by_user_id` VARCHAR(255),
    `print_reason` ENUM('initial_import', 'reprint', 'damaged'),
    `print_count` INT DEFAULT 1,
    FOREIGN KEY (`stock_detail_id`) REFERENCES `import_stock_detail`(`id`)
);

-- 6. Customer Details Table
CREATE TABLE IF NOT EXISTS `customerDetails` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `mobile_no` VARCHAR(15) NULL,
    `name` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `telegram_chat_id` VARCHAR(100) NULL,
    `preferred_language` VARCHAR(10) DEFAULT 'en',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_mobile` (`mobile_no`),
    INDEX `idx_email` (`email`)
);

-- 7. Transactions Table
CREATE TABLE IF NOT EXISTS `transactions` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `customer_id` INT NULL,
    `total_amount` DECIMAL(10,2) NOT NULL,
    `discount_amount` DECIMAL(10,2) DEFAULT 0,
    `discount_type` ENUM('fixed', 'percentage') DEFAULT 'fixed',
    `payment_method` ENUM('cash', 'card', 'upi', 'pay_later') DEFAULT 'cash',
    `transaction_date` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `bill_number` VARCHAR(100) UNIQUE,
    `bill_pdf_path` VARCHAR(500),
    `whatsapp_sent` BOOLEAN DEFAULT FALSE,
    `status` ENUM('completed', 'pending', 'cancelled') DEFAULT 'completed',
    `created_by_user_id` VARCHAR(255),
    `customer_mobile` VARCHAR(15) NULL,
    `customer_name` VARCHAR(255) NULL,
    `is_modified` BOOLEAN DEFAULT FALSE,
    `original_amount` DECIMAL(10,2) NULL,
    FOREIGN KEY (`customer_id`) REFERENCES `customerDetails`(`id`) ON DELETE SET NULL
);

-- 8. Transaction Items Table
CREATE TABLE IF NOT EXISTS `transaction_items` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `transaction_id` INT NOT NULL,
    `stock_detail_id` INT NULL,
    `item_name` VARCHAR(255) NOT NULL,
    `item_description` TEXT,
    `mrp` DECIMAL(10,2) NOT NULL,
    `selling_price` DECIMAL(10,2) NOT NULL,
    `quantity` INT NOT NULL,
    `total_price` DECIMAL(10,2) NOT NULL,
    `location` VARCHAR(100),
    `is_manual` BOOLEAN DEFAULT FALSE,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `dose_dispensing` BOOLEAN DEFAULT FALSE,
    `dose_stock_id` INT NULL,
    `dose_quantity` INT NULL,
    `dose_unit_price` DECIMAL(10,2) NULL,
    `dosage_schedule` VARCHAR(50) NULL,
    `dosage_days` INT DEFAULT 1,
    FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`stock_detail_id`) REFERENCES `import_stock_detail`(`id`)
);

-- 9. Reminders Table
CREATE TABLE IF NOT EXISTS `reminders` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `customer_id` INT NOT NULL,
    `transaction_id` INT NOT NULL,
    `transaction_item_id` INT NOT NULL,
    `medicine_name` VARCHAR(255) NOT NULL,
    `dosage_time` VARCHAR(50) NOT NULL,
    `scheduled_time` TIME NOT NULL,
    `status` ENUM('pending', 'sent', 'taken', 'skipped', 'snoozed') DEFAULT 'pending',
    `sent_at` DATETIME NULL,
    `response_at` DATETIME NULL,
    `date` DATE NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`customer_id`) REFERENCES `customerDetails`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`transaction_item_id`) REFERENCES `transaction_items`(`id`) ON DELETE CASCADE
);

SET FOREIGN_KEY_CHECKS = 1;
