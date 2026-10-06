// Canteen frontend — plain JavaScript, hash-based routing.
const TAX_RATE = 0.05;
const STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'];
const NEXT = { PENDING: 'CONFIRMED', CONFIRMED: 'PREPARING', PREPARING: 'READY', READY: 'COMPLETED' };
const NEXT_LABEL = { CONFIRMED: 'Confirm', PREPARING: 'Start preparing', READY: 'Mark ready', COMPLETED: 'Mark picked up' };
const STATUS_TEXT = {
  PENDING: 'Waiting for payment', CONFIRMED: 'Order confirmed', PREPARING: 'Being prepared',
  READY: 'Ready for pickup', COMPLETED: 'Picked up', CANCELLED: 'Cancelled',
};
const PAY_TEXT = { UPI: 'UPI', CAMPUS_WALLET: 'Campus wallet', CASH: 'Cash' };

const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  cart: JSON.parse(localStorage.getItem('cart') || '{}'), // { item_id: qty }
  menu: [],
  categories: [],
  activeCat: 'all',
  search: '',
  adminTab: 'ACTIVE',
};

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rs = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rs0 = (n) => '₹' + Math.round(Number(n || 0)).toLocaleString('en-IN');
const tokenNo = (id) => '#' + String(id).padStart(4, '0');
const isStaff = () => state.user && (state.user.role === 'ADMIN' || state.user.role === 'STAFF');
const isAdmin = () => state.user && state.user.role === 'ADMIN';

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { logout(true); throw new Error(data.error || 'Please log in again.'); }
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

// ---------- UI helpers ----------
let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2800);
}
const badge = (s, text) => `<span class="badge s-${s}">${esc(text || s.charAt(0) + s.slice(1).toLowerCase())}</span>`;

function openModal(title, bodyHtml, footHtml = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button class="x" aria-label="Close" data-close>×</button></div>
    <div class="modal-body">${bodyHtml}</div>${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}`;
  m.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => m.close()));
  m.showModal();
  return m;
}

function saveCart() { localStorage.setItem('cart', JSON.stringify(state.cart)); }
function cartCount() { return Object.values(state.cart).reduce((a, b) => a + b, 0); }

function setSession(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user));
}
function logout(silent) {
  if (!silent && state.token) api('/logout', { method: 'POST' }).catch(() => {});
  state.token = null; state.user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  location.hash = '#/login';
}
$('#logoutBtn').onclick = () => logout();

function renderNav(route) {
  const bar = $('#topbar');
  if (!state.user) { bar.hidden = true; return; }
  bar.hidden = false;
  $('#whoName').textContent = `${state.user.name} · ${state.user.role.toLowerCase()}`;
  const links = isStaff()
    ? [['#/admin', 'Dashboard'], ['#/admin/orders', 'Orders'], ...(isAdmin() ? [['#/admin/menu', 'Menu']] : []),
       ['#/admin/inventory', 'Inventory'], ['#/admin/billing', 'Billing']]
    : [['#/menu', 'Menu'], ['#/orders', 'My orders']];
  $('#nav').innerHTML = links.map(([h, t]) => `<a href="${h}" class="${route === h ? 'active' : ''}">${t}</a>`).join('');
}

// ---------- router ----------
const routes = {
  '#/login': viewLogin,
  '#/menu': viewMenu,
  '#/orders': viewMyOrders,
  '#/admin': viewDashboard,
  '#/admin/orders': viewAdminOrders,
  '#/admin/menu': viewAdminMenu,
  '#/admin/inventory': viewInventory,
  '#/admin/billing': viewBilling,
};
async function router() {
  let route = location.hash || '#/';
  if (!state.user && route !== '#/login') return (location.hash = '#/login');
  if (state.user && (route === '#/' || route === '#/login')) return (location.hash = isStaff() ? '#/admin' : '#/menu');
  if (route.startsWith('#/admin') && !isStaff()) return (location.hash = '#/menu');
  if (!route.startsWith('#/admin') && isStaff() && route !== '#/login') return (location.hash = '#/admin');
  if (route === '#/admin/menu' && !isAdmin()) return (location.hash = '#/admin');
  renderNav(route);
  const view = routes[route];
  if (!view) return (location.hash = '#/');
  try { await view(); } catch (e) { app.innerHTML = `<div class="panel empty"><p>${esc(e.message)}</p><button class="btn secondary" onclick="router()">Try again</button></div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);

