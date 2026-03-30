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
// Each cashier has a name and a 4-digit PIN
db.exec(`
  CREATE TABLE IF NOT EXISTS cashiers (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    pin   TEXT NOT NULL  -- Stored as plain text for MVP; hash with bcrypt in production
  )
`);

// ── Transactions ──────────────────────────────────────────────────────────────
// Now includes cashier_id so we know who processed each transaction
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    cashier_id  INTEGER NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('topup', 'payment')),
    amount      REAL NOT NULL,
    timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ── Seed a default cashier so system works out of the box ─────────────────────
const existing = db.prepare("SELECT COUNT(*) as c FROM cashiers").get();
if (existing.c === 0) {
  db.prepare("INSERT INTO cashiers (name, pin) VALUES (?, ?)").run("Admin", "1234");
  console.log("🔑 Default cashier created: Admin / PIN: 1234");
}

console.log("✅ Database ready (wallet.db)");
module.exports = db;
