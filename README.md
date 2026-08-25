# CashFlow Lite — POS System

A simple, full-stack Point-of-Sale system with an owner dashboard, cashier billing interface, product management, and staff management.

---

## Tech stack

| Layer    | Technology                                    |
|----------|-----------------------------------------------|
| Frontend | React, Tailwind CSS, shadcn/ui, Recharts      |
| Backend  | Node.js + Express                             |
| Auth     | Cookie-based sessions with role-based access  |
| Icons    | @phosphor-icons/react                         |

---

## Roles

| Role    | Access                                                         |
|---------|----------------------------------------------------------------|
| Owner   | Dashboard, Products, Bills, Staff management                   |
| Cashier | Billing screen, Products (read), Bills (create)                |

---

## Getting started

### 1. Clone the repo

```bash
git clone <repo-url>
cd cashflow-lite
```

### 2. Set up environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Key variables:

```
# Backend
DATABASE_URL=sqlite:///./pos.db
SECRET_KEY=your-secret-key-here

# Test suite (optional — defaults shown)
API_BASE_URL=http://localhost:8000
TEST_OWNER_EMAIL=owner@pos.com
TEST_OWNER_PASSWORD=admin123
```

### 3. Install backend dependencies

```bash
cd backend
npm install
```

### 4. Install frontend dependencies

```bash
cd frontend
npm install
```

### 5. Run the app

From the project root, start both services together:

```bash
npm run start:all
```

Or run them separately:

```bash
npm run start:backend
npm run start:frontend
```

The frontend will be available at `http://localhost:3000` and the backend API at `http://localhost:4001`.

---

## Running the API test suite

```bash
# Against the local server (default)
python backend_test.py

# Against a specific environment
API_BASE_URL=https://your-preview-url.com python backend_test.py

# With custom owner credentials
TEST_OWNER_EMAIL=admin@example.com TEST_OWNER_PASSWORD=secret python backend_test.py
```

The suite covers:

- Owner login and session verification
- Dashboard stats (owner-only)
- Products CRUD (create, update, delete, count checks)
- Billing flow (create bill, list bills, fetch single bill)
- Staff management (create cashier, verify list)
- Cashier role-based access (can bill, denied dashboard/staff)
- Logout and post-logout access rejection

---

## Project structure

```
cashflow-lite/
├── backend/
│   ├── main.py            # App entry point & routes
│   ├── models.py          # Database models
│   ├── auth.py            # Login, logout, role middleware
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/         # Login, Dashboard, Billing, Products, Bills, Staff
│   │   └── components/    # Shared UI components
│   ├── tailwind.config.js
│   └── package.json
├── backend_test.py        # API test suite
├── design_guidelines.json # UI design spec
├── .env.example           # Environment variable template
└── README.md
```

---

## Design

UI follows the Swiss / High-Contrast design system defined in `design_guidelines.json`:

- **Fonts:** Outfit (headings), IBM Plex Sans (body), IBM Plex Mono (code/numbers)
- **Primary color:** `#002DF5`
- **Style:** Sharp edges (`rounded-none`), generous spacing, high contrast

---

## Default credentials (development only)

| Role    | Email           | Password   |
|---------|-----------------|------------|
| Owner   | owner@pos.com   | admin123   |

> **Never use these credentials in production.** Change them via environment variables or your database seed script.
