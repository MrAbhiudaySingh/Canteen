// Canteen Food Ordering & Billing — API server + static frontend
// Run: npm install && npm start   →  http://localhost:3000
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// ---- tiny .env loader (no extra dependency) ----
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'canteen_db',
  dateStrings: true,
  decimalNumbers: true,
  connectionLimit: 10,
});

const TAX_RATE = 0.05; // 5% GST
const STATUS_FLOW = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- helpers ----
const sessions = new Map(); // token -> user (in-memory; logs out on server restart)

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function auth(...roles) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const user = sessions.get(token);
    if (!user) return res.status(401).json({ error: 'Please log in again.' });
    if (roles.length && !roles.includes(user.role))
      return res.status(403).json({ error: 'You do not have access to this.' });
    req.user = user;
    next();
  };
}
const STAFF = ['ADMIN', 'STAFF'];

const money = (n) => Math.round(n * 100) / 100;

// Adjust ingredient stock for an order. sign = -1 deduct, +1 restore.
async function adjustStock(conn, orderId, sign) {
  const [needs] = await conn.query(
    `SELECT inv.inventory_id, ing.ingredient_name, ing.unit, inv.quantity_available,
            SUM(mii.quantity_required * oi.quantity) AS needed
       FROM order_items oi
       JOIN menu_item_ingredients mii ON mii.item_id = oi.item_id
       JOIN ingredients ing ON ing.ingredient_id = mii.ingredient_id
       JOIN inventory inv ON inv.ingredient_id = ing.ingredient_id
      WHERE oi.order_id = ?
      GROUP BY inv.inventory_id, ing.ingredient_name, ing.unit, inv.quantity_available
      FOR UPDATE`, [orderId]);
  for (const n of needs) {
    if (sign < 0 && n.quantity_available < n.needed)
      throw new ApiError(409, `Not enough ${n.ingredient_name} in stock for this order.`);
    await conn.query(
      'UPDATE inventory SET quantity_available = quantity_available + ? WHERE inventory_id = ?',
      [sign * n.needed, n.inventory_id]);
  }
}

async function loadOrders(where, params) {
  const [orders] = await pool.query(
    `SELECT o.order_id, o.order_date, o.status, o.pickup_location, o.pickup_lane,
            u.user_id, u.name AS customer, u.email,
            b.bill_id, b.bill_date, b.subtotal, b.tax, b.discount, b.total_amount
       FROM orders o
       JOIN users u ON u.user_id = o.user_id
       LEFT JOIN bills b ON b.order_id = o.order_id
      ${where}
      ORDER BY o.order_date DESC, o.order_id DESC`, params);
  if (!orders.length) return [];
  const ids = orders.map((o) => o.order_id);
  const [items] = await pool.query(
    `SELECT oi.order_id, oi.item_id, m.item_name, oi.quantity, oi.unit_price,
            oi.quantity * oi.unit_price AS line_total
       FROM order_items oi JOIN menu_items m ON m.item_id = oi.item_id
      WHERE oi.order_id IN (?) ORDER BY oi.order_item_id`, [ids]);
  const [pays] = await pool.query(
    `SELECT p.*, b.order_id FROM payments p JOIN bills b ON b.bill_id = p.bill_id
      WHERE b.order_id IN (?) ORDER BY p.payment_date, p.payment_id`, [ids]);
  for (const o of orders) {
    o.items = items.filter((i) => i.order_id === o.order_id);
    o.items_subtotal = money(o.items.reduce((s, i) => s + Number(i.line_total), 0));
    o.payments = pays.filter((p) => p.order_id === o.order_id);
    const last = o.payments[o.payments.length - 1];
    o.payment_status = o.payments.some((p) => p.payment_status === 'SUCCESS')
      ? 'SUCCESS' : last ? last.payment_status : null;
    o.payment_method = last ? last.payment_method : null;
  }
  return orders;
}

// ================= AUTH =================
app.post('/api/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw new ApiError(400, 'Enter your email and password.');
  const [[user]] = await pool.query('SELECT * FROM users WHERE email = ?', [email.trim()]);
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    throw new ApiError(401, 'Email or password is incorrect.');
  const token = crypto.randomBytes(24).toString('hex');
  const safe = { user_id: user.user_id, name: user.name, email: user.email, role: user.role };
  sessions.set(token, safe);
  res.json({ token, user: safe });
}));