// =====================================================================
// LOGIN / REGISTER
// =====================================================================
function viewLogin(mode = 'login') {
  const reg = mode === 'register';
  app.innerHTML = `
  <div class="login-wrap">
    <div class="login-copy">
      <h1>Order ahead. Skip the queue.</h1>
      <p>Pick your food, pay by UPI or campus wallet, and collect it at your lane when your token shows ready.</p>
    </div>
    <form class="panel login-card" id="authForm">
      <h2>${reg ? 'Create a student account' : 'Log in'}</h2>
      ${reg ? `<div class="field"><label for="name">Full name</label><input id="name" required autocomplete="name"></div>
               <div class="field"><label for="phone">Phone (optional)</label><input id="phone" inputmode="tel" placeholder="10-digit mobile"></div>` : ''}
      <div class="field"><label for="email">Email</label><input id="email" type="email" required autocomplete="username"></div>
      <div class="field"><label for="password">Password</label><input id="password" type="password" required autocomplete="${reg ? 'new-password' : 'current-password'}"></div>
      <button class="btn block" type="submit">${reg ? 'Create account' : 'Log in'}</button>
      <p class="error" id="authErr"></p>
      <div class="switch-line">${reg ? 'Already have an account?' : 'New here?'} <button type="button" id="switchMode">${reg ? 'Log in' : 'Create an account'}</button></div>
      ${reg ? '' : `<div class="demo"><p class="small muted">Sample accounts — tap to fill</p><div class="demo-list">
        <button type="button" data-e="aarav.sharma@woxsen.edu.in" data-p="Student@123">Student</button>
        <button type="button" data-e="admin@canteen.woxsen.edu.in" data-p="Admin@123">Admin</button>
        <button type="button" data-e="sunita.staff@canteen.woxsen.edu.in" data-p="Staff@123">Staff</button></div></div>`}
    </form>
  </div>`;
  $('#switchMode').onclick = () => viewLogin(reg ? 'login' : 'register');
  app.querySelectorAll('.demo-list button').forEach((b) => (b.onclick = () => { $('#email').value = b.dataset.e; $('#password').value = b.dataset.p; }));
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; $('#authErr').textContent = '';
    const email = $('#email').value, password = $('#password').value;
    try {
      if (reg) await api('/register', { method: 'POST', body: { name: $('#name').value, phone: $('#phone').value, email, password } });
      const { token, user } = await api('/login', { method: 'POST', body: { email, password } });
      setSession(token, user);
      if (reg) toast('Account created. Welcome!');
      router();
    } catch (err) { $('#authErr').textContent = err.message; btn.disabled = false; }
  };
}

// =====================================================================
// STUDENT — MENU + CART
// =====================================================================
async function viewMenu() {
  [state.menu, state.categories] = await Promise.all([api('/menu'), api('/categories')]);
  // drop cart items that are gone or sold out
  for (const id of Object.keys(state.cart)) {
    const m = state.menu.find((x) => x.item_id == id);
    if (!m || !m.availability) delete state.cart[id];
  }
  saveCart();
  app.innerHTML = `
    <div class="page-head"><div><h1>Today’s menu</h1><p class="muted">Order now and collect at your lane. 5% GST is added at checkout.</p></div></div>
    <div class="menu-layout">
      <div class="cats" id="cats"></div>
      <div>
        <input class="search" id="search" type="search" placeholder="Search dishes…" value="${esc(state.search)}" aria-label="Search dishes">
        <div id="dishes"></div>
      </div>
      <div class="cart-col" id="cartCol"><div class="panel cart" id="cart"></div></div>
    </div>
    <button class="cart-bar" id="cartBar"></button>`;
  $('#search').oninput = (e) => { state.search = e.target.value; drawDishes(); };
  $('#cartBar').onclick = () => $('#cartCol').classList.toggle('open');
  drawCats(); drawDishes(); drawCart();
}

function drawCats() {
  const counts = {};
  state.menu.forEach((m) => (counts[m.category_id] = (counts[m.category_id] || 0) + 1));
  const btn = (id, name, n) => `<button data-c="${id}" class="${state.activeCat == id ? 'active' : ''}"><span>${esc(name)}</span><span>${n}</span></button>`;
  $('#cats').innerHTML = btn('all', 'Everything', state.menu.length) +
    state.categories.filter((c) => counts[c.category_id]).map((c) => btn(c.category_id, c.category_name, counts[c.category_id])).join('');
  $('#cats').querySelectorAll('button').forEach((b) => (b.onclick = () => { state.activeCat = b.dataset.c; drawCats(); drawDishes(); }));
}

function drawDishes() {
  const q = state.search.trim().toLowerCase();
  const items = state.menu.filter((m) =>
    (state.activeCat === 'all' || m.category_id == state.activeCat) &&
    (!q || m.item_name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)));
  if (!items.length) { $('#dishes').innerHTML = `<div class="empty">No dishes match “${esc(state.search)}”. Try another word.</div>`; return; }
  const groups = state.categories.map((c) => [c, items.filter((m) => m.category_id === c.category_id)]).filter(([, l]) => l.length);
  $('#dishes').innerHTML = groups.map(([c, list]) => `
    <section class="menu-section">
      <h2>${esc(c.category_name)} <small>${esc(c.description || '')}</small></h2>
      ${list.map(dishHtml).join('')}
    </section>`).join('');
  $('#dishes').querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => changeQty(b.dataset.add, +1)));
  $('#dishes').querySelectorAll('[data-dec]').forEach((b) => (b.onclick = () => changeQty(b.dataset.dec, -1)));
}

