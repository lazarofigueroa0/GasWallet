// db.js — Database setup
// Creates wallet.db with 3 tables: users, cashiers, transactions

const Database = require("better-sqlite3");
const db = new Database("wallet.db");

db.pragma("journal_mode = WAL");

// ── Users ─────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    balance  REAL NOT NULL DEFAULT 0
  )
`);

// ── Cashiers ──────────────────────────────────────────────────────────────────
// role: 'cashier' = standard terminal access
//       'manager' = summary + customers, cannot charge
db.exec(`
  CREATE TABLE IF NOT EXISTS cashiers (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    pin   TEXT NOT NULL,
    role  TEXT NOT NULL DEFAULT 'cashier' CHECK(role IN ('cashier','manager'))
  )
`);

// ── Transactions ──────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    cashier_id  INTEGER NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('topup', 'payment', 'cashback')),
    amount      REAL NOT NULL,
    timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ── Seed default accounts ─────────────────────────────────────────────────────
const existing = db.prepare("SELECT COUNT(*) as c FROM cashiers").get();
if (existing.c === 0) {
  db.prepare("INSERT INTO cashiers (name, pin, role) VALUES (?, ?, ?)").run("Admin",   "1234", "cashier");
  db.prepare("INSERT INTO cashiers (name, pin, role) VALUES (?, ?, ?)").run("Manager", "0000", "manager");
  console.log("🔑 Default cashier: Admin / PIN: 1234  (role: cashier)");
  console.log("🔑 Default manager: Manager / PIN: 0000  (role: manager)");
}

// ── Migrate existing DB: add role column if missing ───────────────────────────
// Safe to run every time — skipped silently if column already exists
try {
  db.exec("ALTER TABLE cashiers ADD COLUMN role TEXT NOT NULL DEFAULT 'cashier'");
  console.log("Migrated: added role column to cashiers");
} catch { /* column already exists */ }

console.log("✅ Database ready (wallet.db)");
module.exports = db;
