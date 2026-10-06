-- =====================================================================
-- Canteen Food Ordering and Billing Management System
-- Database: canteen_db   |   MySQL 8.0+
-- Recreate everything:   mysql -u root -p < database.sql
-- =====================================================================

DROP DATABASE IF EXISTS canteen_db;
CREATE DATABASE canteen_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;
USE canteen_db;

-- ---------------------------------------------------------------------
-- 1. USERS
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    name           VARCHAR(100)  NOT NULL,
    email          VARCHAR(150)  NOT NULL,
    phone          VARCHAR(15)   NULL,
    password_hash  VARCHAR(255)  NOT NULL,             -- bcrypt hash only, never plaintext
    role           ENUM('STUDENT','ADMIN','STAFF') NOT NULL DEFAULT 'STUDENT',
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_users        PRIMARY KEY (user_id),
    CONSTRAINT uq_users_email  UNIQUE (email),
    CONSTRAINT uq_users_phone  UNIQUE (phone),
    CONSTRAINT chk_users_email CHECK (email LIKE '%_@_%._%'),
    CONSTRAINT chk_users_phone CHECK (phone IS NULL OR phone REGEXP '^[0-9+][0-9]{9,14}$'),
    CONSTRAINT chk_users_hash  CHECK (CHAR_LENGTH(password_hash) >= 50)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. CATEGORIES