function dishHtml(m) {
  const qty = state.cart[m.item_id] || 0;
  const control = !m.availability ? '<span class="soldout">Sold out</span>'
    : qty ? `<div class="stepper"><button data-dec="${m.item_id}" aria-label="Remove one ${esc(m.item_name)}">−</button><span>${qty}</span><button data-add="${m.item_id}" aria-label="Add one ${esc(m.item_name)}">+</button></div>`
    : `<button class="btn sm secondary" data-add="${m.item_id}">Add</button>`;
  return `<div class="dish ${m.availability ? '' : 'off'}">
    <div class="dish-name">${esc(m.item_name)}</div>
    <div class="dish-side"><span class="price num">${rs0(m.price)}</span>${control}</div>
    <div class="dish-desc">${esc(m.description || '')}</div>
    <div class="dish-meta"><span>~${m.preparation_time} min</span>${m.rating != null ? `<span>★ ${Number(m.rating).toFixed(1)}</span>` : ''}</div>
  </div>`;
}

function changeQty(id, d) {
  const q = (state.cart[id] || 0) + d;
  if (q <= 0) delete state.cart[id]; else state.cart[id] = Math.min(q, 20);
  saveCart(); drawDishes(); drawCart();
}

function cartTotals() {
  const lines = Object.entries(state.cart).map(([id, q]) => ({ m: state.menu.find((x) => x.item_id == id), q })).filter((l) => l.m);
  const sub = lines.reduce((s, l) => s + l.m.price * l.q, 0);
  const tax = Math.round(sub * TAX_RATE * 100) / 100;
  return { lines, sub, tax, total: sub + tax };
}

