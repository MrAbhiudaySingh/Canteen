# ER Diagram — Canteen Food Ordering & Billing Management System

![ER Diagram](er-diagram.jpg)

> Put the ER diagram image next to this file as `er-diagram.jpg` so it shows above on GitHub. The diagrams below are the same model in [Mermaid](https://mermaid.js.org/), which GitHub renders automatically.

---

## 1. Entities

| # | Entity | Type | Primary key | Attributes |
|---|--------|------|-------------|------------|
| 1 | CUSTOMER | Main | customer_id | name, roll_no, email, phone, user_type (Student/Faculty/Staff), department |
| 2 | FOOD_ORDER | Transaction | order_id | customer_id (FK), order_time, status (Pending/Preparing/Completed/Cancelled), total_amount, payment_status (Paid/Unpaid), order_type (Dine-in/Takeaway) |
| 3 | ORDER_ITEM | Transaction / Associative | order_item_id | order_id (FK), item_id (FK), quantity, unit_price, subtotal |
| 4 | FOOD_ITEM | Main | item_id | category_id (FK), item_name, description, price, is_available (Yes/No), image_url |
| 5 | CATEGORY | Master / Lookup | category_id | category_name, description |
| 6 | BILL | Transaction | bill_id | order_id (FK), bill_date, subtotal, tax_amount, total_amount |
| 7 | PAYMENT | Transaction | payment_id | bill_id (FK), payment_time, amount, payment_method (Cash/Card/UPI), transaction_id |
| 8 | STAFF | Main | staff_id | name, role (Admin/Cashier/Cook/Manager), phone, email, username, password_hash |
| 9 | MENU_ITEM | Master / Lookup | menu_id | item_name, description, price, category (Veg/Non-Veg), is_available (Yes/No) |
| 10 | INVENTORY | Main | inventory_id | item_id (FK), ingredient_name, quantity, unit, reorder_level |

## 2. Relationships

| Relationship | Entity A | Cardinality | Entity B | Meaning |
|--------------|----------|:-----------:|----------|---------|
| places | CUSTOMER | 1 : N | FOOD_ORDER | A customer places many orders; each order is placed by one customer |
| contains | FOOD_ORDER | 1 : N | ORDER_ITEM | An order contains one or more order lines |
| refers to | ORDER_ITEM | N : 1 | FOOD_ITEM | Each order line refers to one food item |
| belongs to | FOOD_ITEM | N : 1 | CATEGORY | Each food item belongs to one category |
| generates | FOOD_ORDER | 1 : 1 | BILL | Each order generates one bill |
| paid via | BILL | 1 : N | PAYMENT | A bill can be paid through one or more payments (e.g. a failed UPI attempt, then cash) |
| manages | STAFF | 1 : N | MENU_ITEM | A staff member manages many menu items |
| uses | MENU_ITEM | M : N | INVENTORY | A menu item uses many inventory items; an inventory item is used by many menu items |
| mapped to | MENU_ITEM | 1 : N | FOOD_ITEM | Each food item is mapped to a menu (kitchen) item *(see note 2 in section 6)* |

---

## 3. ER Diagram — Chen notation (entities, relationships, cardinalities)

```mermaid
flowchart LR
    CUSTOMER[CUSTOMER]
    FOOD_ORDER[FOOD_ORDER]
    ORDER_ITEM[ORDER_ITEM]
    FOOD_ITEM[FOOD_ITEM]
    CATEGORY[CATEGORY]
    BILL[BILL]
    PAYMENT[PAYMENT]
    STAFF[STAFF]
    MENU_ITEM[MENU_ITEM]
    INVENTORY[INVENTORY]

    places{places}
    contains{contains}
    refers{refers to}
    belongs{belongs to}
    generates{generates}
    paid{paid via}
    manages{manages}
    uses{uses}
    mapped{mapped to}

    CUSTOMER ---|1| places ---|N| FOOD_ORDER
    FOOD_ORDER ---|1| contains ---|N| ORDER_ITEM
    ORDER_ITEM ---|N| refers ---|1| FOOD_ITEM
    FOOD_ITEM ---|N| belongs ---|1| CATEGORY
    FOOD_ORDER ---|1| generates ---|1| BILL
    BILL ---|1| paid ---|N| PAYMENT
    STAFF ---|1| manages ---|N| MENU_ITEM
    MENU_ITEM ---|N| uses ---|N| INVENTORY
    MENU_ITEM ---|1| mapped ---|N| FOOD_ITEM

    classDef main fill:#d9f2d9,stroke:#3c8c3c,color:#000
    classDef txn fill:#d6e9fb,stroke:#2f6fb0,color:#000
    classDef master fill:#fff2c2,stroke:#a08020,color:#000
    classDef rel fill:#e8dcfa,stroke:#6b4fa0,color:#000
    class CUSTOMER,FOOD_ITEM,STAFF,INVENTORY main
    class FOOD_ORDER,ORDER_ITEM,BILL,PAYMENT txn
    class CATEGORY,MENU_ITEM master
    class places,contains,refers,belongs,generates,paid,manages,uses,mapped rel
```

Colours follow the original diagram's legend: green = main entity, blue = transaction / associative entity, yellow = master / lookup entity, purple diamond = relationship.

---

## 4. ER Diagram — Crow's-foot notation (with attributes)

```mermaid
erDiagram
    CUSTOMER ||--o{ FOOD_ORDER : "places"
    FOOD_ORDER ||--|{ ORDER_ITEM : "contains"
    FOOD_ITEM ||--o{ ORDER_ITEM : "refers to"
    CATEGORY ||--o{ FOOD_ITEM : "belongs to"
    FOOD_ORDER ||--|| BILL : "generates"
    BILL ||--|{ PAYMENT : "paid via"
    STAFF ||--o{ MENU_ITEM : "manages"
    MENU_ITEM }o--o{ INVENTORY : "uses"
    MENU_ITEM ||--o{ FOOD_ITEM : "mapped to"

    CUSTOMER {
        int customer_id PK
        varchar name
        varchar roll_no
        varchar email
        varchar phone
        enum user_type "Student / Faculty / Staff"
        varchar department
    }
    FOOD_ORDER {
        int order_id PK
        int customer_id FK
        datetime order_time
        enum status "Pending / Preparing / Completed / Cancelled"
        decimal total_amount
        enum payment_status "Paid / Unpaid"
        enum order_type "Dine-in / Takeaway"
    }
    ORDER_ITEM {
        int order_item_id PK
        int order_id FK
        int item_id FK
        int quantity
        decimal unit_price
        decimal subtotal
    }
    FOOD_ITEM {
        int item_id PK
        int category_id FK
        varchar item_name
        varchar description
        decimal price
        boolean is_available "Yes / No"
        varchar image_url
    }
    CATEGORY {
        int category_id PK
        varchar category_name
        varchar description
    }
    BILL {
        int bill_id PK
        int order_id FK
        datetime bill_date
        decimal subtotal
        decimal tax_amount
        decimal total_amount
    }
    PAYMENT {
        int payment_id PK
        int bill_id FK
        datetime payment_time
        decimal amount
        enum payment_method "Cash / Card / UPI"
        varchar transaction_id
    }
    STAFF {
        int staff_id PK
        varchar name
        enum role "Admin / Cashier / Cook / Manager"
        varchar phone
        varchar email
        varchar username
        varchar password_hash
    }
    MENU_ITEM {
        int menu_id PK
        varchar item_name
        varchar description
        decimal price
        enum category "Veg / Non-Veg"
        boolean is_available "Yes / No"
    }
    INVENTORY {
        int inventory_id PK
        int item_id FK
        varchar ingredient_name
        decimal quantity
        varchar unit
        decimal reorder_level
    }
```

**Crow's-foot legend:** `||` exactly one · `o|` zero or one · `|{` one or many · `o{` zero or many.
The original diagram gives only maximum cardinalities (1 / N). The minimums above are the natural reading: an order must have at least one line, a bill has at least one payment, a customer may have no orders yet.

---

## 5. Order Status Lifecycle (FOOD_ORDER.status)

```mermaid
stateDiagram-v2
    [*] --> Pending : order placed
    Pending --> Preparing : kitchen starts
    Preparing --> Completed : served / picked up
    Pending --> Cancelled
    Preparing --> Cancelled
    Completed --> [*]
    Cancelled --> [*]
```

`payment_status` moves from **Unpaid** to **Paid** when a PAYMENT for the order's BILL succeeds.

---

## 6. Notes on the ER Diagram

1. **`order_time` is labelled FK** in FOOD_ORDER, but it doesn't reference any entity. It's a normal attribute (shown that way in section 4).
2. **"mapped to" is connected to the *refers to* diamond**, not to an entity, and has no 1 / N labels. In standard ER, a relationship links entities only. It's read here as **MENU_ITEM 1 : N FOOD_ITEM**. Redraw the line to the FOOD_ITEM box and add the cardinalities.
3. **"manages" (STAFF 1 : N MENU_ITEM)** needs a `staff_id` FK in MENU_ITEM when converted to tables. The relational schema adds it.
4. **"uses" is M : N**, so it becomes a separate junction table (`MENU_ITEM_INVENTORY`) in the relational schema. The `item_id` FK drawn inside INVENTORY doesn't implement this relationship, because MENU_ITEM's key is `menu_id`.
5. **Derived attributes:** ORDER_ITEM.subtotal (= quantity × unit_price), BILL.total_amount (= subtotal + tax_amount), FOOD_ORDER.total_amount (= the bill's total) and FOOD_ORDER.payment_status (from PAYMENT) can all be calculated. In Chen notation they'd be drawn as dashed ovals. See section 7.3 of `relationalschema.md`.