app.post('/api/register', wrap(async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password) throw new ApiError(400, 'Name, email and password are required.');
  if (password.length < 6) throw new ApiError(400, 'Password must be at least 6 characters.');
  const hash = await bcrypt.hash(password, 10);
  try {
    await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'STUDENT')`,
      [name.trim(), email.trim(), phone ? phone.trim() : null, hash]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'An account with this email or phone already exists.');
    if (e.errno === 3819) throw new ApiError(400, 'Check the email and phone number format.');
    throw e;
  }
  res.status(201).json({ ok: true });
}));

app.post('/api/logout', auth(), (req, res) => {
  sessions.delete((req.headers.authorization || '').replace('Bearer ', ''));
  res.json({ ok: true });
});

// ================= CATEGORIES =================
app.get('/api/categories', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*, COUNT(m.item_id) AS item_count
       FROM categories c LEFT JOIN menu_items m ON m.category_id = c.category_id
      GROUP BY c.category_id ORDER BY c.category_id`);
  res.json(rows);
}));

app.post('/api/categories', auth('ADMIN'), wrap(async (req, res) => {
  const { category_name, description } = req.body;
  if (!category_name) throw new ApiError(400, 'Category name is required.');
  try {
    const [r] = await pool.query('INSERT INTO categories (category_name, description) VALUES (?, ?)',
      [category_name.trim(), description || null]);
    res.status(201).json({ category_id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'A category with this name already exists.');
    throw e;
  }
}));

app.put('/api/categories/:id', auth('ADMIN'), wrap(async (req, res) => {
  const { category_name, description } = req.body;
  try {
    await pool.query('UPDATE categories SET category_name = ?, description = ? WHERE category_id = ?',
      [category_name.trim(), description || null, req.params.id]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'A category with this name already exists.');
    throw e;
  }
  res.json({ ok: true });
}));

app.delete('/api/categories/:id', auth('ADMIN'), wrap(async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE category_id = ?', [req.params.id]);
  } catch (e) {
    if (e.errno === 1451) throw new ApiError(409, 'Move or delete the items in this category first.');
    throw e;
  }
  res.json({ ok: true });
}));