function drawCart() {
  const { lines, sub, tax, total } = cartTotals();
  const n = cartCount();
  $('#cartBar').innerHTML = `<span>${n} item${n === 1 ? '' : 's'} in tray</span><span class="num">${rs(total)}</span>`;
  $('#cartBar').hidden = !n;
  if (!n) { $('#cartCol').classList.remove('open'); }
  const pay = $('input[name=pay]:checked')?.value || 'UPI';
  const loc = $('#pickup')?.value || 'Main Canteen';
  $('#cart').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center"><h2>Your tray</h2><button class="x mobile-only" id="closeCart" aria-label="Close tray">×</button></div>
    ${!lines.length ? '<p class="cart-empty">Nothing yet. Add dishes from the menu and they’ll show up here.</p>' : `
      ${lines.map((l) => `<div class="cart-line"><span>${esc(l.m.item_name)}</span><span class="num">${rs(l.m.price * l.q)}</span>
        <span class="q small">${l.q} × ${rs0(l.m.price)}</span></div>`).join('')}
      <div class="totals num">
        <div><span>Subtotal</span><span>${rs(sub)}</span></div>
        <div><span>GST 5%</span><span>${rs(tax)}</span></div>
        <div class="grand"><span>Total</span><span>${rs(total)}</span></div>
      </div>
      <div class="field"><label for="pickup">Pick up from</label>
        <select id="pickup">${['Main Canteen', 'Food Court'].map((p) => `<option ${p === loc ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <label>Pay with</label>
      <div class="pay-opts">${Object.entries(PAY_TEXT).map(([k, t]) => `<label><input type="radio" name="pay" value="${k}" ${k === pay ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
      <button class="btn block" id="placeBtn">Place order · <span class="num">${rs(total)}</span></button>
      <p class="small muted" style="margin-top:8px">${pay === 'CASH' ? 'Pay at the counter. Your order starts once the cash is collected.' : 'Payment is confirmed instantly and your order goes to the kitchen.'}</p>
      <p class="error" id="placeErr"></p>`}`;
  app.querySelectorAll('input[name=pay]').forEach((r) => (r.onchange = drawCart));
  if ($('#placeBtn')) $('#placeBtn').onclick = placeOrder;
  $('#closeCart').onclick = () => $('#cartCol').classList.remove('open');
}

async function placeOrder() {
  const btn = $('#placeBtn'); btn.disabled = true;
  try {
    const items = Object.entries(state.cart).map(([item_id, quantity]) => ({ item_id: Number(item_id), quantity }));
    const { order_id } = await api('/orders', { method: 'POST', body: { items, pickup_location: $('#pickup').value, payment_method: $('input[name=pay]:checked').value } });
    state.cart = {}; saveCart();
    toast(`Order placed. Your token is ${tokenNo(order_id)}.`);
    location.hash = '#/orders';
  } catch (e) { $('#placeErr').textContent = e.message; btn.disabled = false; }
}

// =====================================================================
// STUDENT — MY ORDERS
// =====================================================================
async function viewMyOrders() {
  const orders = await api('/my/orders');
  app.innerHTML = `<div class="page-head"><div><h1>My orders</h1><p class="muted">Show your token number at the pickup lane.</p></div>
    <button class="btn secondary" id="refresh">Refresh status</button></div>
    ${orders.length ? `<div class="orders-list">${orders.map(tokenHtml).join('')}</div>`
      : `<div class="panel empty"><p>You haven’t ordered anything yet.</p><a class="btn" href="#/menu">Browse the menu</a></div>`}`;
  $('#refresh').onclick = () => { viewMyOrders(); toast('Status updated.'); };
  bindOrderButtons(orders);
}

function tokenHtml(o) {
  const step = STATUSES.indexOf(o.status);
  const cls = o.status === 'CANCELLED' ? 'cancelled' : o.status === 'COMPLETED' ? 'done' : '';
  return `<article class="token ${cls}">
    <div class="token-stub">
      <div><div class="label">Token</div><div class="no num">${tokenNo(o.order_id)}</div></div>
      <div><div class="label">${esc(o.pickup_location)}</div><div class="lane">${esc(o.pickup_lane || '—')}</div></div>
    </div>
    <div class="token-body">
      <div class="token-top">
        <div><h3>${esc(STATUS_TEXT[o.status])}</h3><p class="small muted">${fmtDate(o.order_date)}</p></div>
        ${badge(o.status)}
      </div>
      ${o.status !== 'CANCELLED' ? `<div class="progress" aria-hidden="true">${STATUSES.map((s, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>
        <div class="progress-labels"><span>Placed</span><span>Confirmed</span><span>Preparing</span><span>Ready</span><span>Picked up</span></div>` : ''}
      <div class="token-items num">${o.items.map((i) => `<div><span>${i.quantity} × ${esc(i.item_name)}</span><span>${rs(i.line_total)}</span></div>`).join('')}</div>
      <div class="token-foot">
        <div><strong class="num">${rs(o.total_amount ?? o.items_subtotal)}</strong>
          ${o.payment_status ? ` &nbsp;${badge(o.payment_status, `${PAY_TEXT[o.payment_method]} · ${o.payment_status === 'SUCCESS' ? 'paid' : o.payment_status.toLowerCase()}`)}` : ''}</div>
        <div class="actions">
          ${o.bill_id ? `<button class="btn sm secondary" data-bill="${o.order_id}">View bill</button>` : ''}
          ${['PENDING', 'CONFIRMED'].includes(o.status) ? `<button class="btn sm danger" data-cancel="${o.order_id}">Cancel order</button>` : ''}
        </div>
      </div>
    </div>
  </article>`;
}

function bindOrderButtons(orders) {
  app.querySelectorAll('[data-bill]').forEach((b) => (b.onclick = () => showBill(orders.find((o) => o.order_id == b.dataset.bill))));
  app.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => {
    if (!confirm(`Cancel order ${tokenNo(b.dataset.cancel)}?`)) return;
    try { await api(`/my/orders/${b.dataset.cancel}/cancel`, { method: 'POST' }); toast('Order cancelled.'); viewMyOrders(); }
    catch (e) { toast(e.message, true); }
  }));
}

function showBill(o) {
  const paid = o.payments.find((p) => p.payment_status === 'SUCCESS');
  openModal(`Bill ${o.bill_id}`, `
    <div class="bill">
      <div class="bill-head"><h3>Campus Canteen</h3>
        <p class="small muted">Token ${tokenNo(o.order_id)} · ${fmtDate(o.bill_date)}<br>${esc(o.customer)}</p></div>
      <table class="num">
        <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
        <tbody>${o.items.map((i) => `<tr><td>${esc(i.item_name)}</td><td class="r">${i.quantity}</td><td class="r">${rs(i.unit_price)}</td><td class="r">${rs(i.line_total)}</td></tr>`).join('')}</tbody>
        <tfoot>
          <tr><td colspan="3">Subtotal</td><td class="r">${rs(o.subtotal)}</td></tr>
          <tr><td colspan="3">GST (5%)</td><td class="r">${rs(o.tax)}</td></tr>
          ${Number(o.discount) ? `<tr><td colspan="3">Discount</td><td class="r">− ${rs(o.discount)}</td></tr>` : ''}
          <tr class="grand"><td colspan="3">Total</td><td class="r">${rs(o.total_amount)}</td></tr>
        </tfoot>
      </table>
      <p class="small" style="margin-top:14px">${paid
        ? `Paid by ${PAY_TEXT[paid.payment_method]} on ${fmtDate(paid.payment_date)}${paid.transaction_reference ? `<br><span class="muted">Ref ${esc(paid.transaction_reference)}</span>` : ''}`
        : `<span class="muted">Not paid yet${o.payment_method === 'CASH' ? ' — pay cash at the counter.' : '.'}</span>`}</p>
    </div>`, `<button class="btn secondary" onclick="window.print()">Print</button><button class="btn" data-close>Done</button>`);
}

// =====================================================================
// ADMIN — DASHBOARD / REPORTS
// =====================================================================
async function viewDashboard() {
  const r = await api('/reports');
  const max = (arr, k) => Math.max(1, ...arr.map((x) => Number(x[k])));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-CA');
    const hit = r.byDay.find((x) => x.day === key);
    days.push({ label: d.toLocaleDateString('en-IN', { weekday: 'short' }), revenue: hit ? Number(hit.revenue) : 0 });
  }
  const dmax = Math.max(1, ...days.map((d) => d.revenue));
  const bars = (arr, k, label, fmt) => arr.length ? `<div class="bars">${arr.map((x) => `
    <div class="bar-row"><span>${esc(x[label])}</span><div class="track"><div class="fill" style="width:${(Number(x[k]) / max(arr, k)) * 100}%"></div></div><span class="val">${fmt(x[k])}</span></div>`).join('')}</div>`
    : '<p class="muted small">No sales yet.</p>';

  app.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><p class="muted">Paid, non-cancelled orders only.</p></div></div>
    <div class="stats">
      <div class="panel stat"><div class="k">Revenue today</div><div class="v num">${rs0(r.revenue_today)}</div></div>
      <div class="panel stat"><div class="k">Orders today</div><div class="v num">${r.orders_today}</div></div>
      <a class="panel stat" href="#/admin/orders" style="text-decoration:none;color:inherit"><div class="k">Active orders</div><div class="v num">${r.active_orders}</div></a>
      <a class="panel stat ${r.low_stock ? 'alert' : ''}" href="#/admin/inventory" style="text-decoration:none;color:inherit"><div class="k">Ingredients to reorder</div><div class="v num">${r.low_stock}</div></a>
    </div>
    <div class="grid2">
      <div class="panel panel-pad"><h3>Revenue, last 7 days</h3>
        <div class="days">${days.map((d) => `<div class="day"><span class="amt">${d.revenue ? rs0(d.revenue) : ''}</span>
          <div class="col" style="height:${(d.revenue / dmax) * 100}%"></div><span>${d.label}</span></div>`).join('')}</div></div>
      <div class="panel panel-pad"><h3>Best sellers (by quantity)</h3>${bars(r.topItems, 'qty', 'item_name', (v) => v + ' sold')}</div>
      <div class="panel panel-pad"><h3>Sales by category</h3>${bars(r.byCategory.filter((c) => Number(c.sales)), 'sales', 'category_name', rs0)}</div>
      <div class="panel panel-pad"><h3>Totals</h3>
        <div class="totals num" style="margin:0">
          <div><span>All-time revenue</span><strong>${rs(r.revenue)}</strong></div>
          <div><span>Paid orders</span><strong>${r.paid_orders}</strong></div>
          <div><span>Average order value</span><strong>${rs(r.avg_order)}</strong></div>
          ${r.byMethod.map((m) => `<div><span>Paid by ${PAY_TEXT[m.payment_method]}</span><span>${m.n} · ${rs0(m.amount)}</span></div>`).join('')}
          <div style="margin-top:8px;gap:6px;flex-wrap:wrap;justify-content:flex-start">${r.byStatus.map((s) => badge(s.status, `${s.status.toLowerCase()} ${s.n}`)).join(' ')}</div>
        </div></div>
    </div>`;
}

// =====================================================================
// ADMIN — ORDERS
// =====================================================================
async function viewAdminOrders() {
  const orders = await api('/orders?status=' + state.adminTab);
  const tabs = [['ACTIVE', 'Active'], ...STATUSES.map((s) => [s, s.charAt(0) + s.slice(1).toLowerCase()]), ['CANCELLED', 'Cancelled'], ['ALL', 'All']];
  app.innerHTML = `
    <div class="page-head"><div><h1>Orders</h1><p class="muted">Move each order along as the kitchen works on it.</p></div>
      <button class="btn secondary" id="refresh">Refresh</button></div>
    <div class="tabs">${tabs.map(([k, t]) => `<button data-t="${k}" class="${state.adminTab === k ? 'active' : ''}">${t}</button>`).join('')}</div>
    <div class="panel table-wrap">
      ${orders.length ? `<table class="data">
        <thead><tr><th>Token</th><th>Student</th><th>Items</th><th>Pickup</th><th class="r">Total</th><th>Payment</th><th>Status</th><th></th></tr></thead>
        <tbody>${orders.map((o) => `<tr>
          <td><strong class="num">${tokenNo(o.order_id)}</strong><div class="small muted">${fmtDate(o.order_date)}</div></td>
          <td>${esc(o.customer)}</td>
          <td class="item-list">${o.items.map((i) => `${i.quantity}× ${esc(i.item_name)}`).join(', ')}</td>
          <td class="small">${esc(o.pickup_location)}<br><span class="muted">${esc(o.pickup_lane || '')}</span></td>
          <td class="r num">${rs(o.total_amount ?? o.items_subtotal)}</td>
          <td>${o.payment_status ? badge(o.payment_status, `${PAY_TEXT[o.payment_method]} · ${o.payment_status === 'SUCCESS' ? 'paid' : o.payment_status.toLowerCase()}`) : '<span class="muted small">No bill</span>'}</td>
          <td>${badge(o.status)}</td>
          <td><div class="actions">
            ${o.status === 'PENDING' && o.payment_method === 'CASH' && o.payment_status !== 'SUCCESS' ? `<button class="btn sm" data-cash="${o.bill_id}">Collect cash</button>`
              : NEXT[o.status] ? `<button class="btn sm" data-next="${o.order_id}" data-s="${NEXT[o.status]}">${NEXT_LABEL[NEXT[o.status]]}</button>` : ''}
            ${NEXT[o.status] ? `<button class="btn sm danger" data-cx="${o.order_id}">Cancel</button>` : ''}
          </div></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">No ${state.adminTab === 'ALL' ? '' : state.adminTab.toLowerCase() + ' '}orders right now.</div>`}
    </div>`;
  $('#refresh').onclick = viewAdminOrders;
  app.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { state.adminTab = b.dataset.t; viewAdminOrders(); }));
  const setStatus = async (id, status, msg) => {
    try { await api(`/orders/${id}/status`, { method: 'PATCH', body: { status } }); toast(msg); viewAdminOrders(); }
    catch (e) { toast(e.message, true); }
  };
  app.querySelectorAll('[data-next]').forEach((b) => (b.onclick = () => setStatus(b.dataset.next, b.dataset.s, `${tokenNo(b.dataset.next)} → ${b.dataset.s.toLowerCase()}`)));
  app.querySelectorAll('[data-cx]').forEach((b) => (b.onclick = () => {
    if (confirm(`Cancel order ${tokenNo(b.dataset.cx)}? Its ingredients go back into stock.`)) setStatus(b.dataset.cx, 'CANCELLED', 'Order cancelled.');
  }));
  app.querySelectorAll('[data-cash]').forEach((b) => (b.onclick = async () => {
    try { await api(`/bills/${b.dataset.cash}/collect-cash`, { method: 'POST' }); toast('Cash collected. Order confirmed.'); viewAdminOrders(); }
    catch (e) { toast(e.message, true); }
  }));
}

// =====================================================================
// ADMIN — MENU & CATEGORIES
// =====================================================================
async function viewAdminMenu() {
  [state.menu, state.categories] = await Promise.all([api('/menu'), api('/categories')]);
  app.innerHTML = `
    <div class="page-head"><div><h1>Menu</h1><p class="muted">Turn items off when they run out; students see them as sold out.</p></div>
      <div class="actions"><button class="btn secondary" id="addCat">Add category</button><button class="btn" id="addItem">Add item</button></div></div>
    <div class="panel table-wrap" style="margin-bottom:28px">
      <table class="data">
        <thead><tr><th>Item</th><th>Category</th><th class="r">Price</th><th class="r">Prep</th><th class="r">Rating</th><th>On menu</th><th></th></tr></thead>
        <tbody>${state.menu.map((m) => `<tr>
          <td><strong>${esc(m.item_name)}</strong><div class="small muted">${esc(m.description || '')}</div></td>
          <td>${esc(m.category_name)}</td>
          <td class="r num">${rs0(m.price)}</td>
          <td class="r num">${m.preparation_time} min</td>
          <td class="r num">${m.rating != null ? Number(m.rating).toFixed(1) : '—'}</td>
          <td><label class="toggle" title="Available"><input type="checkbox" data-av="${m.item_id}" ${m.availability ? 'checked' : ''} aria-label="${esc(m.item_name)} available"><span></span></label></td>
          <td><div class="actions"><button class="btn sm secondary" data-edit="${m.item_id}">Edit</button><button class="btn sm danger" data-del="${m.item_id}">Delete</button></div></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <h2 style="margin-bottom:12px">Categories</h2>
    <div class="panel table-wrap">
      <table class="data">
        <thead><tr><th>Name</th><th>Description</th><th class="r">Items</th><th></th></tr></thead>
        <tbody>${state.categories.map((c) => `<tr><td><strong>${esc(c.category_name)}</strong></td><td class="muted">${esc(c.description || '')}</td>
          <td class="r num">${c.item_count}</td>
          <td><div class="actions"><button class="btn sm secondary" data-cedit="${c.category_id}">Edit</button><button class="btn sm danger" data-cdel="${c.category_id}">Delete</button></div></td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  $('#addItem').onclick = () => itemForm();
  $('#addCat').onclick = () => catForm();
  app.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => itemForm(state.menu.find((m) => m.item_id == b.dataset.edit))));
  app.querySelectorAll('[data-cedit]').forEach((b) => (b.onclick = () => catForm(state.categories.find((c) => c.category_id == b.dataset.cedit))));
  app.querySelectorAll('[data-av]').forEach((t) => (t.onchange = async () => {
    try { await api(`/menu/${t.dataset.av}/availability`, { method: 'PATCH', body: { availability: t.checked } }); toast(t.checked ? 'Back on the menu.' : 'Marked sold out.'); }
    catch (e) { t.checked = !t.checked; toast(e.message, true); }
  }));
  app.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const m = state.menu.find((x) => x.item_id == b.dataset.del);
    if (!confirm(`Delete ${m.item_name}?`)) return;
    try { await api(`/menu/${m.item_id}`, { method: 'DELETE' }); toast('Item deleted.'); viewAdminMenu(); } catch (e) { toast(e.message, true); }
  }));
  app.querySelectorAll('[data-cdel]').forEach((b) => (b.onclick = async () => {
    const c = state.categories.find((x) => x.category_id == b.dataset.cdel);
    if (!confirm(`Delete category ${c.category_name}?`)) return;
    try { await api(`/categories/${c.category_id}`, { method: 'DELETE' }); toast('Category deleted.'); viewAdminMenu(); } catch (e) { toast(e.message, true); }
  }));
}

function itemForm(m = null) {
  const modal = openModal(m ? `Edit ${m.item_name}` : 'Add menu item', `
    <form id="itemForm">
      <div class="field"><label for="f_name">Name</label><input id="f_name" required value="${esc(m?.item_name)}"></div>
      <div class="field"><label for="f_cat">Category</label><select id="f_cat">${state.categories.map((c) => `<option value="${c.category_id}" ${m?.category_id === c.category_id ? 'selected' : ''}>${esc(c.category_name)}</option>`).join('')}</select></div>
      <div class="field"><label for="f_desc">Description</label><textarea id="f_desc">${esc(m?.description)}</textarea></div>
      <div class="row2">
        <div class="field"><label for="f_price">Price (₹)</label><input id="f_price" type="number" min="0" step="0.5" required value="${m?.price ?? ''}"></div>
        <div class="field"><label for="f_prep">Prep time (min)</label><input id="f_prep" type="number" min="0" required value="${m?.preparation_time ?? 10}"></div>
      </div>
      <div class="row2">
        <div class="field"><label for="f_rating">Rating (0–5, optional)</label><input id="f_rating" type="number" min="0" max="5" step="0.1" value="${m?.rating ?? ''}"></div>
        <div class="field"><label for="f_img">Image URL (optional)</label><input id="f_img" value="${esc(m?.image_url)}"></div>
      </div>
      <label class="check"><input type="checkbox" id="f_av" ${!m || m.availability ? 'checked' : ''}> Available to order</label>
      <p class="error" id="f_err"></p>
    </form>`, `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="f_save">${m ? 'Save changes' : 'Add item'}</button>`);
  modal.querySelector('[data-close]').onclick = () => modal.close();
  $('#f_save').onclick = async () => {
    if (!$('#itemForm').reportValidity()) return;
    const body = { item_name: $('#f_name').value, category_id: $('#f_cat').value, description: $('#f_desc').value, price: $('#f_price').value,
      preparation_time: $('#f_prep').value, rating: $('#f_rating').value, image_url: $('#f_img').value, availability: $('#f_av').checked };
    try {
      await api(m ? `/menu/${m.item_id}` : '/menu', { method: m ? 'PUT' : 'POST', body });
      modal.close(); toast(m ? 'Changes saved.' : 'Item added.'); viewAdminMenu();
    } catch (e) { $('#f_err').textContent = e.message; }
  };
}

function catForm(c = null) {
  const modal = openModal(c ? `Edit ${c.category_name}` : 'Add category', `
    <form id="catForm">
      <div class="field"><label for="c_name">Name</label><input id="c_name" required value="${esc(c?.category_name)}"></div>
      <div class="field"><label for="c_desc">Description</label><input id="c_desc" value="${esc(c?.description)}"></div>
      <p class="error" id="c_err"></p>
    </form>`, `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="c_save">${c ? 'Save changes' : 'Add category'}</button>`);
  modal.querySelector('[data-close]').onclick = () => modal.close();
  $('#c_save').onclick = async () => {
    if (!$('#catForm').reportValidity()) return;
    try {
      await api(c ? `/categories/${c.category_id}` : '/categories', { method: c ? 'PUT' : 'POST', body: { category_name: $('#c_name').value, description: $('#c_desc').value } });
      modal.close(); toast(c ? 'Changes saved.' : 'Category added.'); viewAdminMenu();
    } catch (e) { $('#c_err').textContent = e.message; }
  };
}

// =====================================================================
// ADMIN — INVENTORY
// =====================================================================
async function viewInventory() {
  const rows = await api('/inventory');
  const low = rows.filter((r) => r.is_low).length;
  app.innerHTML = `
    <div class="page-head"><div><h1>Inventory</h1>
      <p class="muted">${low ? `${low} ingredient${low === 1 ? ' is' : 's are'} at or below the reorder level.` : 'All ingredients are above their reorder level.'} Stock is deducted automatically when orders are placed.</p></div></div>
    <div class="panel table-wrap">
      <table class="data">
        <thead><tr><th>Ingredient</th><th>Used in</th><th class="r">In stock</th><th class="r">Reorder at</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.is_low ? 'low' : ''}">
          <td><strong>${esc(r.ingredient_name)}</strong><div class="small muted">Updated ${fmtDate(r.last_updated)}</div></td>
          <td class="item-list">${esc(r.used_in || '—')}</td>
          <td class="r"><input class="inline-num num" type="number" min="0" step="any" value="${Number(r.quantity_available)}" data-q="${r.inventory_id}" aria-label="${esc(r.ingredient_name)} stock"> <span class="small muted">${r.unit}</span></td>
          <td class="r"><input class="inline-num num" type="number" min="0" step="any" value="${Number(r.reorder_level)}" data-rl="${r.inventory_id}" aria-label="${esc(r.ingredient_name)} reorder level"> <span class="small muted">${r.unit}</span></td>
          <td>${r.is_low ? badge('LOW', 'Reorder') : badge('OK', 'OK')}</td>
          <td><button class="btn sm secondary" data-save="${r.inventory_id}">Save</button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  app.querySelectorAll('[data-save]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.save;
    try {
      await api(`/inventory/${id}`, { method: 'PATCH', body: { quantity_available: $(`[data-q="${id}"]`).value, reorder_level: $(`[data-rl="${id}"]`).value } });
      toast('Stock updated.'); viewInventory();
    } catch (e) { toast(e.message, true); }
  }));
}

// =====================================================================
// ADMIN — BILLING
// =====================================================================
async function viewBilling() {
  const bills = await api('/bills');
  const unpaid = bills.filter((b) => b.payment_status !== 'SUCCESS' && b.order_status !== 'CANCELLED');
  app.innerHTML = `
    <div class="page-head"><div><h1>Billing</h1>
      <p class="muted">${unpaid.length ? `${unpaid.length} bill${unpaid.length === 1 ? '' : 's'} waiting for payment (${rs(unpaid.reduce((s, b) => s + Number(b.total_amount), 0))}).` : 'Every bill is paid.'}</p></div></div>
    <div class="panel table-wrap">
      <table class="data">
        <thead><tr><th>Bill</th><th>Token</th><th>Student</th><th class="r">Subtotal</th><th class="r">GST</th><th class="r">Discount</th><th class="r">Total</th><th>Payment</th><th>Reference</th><th></th></tr></thead>
        <tbody>${bills.map((b) => `<tr>
          <td><strong class="num">B-${String(b.bill_id).padStart(4, '0')}</strong><div class="small muted">${fmtDate(b.bill_date)}</div></td>
          <td class="num">${tokenNo(b.order_id)}${b.order_status === 'CANCELLED' ? '<div class="small muted">cancelled</div>' : ''}</td>
          <td>${esc(b.customer)}</td>
          <td class="r num">${rs(b.subtotal)}</td><td class="r num">${rs(b.tax)}</td>
          <td class="r num">${Number(b.discount) ? '− ' + rs(b.discount) : '—'}</td>
          <td class="r num"><strong>${rs(b.total_amount)}</strong></td>
          <td>${b.payment_status ? badge(b.payment_status, `${PAY_TEXT[b.payment_method]} · ${b.payment_status === 'SUCCESS' ? 'paid' : b.payment_status.toLowerCase()}`) : '—'}</td>
          <td class="small muted num">${esc(b.transaction_reference || (b.payment_method === 'CASH' ? 'Cash' : '—'))}</td>
          <td>${b.payment_status !== 'SUCCESS' && b.order_status !== 'CANCELLED' ? `<button class="btn sm" data-cash="${b.bill_id}">Record cash</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  app.querySelectorAll('[data-cash]').forEach((btn) => (btn.onclick = async () => {
    try { await api(`/bills/${btn.dataset.cash}/collect-cash`, { method: 'POST' }); toast('Payment recorded.'); viewBilling(); }
    catch (e) { toast(e.message, true); }
  }));
}

router();
