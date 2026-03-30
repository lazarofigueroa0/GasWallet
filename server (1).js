// server.js — GasWallet v3
// KEY CHANGE: This server now serves the frontend HTML directly.
// Cashiers just open a browser and go to http://YOUR-IP:3000
// No files to copy, no setup on their device.

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const { v4: uuidv4 } = require("uuid");
const db      = require("./db");

const app  = express();
const PORT = process.env.PORT || 3000; // Uses $PORT env var on cloud, 3000 locally

app.use(cors());
app.use(express.json());

// ── Serve the frontend ────────────────────────────────────────────────────────
// This single line makes Express serve index.html (and any other static files)
// from the "public" folder inside this backend directory.
// Cashiers open: http://YOUR-SERVER-IP:3000
app.use(express.static(path.join(__dirname, "public")));


// ═══════════════════════════════════════════════════════════════════════════════
// CASHIER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/cashiers/login", (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: "Name and PIN required" });

  const cashier = db
    .prepare("SELECT * FROM cashiers WHERE LOWER(name) = LOWER(?) AND pin = ?")
    .get(name.trim(), pin.trim());

  if (!cashier) return res.status(401).json({ error: "Invalid name or PIN" });
  return res.json({ id: cashier.id, name: cashier.name });
});

app.get("/cashiers", (req, res) => {
  const cashiers = db.prepare("SELECT id, name FROM cashiers ORDER BY name").all();
  return res.json(cashiers);
});

app.post("/cashiers", (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: "Name and PIN required" });
  if (pin.length < 4) return res.status(400).json({ error: "PIN must be at least 4 digits" });

  const exists = db.prepare("SELECT id FROM cashiers WHERE LOWER(name) = LOWER(?)").get(name.trim());
  if (exists) return res.status(400).json({ error: "A cashier with that name already exists" });

  const result = db.prepare("INSERT INTO cashiers (name, pin) VALUES (?, ?)").run(name.trim(), pin.trim());
  return res.status(201).json({ id: result.lastInsertRowid, name: name.trim() });
});


// ═══════════════════════════════════════════════════════════════════════════════
// USER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/users", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });

  const id = uuidv4();
  db.prepare("INSERT INTO users (id, name, balance) VALUES (?, ?, 0)").run(id, name.trim());
  return res.status(201).json(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
});

// GET /users — list all users, optionally filter by ?search=name
app.get("/users", (req, res) => {
  const { search } = req.query;
  let users;
  if (search && search.trim()) {
    users = db.prepare(`
      SELECT * FROM users
      WHERE LOWER(name) LIKE LOWER(?) OR id = ?
      ORDER BY name ASC
    `).all(`%${search.trim()}%`, search.trim());
  } else {
    users = db.prepare("SELECT * FROM users ORDER BY name ASC").all();
  }
  return res.json(users);
});

app.get("/users/:id", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(user);
});


// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/topup/preview", (req, res) => {
  const { userId, amount, cashierId } = req.body;
  if (!userId || !amount || !cashierId) return res.status(400).json({ error: "userId, amount and cashierId are required" });
  if (amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

  const user    = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const cashier = db.prepare("SELECT id, name FROM cashiers WHERE id = ?").get(cashierId);

  if (!user)    return res.status(404).json({ error: "User not found" });
  if (!cashier) return res.status(404).json({ error: "Cashier not found" });

  return res.json({
    user:      { name: user.name, balance: user.balance },
    cashier:   { name: cashier.name },
    amount,
    newBalance: +(user.balance + amount).toFixed(2),
  });
});

app.post("/topup", (req, res) => {
  const { userId, amount, cashierId } = req.body;
  if (!userId || !amount || !cashierId) return res.status(400).json({ error: "userId, amount and cashierId are required" });
  if (amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

  const user    = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const cashier = db.prepare("SELECT id FROM cashiers WHERE id = ?").get(cashierId);

  if (!user)    return res.status(404).json({ error: "User not found" });
  if (!cashier) return res.status(404).json({ error: "Cashier not found" });

  let transactionId;
  const doTopup = db.transaction(() => {
    db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(amount, userId);
    const result = db.prepare(
      "INSERT INTO transactions (user_id, cashier_id, type, amount) VALUES (?, ?, 'topup', ?)"
    ).run(userId, cashierId, amount);
    transactionId = result.lastInsertRowid;
  });

  doTopup();

  const updated = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId);
  return res.json({ message: "Top-up successful", newBalance: updated.balance, transactionId });
});

app.post("/pay", (req, res) => {
  const { userId, amount, cashierId } = req.body;
  if (!userId || !amount || !cashierId) return res.status(400).json({ error: "userId, amount and cashierId are required" });
  if (amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

  const user    = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const cashier = db.prepare("SELECT id FROM cashiers WHERE id = ?").get(cashierId);

  if (!user)    return res.status(404).json({ error: "User not found" });
  if (!cashier) return res.status(404).json({ error: "Cashier not found" });

  if (user.balance < amount) {
    return res.status(400).json({
      error: "Insufficient balance",
      currentBalance: user.balance,
      required: amount,
      shortfall: +(amount - user.balance).toFixed(2),
    });
  }

  let transactionId;
  const doPayment = db.transaction(() => {
    db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(amount, userId);
    const result = db.prepare(
      "INSERT INTO transactions (user_id, cashier_id, type, amount) VALUES (?, ?, 'payment', ?)"
    ).run(userId, cashierId, amount);
    transactionId = result.lastInsertRowid;
  });

  doPayment();

  const updated = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId);
  return res.json({ message: "Payment successful", newBalance: updated.balance, transactionId });
});

app.get("/transactions/:userId", (req, res) => {
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const txs = db.prepare(`
    SELECT t.*, c.name AS cashier_name
    FROM transactions t
    JOIN cashiers c ON c.id = t.cashier_id
    WHERE t.user_id = ?
    ORDER BY t.timestamp DESC
  `).all(req.params.userId);

  return res.json(txs);
});

app.get("/receipt/:transactionId", (req, res) => {
  const tx = db.prepare(`
    SELECT t.*, u.name AS user_name, c.name AS cashier_name
    FROM transactions t
    JOIN users    u ON u.id = t.user_id
    JOIN cashiers c ON c.id = t.cashier_id
    WHERE t.id = ?
  `).get(req.params.transactionId);

  if (!tx) return res.status(404).json({ error: "Transaction not found" });

  const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(tx.user_id);

  return res.json({
    receiptNumber:  tx.id,
    type:           tx.type,
    amount:         tx.amount,
    timestamp:      tx.timestamp,
    customer:       { name: tx.user_name },
    cashier:        { name: tx.cashier_name },
    currentBalance: user.balance,
    station:        process.env.STATION_NAME || "GasWallet Station",
  });
});


// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  // "0.0.0.0" means it listens on ALL network interfaces,
  // so other devices on the same WiFi can connect.
  console.log(`\n⛽  GasWallet v3 is running!`);
  console.log(`\n   Local:    http://localhost:${PORT}`);
  console.log(`   Network:  http://YOUR-IP:${PORT}  (share this with cashiers)\n`);
  console.log(`   To find YOUR-IP:`);
  console.log(`     Mac/Linux: run "ifconfig" and look for inet under en0`);
  console.log(`     Windows:   run "ipconfig" and look for IPv4 Address\n`);
});