// ================= MENU =================
app.get('/api/menu', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT m.*, c.category_name FROM menu_items m
       JOIN categories c ON c.category_id = m.category_id
      ORDER BY c.category_id, m.item_name`);
  res.json(rows);
}));

function menuFields(b) {
  return [Number(b.category_id), (b.item_name || '').trim(), b.description || null,
    Number(b.price), Number(b.preparation_time || 0), b.availability ? 1 : 0,
    b.rating === '' || b.rating == null ? null : Number(b.rating), b.image_url || null];
}
function menuError(e) {
  if (e.code === 'ER_DUP_ENTRY') return new ApiError(409, 'An item with this name already exists.');
  if (e.errno === 3819) return new ApiError(400, 'Check the values: price and prep time cannot be negative, rating is 0–5.');
  if (e.errno === 1452) return new ApiError(400, 'Choose a valid category.');
  return e;
}

app.post('/api/menu', auth('ADMIN'), wrap(async (req, res) => {
  try {
    const [r] = await pool.query(
      `INSERT INTO menu_items (category_id, item_name, description, price, preparation_time,
                               availability, rating, image_url) VALUES (?,?,?,?,?,?,?,?)`,
      menuFields(req.body));
    res.status(201).json({ item_id: r.insertId });
  } catch (e) { throw menuError(e); }
}));

app.put('/api/menu/:id', auth('ADMIN'), wrap(async (req, res) => {
  try {
    await pool.query(
      `UPDATE menu_items SET category_id=?, item_name=?, description=?, price=?, preparation_time=?,
                             availability=?, rating=?, image_url=? WHERE item_id=?`,
      [...menuFields(req.body), req.params.id]);
    res.json({ ok: true });
  } catch (e) { throw menuError(e); }
}));

app.patch('/api/menu/:id/availability', auth(...STAFF), wrap(async (req, res) => {
  await pool.query('UPDATE menu_items SET availability = ? WHERE item_id = ?',
    [req.body.availability ? 1 : 0, req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/menu/:id', auth('ADMIN'), wrap(async (req, res) => {
  try {
    await pool.query('DELETE FROM menu_items WHERE item_id = ?', [req.params.id]);
  } catch (e) {
    if (e.errno === 1451) throw new ApiError(409, 'This item appears in past orders. Mark it unavailable instead.');
    throw e;
  }
  res.json({ ok: true });
}));

// ================= ORDERS (student) =================
app.post('/api/orders', auth(), wrap(async (req, res) => {
  const { items, pickup_location, payment_method } = req.body || {};
  if (!Array.isArray(items) || !items.length) throw new ApiError(400, 'Your cart is empty.');
  if (!['UPI', 'CAMPUS_WALLET', 'CASH'].includes(payment_method)) throw new ApiError(400, 'Choose a payment method.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ids = items.map((i) => Number(i.item_id));
    const [menu] = await conn.query(
      'SELECT item_id, item_name, price, availability FROM menu_items WHERE item_id IN (?)', [ids]);
    let subtotal = 0;
    for (const it of items) {
      const m = menu.find((x) => x.item_id === Number(it.item_id));
      const qty = Number(it.quantity);
      if (!m) throw new ApiError(400, 'One of the items is no longer on the menu.');
      if (!m.availability) throw new ApiError(409, `${m.item_name} is sold out right now.`);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new ApiError(400, 'Quantity must be between 1 and 20.');
      it.unit_price = m.price;
      subtotal += m.price * qty;
    }
    // simple lane assignment: lanes 1–3 rotate
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM orders');
    const lane = `Lane ${(n % 3) + 1}`;
    const [o] = await conn.query(
      'INSERT INTO orders (user_id, status, pickup_location, pickup_lane) VALUES (?, ?, ?, ?)',
      [req.user.user_id, 'PENDING', pickup_location || 'Main Canteen', lane]);
    const orderId = o.insertId;
    await conn.query('INSERT INTO order_items (order_id, item_id, quantity, unit_price) VALUES ?',
      [items.map((i) => [orderId, Number(i.item_id), Number(i.quantity), i.unit_price])]);

    await adjustStock(conn, orderId, -1);

    subtotal = money(subtotal);
    const tax = money(subtotal * TAX_RATE);
    const [b] = await conn.query(
      'INSERT INTO bills (order_id, subtotal, tax, discount, total_amount) VALUES (?, ?, ?, 0, ?)',
      [orderId, subtotal, tax, money(subtotal + tax)]);

    // UPI / wallet are simulated as instant success; cash is paid at the counter.
    const online = payment_method !== 'CASH';
    const ref = online
      ? `${payment_method === 'UPI' ? 'UPI' : 'CW-'}${Date.now()}${String(orderId).padStart(4, '0')}` : null;
    await conn.query(
      'INSERT INTO payments (bill_id, payment_method, payment_status, transaction_reference) VALUES (?, ?, ?, ?)',
      [b.insertId, payment_method, online ? 'SUCCESS' : 'PENDING', ref]);
    if (online) await conn.query("UPDATE orders SET status = 'CONFIRMED' WHERE order_id = ?", [orderId]);

    await conn.commit();
    res.status(201).json({ order_id: orderId });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

app.get('/api/my/orders', auth(), wrap(async (req, res) => {
  res.json(await loadOrders('WHERE o.user_id = ?', [req.user.user_id]));
}));

app.post('/api/my/orders/:id/cancel', auth(), wrap(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[o]] = await conn.query('SELECT * FROM orders WHERE order_id = ? AND user_id = ? FOR UPDATE',
      [req.params.id, req.user.user_id]);
    if (!o) throw new ApiError(404, 'Order not found.');
    if (!['PENDING', 'CONFIRMED'].includes(o.status))
      throw new ApiError(409, 'This order is already being prepared and can’t be cancelled.');
    await conn.query("UPDATE orders SET status = 'CANCELLED' WHERE order_id = ?", [o.order_id]);
    await adjustStock(conn, o.order_id, +1);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));

// ================= ORDERS (staff) =================
app.get('/api/orders', auth(...STAFF), wrap(async (req, res) => {
  const { status } = req.query;
  if (status === 'ACTIVE')
    return res.json(await loadOrders("WHERE o.status IN ('PENDING','CONFIRMED','PREPARING','READY')", []));
  if (status && STATUS_FLOW.includes(status)) return res.json(await loadOrders('WHERE o.status = ?', [status]));
  res.json(await loadOrders('', []));
}));

app.patch('/api/orders/:id/status', auth(...STAFF), wrap(async (req, res) => {
  const { status } = req.body;
  if (!STATUS_FLOW.includes(status)) throw new ApiError(400, 'Unknown status.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[o]] = await conn.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [req.params.id]);
    if (!o) throw new ApiError(404, 'Order not found.');
    if (o.status === 'CANCELLED' || o.status === 'COMPLETED')
      throw new ApiError(409, `This order is already ${o.status.toLowerCase()}.`);
    await conn.query('UPDATE orders SET status = ? WHERE order_id = ?', [status, o.order_id]);
    if (status === 'CANCELLED') await adjustStock(conn, o.order_id, +1);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));

// ================= INVENTORY =================
app.get('/api/inventory', auth(...STAFF), wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT inv.inventory_id, ing.ingredient_id, ing.ingredient_name, ing.unit, ing.description,
            inv.quantity_available, inv.reorder_level, inv.last_updated,
            (inv.quantity_available <= inv.reorder_level) AS is_low,
            (SELECT GROUP_CONCAT(m.item_name ORDER BY m.item_name SEPARATOR ', ')
               FROM menu_item_ingredients mii JOIN menu_items m ON m.item_id = mii.item_id
              WHERE mii.ingredient_id = ing.ingredient_id) AS used_in
       FROM inventory inv JOIN ingredients ing ON ing.ingredient_id = inv.ingredient_id
      ORDER BY is_low DESC, ing.ingredient_name`);
  res.json(rows);
}));