-- ---------------------------------------------------------------------
CREATE TABLE categories (
    category_id    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    category_name  VARCHAR(50)   NOT NULL,
    description    VARCHAR(255)  NULL,
    CONSTRAINT pk_categories      PRIMARY KEY (category_id),
    CONSTRAINT uq_categories_name UNIQUE (category_name)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. MENU ITEMS
-- ---------------------------------------------------------------------
CREATE TABLE menu_items (
    item_id           INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    category_id       INT UNSIGNED      NOT NULL,
    item_name         VARCHAR(100)      NOT NULL,
    description       VARCHAR(255)      NULL,
    price             DECIMAL(8,2)      NOT NULL,
    preparation_time  SMALLINT UNSIGNED NOT NULL DEFAULT 10,   -- minutes
    availability      BOOLEAN           NOT NULL DEFAULT TRUE,
    rating            DECIMAL(2,1)      NULL,
    image_url         VARCHAR(255)      NULL,
    created_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_menu_items        PRIMARY KEY (item_id),
    CONSTRAINT uq_menu_items_name   UNIQUE (item_name),
    CONSTRAINT fk_menu_items_cat    FOREIGN KEY (category_id)
        REFERENCES categories (category_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_menu_price       CHECK (price >= 0),
    CONSTRAINT chk_menu_prep_time   CHECK (preparation_time >= 0),
    CONSTRAINT chk_menu_rating      CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
    CONSTRAINT chk_menu_name        CHECK (CHAR_LENGTH(TRIM(item_name)) > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. INGREDIENTS
-- ---------------------------------------------------------------------
CREATE TABLE ingredients (
    ingredient_id    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    ingredient_name  VARCHAR(100)  NOT NULL,
    unit             ENUM('g','kg','ml','l','pcs') NOT NULL,
    description      VARCHAR(255)  NULL,
    CONSTRAINT pk_ingredients      PRIMARY KEY (ingredient_id),
    CONSTRAINT uq_ingredients_name UNIQUE (ingredient_name)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. MENU ITEM INGREDIENTS  (M:N junction)
-- ---------------------------------------------------------------------
CREATE TABLE menu_item_ingredients (
    item_id            INT UNSIGNED   NOT NULL,
    ingredient_id      INT UNSIGNED   NOT NULL,
    quantity_required  DECIMAL(10,3)  NOT NULL,   -- per 1 serving, in ingredient's unit
    CONSTRAINT pk_menu_item_ingredients PRIMARY KEY (item_id, ingredient_id),
    CONSTRAINT fk_mii_item       FOREIGN KEY (item_id)
        REFERENCES menu_items (item_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_mii_ingredient FOREIGN KEY (ingredient_id)
        REFERENCES ingredients (ingredient_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_mii_qty CHECK (quantity_required > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. INVENTORY  (1:1 with ingredients)
-- ---------------------------------------------------------------------
CREATE TABLE inventory (
    inventory_id        INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    ingredient_id       INT UNSIGNED   NOT NULL,
    quantity_available  DECIMAL(12,3)  NOT NULL DEFAULT 0,
    reorder_level       DECIMAL(12,3)  NOT NULL DEFAULT 0,
    last_updated        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_inventory            PRIMARY KEY (inventory_id),
    CONSTRAINT uq_inventory_ingredient UNIQUE (ingredient_id),
    CONSTRAINT fk_inventory_ingredient FOREIGN KEY (ingredient_id)
        REFERENCES ingredients (ingredient_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_inventory_qty     CHECK (quantity_available >= 0),
    CONSTRAINT chk_inventory_reorder CHECK (reorder_level >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. ORDERS
--    Money amounts live in BILLS (one bill per order) to avoid storing
--    subtotal/tax/discount/total twice. Order subtotal is derivable from
--    order_items; see view v_order_summary below.
-- ---------------------------------------------------------------------
CREATE TABLE orders (
    order_id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    user_id          INT UNSIGNED  NOT NULL,
    order_date       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status           ENUM('PENDING','CONFIRMED','PREPARING','READY','COMPLETED','CANCELLED')
                                   NOT NULL DEFAULT 'PENDING',
    pickup_location  VARCHAR(100)  NOT NULL DEFAULT 'Main Canteen',
    pickup_lane      VARCHAR(20)   NULL,
    CONSTRAINT pk_orders      PRIMARY KEY (order_id),
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
        REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_orders_user_date (user_id, order_date),
    INDEX idx_orders_status (status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. ORDER ITEMS
--    unit_price = price at time of ordering (menu prices can change later).
--    Line total (quantity * unit_price) is NOT stored; it is computed.
-- ---------------------------------------------------------------------
CREATE TABLE order_items (
    order_item_id  INT UNSIGNED       NOT NULL AUTO_INCREMENT,
    order_id       INT UNSIGNED       NOT NULL,
    item_id        INT UNSIGNED       NOT NULL,
    quantity       SMALLINT UNSIGNED  NOT NULL DEFAULT 1,
    unit_price     DECIMAL(8,2)       NOT NULL,
    CONSTRAINT pk_order_items           PRIMARY KEY (order_item_id),
    CONSTRAINT uq_order_items_order_item UNIQUE (order_id, item_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
        REFERENCES orders (order_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_order_items_item  FOREIGN KEY (item_id)
        REFERENCES menu_items (item_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_order_items_qty   CHECK (quantity > 0),
    CONSTRAINT chk_order_items_price CHECK (unit_price >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 9. BILLS  (1:1 with orders via UNIQUE order_id)
-- ---------------------------------------------------------------------
CREATE TABLE bills (
    bill_id       INT UNSIGNED   NOT NULL AUTO_INCREMENT,
    order_id      INT UNSIGNED   NOT NULL,
    bill_date     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    subtotal      DECIMAL(10,2)  NOT NULL,
    tax           DECIMAL(10,2)  NOT NULL DEFAULT 0,
    discount      DECIMAL(10,2)  NOT NULL DEFAULT 0,
    total_amount  DECIMAL(10,2)  NOT NULL,
    CONSTRAINT pk_bills       PRIMARY KEY (bill_id),
    CONSTRAINT uq_bills_order UNIQUE (order_id),
    CONSTRAINT fk_bills_order FOREIGN KEY (order_id)
        REFERENCES orders (order_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_bills_subtotal CHECK (subtotal >= 0),
    CONSTRAINT chk_bills_tax      CHECK (tax >= 0),
    CONSTRAINT chk_bills_discount CHECK (discount >= 0 AND discount <= subtotal + tax),
    CONSTRAINT chk_bills_total    CHECK (total_amount = subtotal + tax - discount)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 10. PAYMENTS  (1 bill -> many attempts, e.g. FAILED then SUCCESS)
-- ---------------------------------------------------------------------
CREATE TABLE payments (
    payment_id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    bill_id                INT UNSIGNED  NOT NULL,
    payment_method         ENUM('UPI','CAMPUS_WALLET','CASH') NOT NULL,
    payment_status         ENUM('PENDING','SUCCESS','FAILED') NOT NULL DEFAULT 'PENDING',
    transaction_reference  VARCHAR(64)   NULL,   -- NULL allowed for cash
    payment_date           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_payments        PRIMARY KEY (payment_id),
    CONSTRAINT uq_payments_txnref UNIQUE (transaction_reference),
    CONSTRAINT fk_payments_bill   FOREIGN KEY (bill_id)
        REFERENCES bills (bill_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_payments_txnref CHECK (
        payment_method = 'CASH' OR transaction_reference IS NOT NULL)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- VIEW: order totals derived from order_items (no stored redundancy)
-- ---------------------------------------------------------------------
CREATE VIEW v_order_summary AS
SELECT  o.order_id,
        o.user_id,
        o.order_date,
        o.status,
        o.pickup_location,
        o.pickup_lane,
        SUM(oi.quantity * oi.unit_price) AS items_subtotal,
        b.bill_id,
        b.tax,
        b.discount,
        b.total_amount
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
LEFT JOIN bills  b  ON b.order_id  = o.order_id
GROUP BY o.order_id, o.user_id, o.order_date, o.status, o.pickup_location,
         o.pickup_lane, b.bill_id, b.tax, b.discount, b.total_amount;

-- =====================================================================
-- SAMPLE DATA
-- Sample passwords (bcrypt): Admin@123 / Staff@123 / Student@123
-- =====================================================================

INSERT INTO users (user_id, name, email, phone, password_hash, role, created_at) VALUES
(1, 'Rajesh Kumar',  'admin@canteen.woxsen.edu.in',     '9876500001', '$2b$10$ctEBkLLSkOtQHm03qOxxQe10qbASJd/7pM3uV/t6jx02SMB7mwPF2', 'ADMIN',   '2026-07-01 09:00:00'),
(2, 'Sunita Reddy',  'sunita.staff@canteen.woxsen.edu.in','9876500002', '$2b$10$3vrFxsFXM0Y9abILHzCELe2k39G2rS11mnPxrzgo/RDu67wo3xuZG', 'STAFF',   '2026-07-01 09:30:00'),
(3, 'Aarav Sharma',  'aarav.sharma@woxsen.edu.in',      '9123400003', '$2b$10$ZM4DAGtPdVA6Ac6mcgVvy.CzSF0.hlWGHaqTpL.ASwZsEWd2q2OsW', 'STUDENT', '2026-08-01 10:00:00'),
(4, 'Priya Iyer',    'priya.iyer@woxsen.edu.in',        '9123400004', '$2b$10$ZM4DAGtPdVA6Ac6mcgVvy.CzSF0.hlWGHaqTpL.ASwZsEWd2q2OsW', 'STUDENT', '2026-08-01 10:05:00'),
(5, 'Rohan Verma',   'rohan.verma@woxsen.edu.in',       '9123400005', '$2b$10$ZM4DAGtPdVA6Ac6mcgVvy.CzSF0.hlWGHaqTpL.ASwZsEWd2q2OsW', 'STUDENT', '2026-08-02 11:00:00'),
(6, 'Ananya Gupta',  'ananya.gupta@woxsen.edu.in',      '9123400006', '$2b$10$ZM4DAGtPdVA6Ac6mcgVvy.CzSF0.hlWGHaqTpL.ASwZsEWd2q2OsW', 'STUDENT', '2026-08-03 12:00:00');

INSERT INTO categories (category_id, category_name, description) VALUES
(1, 'Burgers & Wraps', 'Burgers, wraps and rolls'),
(2, 'Main Course',     'Biryani, rice and noodle meals'),
(3, 'South Indian',    'Dosa, idli and other South Indian dishes'),
(4, 'Snacks',          'Quick bites and fried snacks'),
(5, 'Beverages',       'Hot and cold drinks'),
(6, 'Desserts',        'Sweets and baked treats');

INSERT INTO menu_items (item_id, category_id, item_name, description, price, preparation_time, availability, rating, image_url) VALUES
(1,  1, 'Chicken Burger',  'Crispy chicken patty with lettuce and mayo',     120.00, 12, TRUE,  4.4, '/images/chicken-burger.jpg'),
(2,  1, 'Veg Burger',      'Aloo-veg patty with onion, tomato and sauce',      80.00, 10, TRUE,  4.1, '/images/veg-burger.jpg'),
(3,  1, 'Paneer Wrap',     'Tandoori paneer tikka rolled in a soft roti',     110.00, 10, TRUE,  4.5, '/images/paneer-wrap.jpg'),
(4,  2, 'Chicken Biryani', 'Hyderabadi dum chicken biryani with raita',       160.00, 20, TRUE,  4.7, '/images/chicken-biryani.jpg'),
(5,  2, 'Veg Biryani',     'Mixed vegetable dum biryani with raita',          120.00, 18, TRUE,  4.2, '/images/veg-biryani.jpg'),
(6,  2, 'Hakka Noodles',   'Indo-Chinese stir-fried veg noodles',              90.00, 12, TRUE,  4.0, '/images/hakka-noodles.jpg'),
(7,  3, 'Masala Dosa',     'Crisp dosa with potato masala, chutney, sambar',   70.00, 10, TRUE,  4.6, '/images/masala-dosa.jpg'),
(8,  4, 'French Fries',    'Salted crispy potato fries',                       60.00,  8, TRUE,  4.0, '/images/french-fries.jpg'),
(9,  4, 'Samosa',          'Two potato samosas with green chutney',            30.00,  5, TRUE,  4.3, '/images/samosa.jpg'),
(10, 5, 'Cold Coffee',     'Chilled blended coffee with milk',                 60.00,  5, TRUE,  4.4, '/images/cold-coffee.jpg'),
(11, 5, 'Masala Chai',     'Hot spiced Indian tea',                            20.00,  4, TRUE,  4.8, '/images/masala-chai.jpg'),
(12, 5, 'Lime Soda',       'Fresh lime with soda, sweet or salted',            40.00,  3, TRUE,  4.1, '/images/lime-soda.jpg'),
(13, 6, 'Brownie',         'Warm chocolate walnut brownie',                    70.00,  3, FALSE, 4.5, '/images/brownie.jpg');

INSERT INTO ingredients (ingredient_id, ingredient_name, unit, description) VALUES
(1,  'Chicken',          'g',   'Boneless chicken'),
(2,  'Paneer',           'g',   'Fresh cottage cheese'),
(3,  'Burger Bun',       'pcs', 'Sesame burger buns'),
(4,  'Basmati Rice',     'g',   'Long-grain basmati rice'),
(5,  'Potato',           'g',   'Potatoes'),
(6,  'Onion',            'g',   'Onions'),
(7,  'Tomato',           'g',   'Tomatoes'),
(8,  'Milk',             'ml',  'Toned milk'),
(9,  'Coffee Powder',    'g',   'Instant coffee'),
(10, 'Tea Leaves',       'g',   'CTC tea leaves'),
(11, 'Sugar',            'g',   'Refined sugar'),
(12, 'Wheat Flour',      'g',   'Maida / atta for wraps and samosa'),
(13, 'Dosa Batter',      'g',   'Fermented rice-urad batter'),
(14, 'Noodles',          'g',   'Hakka noodles'),
(15, 'Cooking Oil',      'ml',  'Refined sunflower oil'),
(16, 'Lime',             'pcs', 'Fresh limes'),
(17, 'Soda',             'ml',  'Carbonated water'),
(18, 'Chocolate',        'g',   'Dark cooking chocolate');

INSERT INTO menu_item_ingredients (item_id, ingredient_id, quantity_required) VALUES
(1, 1, 120), (1, 3, 1), (1, 6, 20), (1, 7, 20), (1, 15, 30),        -- Chicken Burger
(2, 5, 100), (2, 3, 1), (2, 6, 20), (2, 15, 30),                     -- Veg Burger
(3, 2, 100), (3, 12, 60), (3, 6, 30),                                -- Paneer Wrap
(4, 1, 150), (4, 4, 200), (4, 6, 50), (4, 15, 20),                   -- Chicken Biryani
(5, 4, 200), (5, 5, 50), (5, 6, 50), (5, 15, 20),                    -- Veg Biryani
(6, 14, 150), (6, 6, 30), (6, 15, 20),                               -- Hakka Noodles
(7, 13, 150), (7, 5, 80), (7, 15, 10),                               -- Masala Dosa
(8, 5, 150), (8, 15, 40),                                            -- French Fries
(9, 12, 50), (9, 5, 60), (9, 15, 30),                                -- Samosa
(10, 8, 200), (10, 9, 5), (10, 11, 20),                              -- Cold Coffee
(11, 8, 100), (11, 10, 3), (11, 11, 10),                             -- Masala Chai
(12, 16, 1), (12, 17, 250), (12, 11, 15),                            -- Lime Soda
(13, 18, 40), (13, 12, 30), (13, 11, 25);                            -- Brownie

INSERT INTO inventory (ingredient_id, quantity_available, reorder_level) VALUES
(1,  15000, 5000),   -- Chicken (g)
(2,   6000, 2000),   -- Paneer (g)
(3,    120,   40),   -- Burger Bun (pcs)
(4,  25000, 8000),   -- Basmati Rice (g)
(5,  30000, 10000),  -- Potato (g)
(6,  20000, 5000),   -- Onion (g)
(7,   8000, 3000),   -- Tomato (g)
(8,  20000, 8000),   -- Milk (ml)
(9,    800,  300),   -- Coffee Powder (g)
(10,  1500,  500),   -- Tea Leaves (g)
(11, 10000, 3000),   -- Sugar (g)
(12, 12000, 4000),   -- Wheat Flour (g)
(13,  9000, 4000),   -- Dosa Batter (g)
(14,  1800, 2000),   -- Noodles (g)  << below reorder level
(15, 15000, 5000),   -- Cooking Oil (ml)
(16,    60,   30),   -- Lime (pcs)
(17,  9000, 3000),   -- Soda (ml)
(18,   300,  500);   -- Chocolate (g)  << below reorder level

INSERT INTO orders (order_id, user_id, order_date, status, pickup_location, pickup_lane) VALUES
(1, 3, '2026-10-01 12:45:00', 'COMPLETED', 'Main Canteen', 'Lane 1'),
(2, 4, '2026-10-01 13:10:00', 'COMPLETED', 'Main Canteen', 'Lane 2'),
(3, 5, '2026-10-02 16:30:00', 'COMPLETED', 'Food Court',   'Lane 1'),
(4, 6, '2026-10-03 09:15:00', 'CANCELLED', 'Main Canteen', 'Lane 3'),
(5, 3, '2026-10-05 13:00:00', 'READY',     'Main Canteen', 'Lane 1'),
(6, 4, '2026-10-06 12:20:00', 'PREPARING', 'Food Court',   'Lane 2'),
(7, 5, '2026-10-06 12:40:00', 'PENDING',   'Main Canteen', NULL);

INSERT INTO order_items (order_id, item_id, quantity, unit_price) VALUES
(1, 4,  1, 160.00), (1, 11, 2,  20.00),                       -- Aarav
(2, 3,  1, 110.00), (2, 10, 1,  60.00), (2, 9, 2, 30.00),     -- Priya
(3, 1,  2, 120.00), (3, 8,  1,  60.00), (3, 12, 2, 40.00),    -- Rohan
(4, 7,  1,  70.00), (4, 11, 1,  20.00),                       -- Ananya (cancelled)
(5, 5,  1, 120.00), (5, 13, 1,  70.00),                       -- Aarav
(6, 6,  2,  90.00), (6, 12, 1,  40.00),                       -- Priya
(7, 2,  1,  80.00), (7, 11, 1,  20.00);                       -- Rohan

-- Bills for every non-cancelled, non-pending order.
-- subtotal is computed from order_items so it can never disagree; GST 5%.
INSERT INTO bills (order_id, bill_date, subtotal, tax, discount, total_amount)
SELECT  t.order_id, t.order_date, t.sub, t.tax, t.disc, t.sub + t.tax - t.disc
FROM (
    SELECT  o.order_id,
            o.order_date,
            SUM(oi.quantity * oi.unit_price)                    AS sub,
            ROUND(SUM(oi.quantity * oi.unit_price) * 0.05, 2)   AS tax,
            CASE o.order_id WHEN 3 THEN 20.00 WHEN 2 THEN 10.00 ELSE 0.00 END AS disc
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.status NOT IN ('CANCELLED','PENDING')
    GROUP BY o.order_id, o.order_date
) t
ORDER BY t.order_id;
-- Resulting bill_ids: 1->order 1, 2->order 2, 3->order 3, 4->order 5, 5->order 6

INSERT INTO payments (bill_id, payment_method, payment_status, transaction_reference, payment_date) VALUES
(1, 'UPI',           'SUCCESS', 'UPI2026100112451001',  '2026-10-01 12:46:00'),
(2, 'CAMPUS_WALLET', 'SUCCESS', 'CW-2026100113100002',  '2026-10-01 13:11:00'),
(3, 'UPI',           'FAILED',  'UPI2026100216300003',  '2026-10-02 16:31:00'),
(3, 'CASH',          'SUCCESS', NULL,                   '2026-10-02 16:33:00'),
(4, 'UPI',           'SUCCESS', 'UPI2026100513000004',  '2026-10-05 13:01:00'),
(5, 'CAMPUS_WALLET', 'PENDING', 'CW-2026100612200005',  '2026-10-06 12:21:00');
