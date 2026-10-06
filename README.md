# Canteen Food Ordering & Billing System

Node.js + MySQL web app for `canteen_db`.

## Run it

1. Install **MySQL 8** and **Node.js 18+**.
2. Load the database (this resets it to the sample data):
   ```
   mysql -u root -p < database.sql
   ```
3. Copy `.env.example` to `.env` and put your MySQL password in `DB_PASSWORD`.
4. Install and start:
   ```
   npm install
   npm start
   ```
5. Open http://localhost:3000

## Sample logins

| Role    | Email                               | Password    |
|---------|-------------------------------------|-------------|
| Student | aarav.sharma@woxsen.edu.in          | Student@123 |
| Admin   | admin@canteen.woxsen.edu.in         | Admin@123   |
| Staff   | sunita.staff@canteen.woxsen.edu.in  | Staff@123   |

(All sample students use `Student@123`. New students can sign up on the login page.)

## What it does

**Student:** browse menu by category, search, add to tray, choose pickup point and payment (UPI / campus wallet / cash), get an order token, track status, view and print the bill, cancel before preparation starts.

**Admin / staff:** dashboard with revenue and sales reports, move orders through
Pending → Confirmed → Preparing → Ready → Picked up, collect cash payments, edit stock and reorder levels, see all bills.
Admins can also add/edit/delete menu items and categories and mark items sold out.

## How it uses the database

- Placing an order runs in one **transaction**: inserts `orders`, `order_items` (price at time of order), deducts ingredient stock from `inventory` via `menu_item_ingredients`, creates the `bills` row (5% GST) and a `payments` row. If any step fails (e.g. not enough stock), everything is rolled back.
- Cancelling an order puts its ingredients back into stock.
- UPI and wallet payments are simulated as instant success; cash stays `PENDING` until staff collect it.
- Passwords are checked against the bcrypt `password_hash`.

## Files

```
server.js         API + serves the frontend
public/index.html page shell
public/styles.css styles
public/app.js     all screens (student + admin)
database.sql      full database setup with sample data
```