app.patch('/api/inventory/:id', auth(...STAFF), wrap(async (req, res) => {
  const { quantity_available, reorder_level } = req.body;
  try {
    await pool.query('UPDATE inventory SET quantity_available = ?, reorder_level = ? WHERE inventory_id = ?',
      [Number(quantity_available), Number(reorder_level), req.params.id]);
  } catch (e) {
    if (e.errno === 3819) throw new ApiError(400, 'Stock and reorder level cannot be negative.');
    throw e;
  }
  res.json({ ok: true });
}));

// ================= BILLING =================
app.get('/api/bills', auth(...STAFF), wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT b.*, o.status AS order_status, u.name AS customer,
            p.payment_id, p.payment_method, p.payment_status, p.transaction_reference, p.payment_date
       FROM bills b
       JOIN orders o ON o.order_id = b.order_id
       JOIN users u ON u.user_id = o.user_id
       LEFT JOIN payments p ON p.payment_id = (
            SELECT p2.payment_id FROM payments p2 WHERE p2.bill_id = b.bill_id
             ORDER BY (p2.payment_status = 'SUCCESS') DESC, p2.payment_date DESC, p2.payment_id DESC LIMIT 1)
      ORDER BY b.bill_date DESC, b.bill_id DESC`);
  res.json(rows);
}));

// Record cash collected at the counter
app.post('/api/bills/:id/collect-cash', auth(...STAFF), wrap(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[bill]] = await conn.query('SELECT bill_id FROM bills WHERE bill_id = ? FOR UPDATE', [req.params.id]);
    if (!bill) throw new ApiError(404, 'Bill not found.');
    const [[paid]] = await conn.query(
      "SELECT COUNT(*) AS n FROM payments WHERE bill_id = ? AND payment_status = 'SUCCESS'", [req.params.id]);
    if (paid.n) throw new ApiError(409, 'This bill is already paid.');
    const [r] = await conn.query(
      "UPDATE payments SET payment_status = 'SUCCESS', payment_date = NOW() WHERE bill_id = ? AND payment_method = 'CASH' AND payment_status = 'PENDING'",
      [req.params.id]);
    if (!r.affectedRows)
      await conn.query("INSERT INTO payments (bill_id, payment_method, payment_status) VALUES (?, 'CASH', 'SUCCESS')",
        [req.params.id]);
    await conn.query(
      "UPDATE orders o JOIN bills b ON b.order_id = o.order_id SET o.status = 'CONFIRMED' WHERE b.bill_id = ? AND o.status = 'PENDING'",
      [req.params.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));

// ================= REPORTS =================
app.get('/api/reports', auth(...STAFF), wrap(async (req, res) => {
  const paidBills = `SELECT b.* FROM bills b JOIN orders o ON o.order_id = b.order_id
                      WHERE o.status <> 'CANCELLED'
                        AND EXISTS (SELECT 1 FROM payments p WHERE p.bill_id = b.bill_id AND p.payment_status = 'SUCCESS')`;
  const [[totals]] = await pool.query(
    `SELECT COUNT(*) AS paid_orders, COALESCE(SUM(total_amount),0) AS revenue,
            COALESCE(SUM(CASE WHEN DATE(bill_date) = CURDATE() THEN total_amount END),0) AS revenue_today,
            COALESCE(AVG(total_amount),0) AS avg_order
       FROM (${paidBills}) pb`);
  const [[active]] = await pool.query(
    "SELECT COUNT(*) AS n FROM orders WHERE status IN ('PENDING','CONFIRMED','PREPARING','READY')");
  const [[ordersToday]] = await pool.query('SELECT COUNT(*) AS n FROM orders WHERE DATE(order_date) = CURDATE()');
  const [[low]] = await pool.query('SELECT COUNT(*) AS n FROM inventory WHERE quantity_available <= reorder_level');
  const [byStatus] = await pool.query('SELECT status, COUNT(*) AS n FROM orders GROUP BY status');
  const [topItems] = await pool.query(
    `SELECT m.item_name, SUM(oi.quantity) AS qty, SUM(oi.quantity * oi.unit_price) AS sales
       FROM order_items oi JOIN orders o ON o.order_id = oi.order_id JOIN menu_items m ON m.item_id = oi.item_id
      WHERE o.status <> 'CANCELLED'
      GROUP BY m.item_id, m.item_name ORDER BY qty DESC, sales DESC LIMIT 6`);
  const [byCategory] = await pool.query(
    `SELECT c.category_name,
            COALESCE(SUM(CASE WHEN o.status <> 'CANCELLED' THEN oi.quantity * oi.unit_price END),0) AS sales
       FROM categories c
       LEFT JOIN menu_items m ON m.category_id = c.category_id
       LEFT JOIN order_items oi ON oi.item_id = m.item_id
       LEFT JOIN orders o ON o.order_id = oi.order_id
      GROUP BY c.category_id, c.category_name ORDER BY sales DESC`);
  const [byDay] = await pool.query(
    `SELECT DATE(bill_date) AS day, SUM(total_amount) AS revenue, COUNT(*) AS orders
       FROM (${paidBills}) pb
      WHERE bill_date >= CURDATE() - INTERVAL 6 DAY
      GROUP BY DATE(bill_date) ORDER BY day`);
  const [byMethod] = await pool.query(
    `SELECT payment_method, COUNT(*) AS n, SUM(b.total_amount) AS amount
       FROM payments p JOIN bills b ON b.bill_id = p.bill_id
      WHERE p.payment_status = 'SUCCESS' GROUP BY payment_method`);
  res.json({
    revenue: totals.revenue, revenue_today: totals.revenue_today, avg_order: totals.avg_order,
    paid_orders: totals.paid_orders, active_orders: active.n, orders_today: ordersToday.n,
    low_stock: low.n, byStatus, topItems, byCategory, byDay, byMethod,
  });
}));

// ---- errors ----
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR' || err.code === 'ER_BAD_DB_ERROR')
    return res.status(500).json({ error: 'Cannot reach the database. Check the settings in .env.' });
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = Number(process.env.PORT || 3000);
pool.query('SELECT 1')
  .then(() => console.log('Connected to MySQL database', process.env.DB_NAME || 'canteen_db'))
  .catch((e) => console.error('MySQL connection failed:', e.message, '\n→ Check DB_USER / DB_PASSWORD in .env'));
app.listen(PORT, () => console.log(`Canteen app running at http://localhost:${PORT}`));
