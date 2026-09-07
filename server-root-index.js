import "dotenv/config";
import express from "express";
import Database from "better-sqlite3";
import { Telegraf, Markup } from "telegraf";
import crypto from "crypto";

const app = express();
const db = new Database("susi.sqlite");
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL || "https://susithelizard-susicoin.onrender.com";
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
const BOT_USERNAME = process.env.BOT_USERNAME || "Susithelizard";
const ADSGRAM_BLOCK_ID = process.env.ADSGRAM_BLOCK_ID || "";
const ADSGRAM_REWARD_SECRET = process.env.ADSGRAM_REWARD_SECRET || "";

const START_BALANCE = 100;
const REFERRAL_REWARD = 1000;
const AD_REWARD = 50;
const AD_DAILY_LIMIT = 20;
const MIN_WITHDRAWAL = 30000;

if (!BOT_TOKEN) console.warn("BOT_TOKEN is missing. Telegram bot features are disabled.");
if (!ADSGRAM_BLOCK_ID) console.warn("ADSGRAM_BLOCK_ID is missing. Rewarded ads are disabled until configured.");
if (!ADSGRAM_REWARD_SECRET) console.warn("ADSGRAM_REWARD_SECRET is missing. AdsGram server-side reward confirmation is disabled.");

app.use(express.json({ limit: "50kb" }));

// -------------------- Database --------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance INTEGER DEFAULT 0,
  referrals INTEGER DEFAULT 0,
  referred_by INTEGER,
  last_daily TEXT,
  daily_streak INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  reward INTEGER NOT NULL,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS task_claims(
  user_id INTEGER,
  task_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, task_id)
);
CREATE TABLE IF NOT EXISTS ad_claims(
  user_id INTEGER,
  claim_date TEXT,
  used INTEGER DEFAULT 0,
  PRIMARY KEY(user_id, claim_date)
);
CREATE TABLE IF NOT EXISTS withdrawals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount_susi INTEGER,
  upi_id TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);
try { db.exec("ALTER TABLE users ADD COLUMN daily_streak INTEGER DEFAULT 0"); } catch {}

// No fake task is enabled by default. Real tasks should be verified before rewarding.
db.prepare("UPDATE tasks SET active=0").run();

// -------------------- Helpers --------------------
function istDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}
function cleanUser(u) {
  return { id: Number(u.id), username: u.username || "", first_name: u.first_name || "" };
}
function adUsage(id) {
  return db.prepare("SELECT used FROM ad_claims WHERE user_id=? AND claim_date=?").get(id, istDate())?.used || 0;
}
function ensureUser(u, ref = "") {
  const user = cleanUser(u);
  const existing = db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
  if (existing) {
    db.prepare("UPDATE users SET username=?, first_name=? WHERE id=?").run(user.username, user.first_name, user.id);
    return db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
  }

  let referredBy = null;
  if (/^ref_\d+$/.test(ref)) {
    const refId = Number(ref.slice(4));
    if (refId !== user.id && db.prepare("SELECT id FROM users WHERE id=?").get(refId)) referredBy = refId;
  }

  const tx = db.transaction(() => {
    db.prepare("INSERT INTO users(id,username,first_name,balance,referred_by,daily_streak) VALUES (?,?,?,?,?,0)")
      .run(user.id, user.username, user.first_name, START_BALANCE, referredBy);
    if (referredBy) {
      db.prepare("UPDATE users SET balance=balance+?,referrals=referrals+1 WHERE id=?")
        .run(REFERRAL_REWARD, referredBy);
    }
  });
  tx();
  return db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
}
function telegramAuthValid(initData) {
  if (!initData || !BOT_TOKEN) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const dataCheck = [...p.entries()].sort().map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = Number(p.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  try { return JSON.parse(p.get("user") || "{}"); } catch { return null; }
}
function auth(req) { return telegramAuthValid(req.body?.initData); }
function jsonError(res, code, message) { return res.status(code).json({ error: message }); }

// -------------------- Pages --------------------
app.get("/", (req, res) => res.sendFile("index.html", { root: process.cwd() }));
app.get("/health", (req, res) => res.json({ ok: true, service: "susithelizard-susicoin" }));
app.get("/api/config", (req, res) => res.json({
  adConfigured: Boolean(ADSGRAM_BLOCK_ID && ADSGRAM_REWARD_SECRET),
  adsgramBlockId: ADSGRAM_BLOCK_ID,
  adReward: AD_REWARD,
  adDailyLimit: AD_DAILY_LIMIT,
  minWithdrawal: MIN_WITHDRAWAL,
  referralReward: REFERRAL_REWARD,
  botUsername: BOT_USERNAME
}));

// -------------------- User --------------------
app.post("/api/auth", (req, res) => {
  const tg = auth(req);
  if (!tg) return jsonError(res, 401, "Invalid Telegram session");
  res.json({ user: ensureUser(tg, req.body.ref || "") });
});

app.post("/api/daily", (req, res) => {
  const tg = auth(req);
  if (!tg) return jsonError(res, 401, "Unauthorized");
  const u = ensureUser(tg);
  const d = istDate();
  if (u.last_daily === d) return res.json({ ok: false, message: "Already claimed today" });
  const yesterday = istDate(-1);
  const day = u.last_daily === yesterday ? (u.daily_streak || 1) + 1 : 1;
  const reward = day * 10;
  db.prepare("UPDATE users SET balance=balance+?,last_daily=?,daily_streak=? WHERE id=?").run(reward, d, day, tg.id);
  res.json({ ok: true, reward, day });
});

app.get("/api/leaderboard", (req, res) => {
  res.json(db.prepare("SELECT first_name,username,balance,referrals FROM users ORDER BY balance DESC LIMIT 20").all());
});

// -------------------- Verified tasks --------------------
app.get("/api/tasks", (req, res) => {
  res.json(db.prepare("SELECT * FROM tasks WHERE active=1 ORDER BY id").all());
});
app.post("/api/tasks/claim", (req, res) => {
  const tg = auth(req);
  if (!tg) return jsonError(res, 401, "Unauthorized");
  const task = db.prepare("SELECT * FROM tasks WHERE id=? AND active=1").get(req.body.taskId);
  if (!task) return jsonError(res, 404, "Task not found");
  // Tasks are intentionally disabled until a real verification method is configured.
  return jsonError(res, 400, "This task is not currently available.");
});

// -------------------- AdsGram rewarded ads --------------------
app.post("/api/ad-status", (req, res) => {
  const tg = auth(req);
  if (!tg) return jsonError(res, 401, "Unauthorized");
  const used = adUsage(tg.id);
  res.json({
    ok: true,
    used,
    remaining: Math.max(0, AD_DAILY_LIMIT - used),
    limit: AD_DAILY_LIMIT,
    reward: AD_REWARD,
    providerConfigured: Boolean(ADSGRAM_BLOCK_ID && ADSGRAM_REWARD_SECRET)
  });
});

// AdsGram calls this URL after a rewarded view when Reward URL is configured.
// Configure Reward URL as: https://YOUR-DOMAIN/api/adsgram/reward?userid=[userId]&token=YOUR_SECRET
app.get("/api/adsgram/reward", (req, res) => {
  const userId = Number(req.query.userid);
  const token = String(req.query.token || "");
  if (!ADSGRAM_REWARD_SECRET || token !== ADSGRAM_REWARD_SECRET) return res.status(403).send("forbidden");
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).send("bad user");
  const user = db.prepare("SELECT id FROM users WHERE id=?").get(userId);
  if (!user) return res.status(404).send("user not found");

  const date = istDate();
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT used FROM ad_claims WHERE user_id=? AND claim_date=?").get(userId, date);
    const used = row?.used || 0;
    if (used >= AD_DAILY_LIMIT) return false;
    if (row) db.prepare("UPDATE ad_claims SET used=used+1 WHERE user_id=? AND claim_date=?").run(userId, date);
    else db.prepare("INSERT INTO ad_claims(user_id,claim_date,used) VALUES (?,?,1)").run(userId, date);
    db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(AD_REWARD, userId);
    return true;
  });
  const credited = tx();
  res.status(200).send(credited ? "ok" : "limit");
});

// Client never gets to award itself coins. It only opens the real ad and waits for the server callback.
app.post("/api/ad-complete", (req, res) => {
  const tg = auth(req);
  if (!tg) return jsonError(res, 401, "Unauthorized");
  if (!ADSGRAM_BLOCK_ID || !ADSGRAM_REWARD_SECRET) return res.json({ ok: false, message: "Rewarded ads are not configured yet." });
  const used = adUsage(tg.id);
  res.json({ ok: true, used, remaining: Math.max(0, AD_DAILY_LIMIT - used) });
});

// -------------------- Withdrawals --------------------
app.post("/api/withdraw", (req, res) => {
  const tg = auth(req);
  if (!tg) return jsonError(res, 401, "Unauthorized");
  const amount = Number(req.body.amountSusi);
  const upi = String(req.body.upiId || "").trim();
  if (!Number.isInteger(amount) || amount < MIN_WITHDRAWAL) return jsonError(res, 400, "Minimum withdrawal is 30,000 SUSI (₹300)");
  if (amount % 100 !== 0) return jsonError(res, 400, "Withdrawal amount must be in multiples of 100 SUSI");
  if (!/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9._-]{2,}$/.test(upi) || upi.length > 100) return jsonError(res, 400, "Enter a valid UPI ID");

  const tx = db.transaction(() => {
    const fresh = db.prepare("SELECT balance FROM users WHERE id=?").get(tg.id);
    if (!fresh || fresh.balance < amount) throw new Error("INSUFFICIENT");
    const pending = db.prepare("SELECT id FROM withdrawals WHERE user_id=? AND status='pending'").get(tg.id);
    if (pending) throw new Error("PENDING");
    const info = db.prepare("INSERT INTO withdrawals(user_id,amount_susi,upi_id,status) VALUES (?,?,?,?)").run(tg.id, amount, upi, "pending");
    db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(amount, tg.id);
    return info.lastInsertRowid;
  });

  try {
    const id = tx();
    if (BOT_TOKEN && ADMIN_ID) {
      const msg = `💸 New UPI withdrawal\nUser: ${tg.first_name || ""} (@${tg.username || "no_username"})\nTelegram ID: ${tg.id}\nAmount: ${amount.toLocaleString()} SUSI (₹${(amount / 100).toFixed(2)})\nUPI: ${upi}\nRequest #${id}\nStatus: pending`;
      bot.telegram.sendMessage(ADMIN_ID, msg).catch(() => {});
    }
    const fresh = db.prepare("SELECT balance FROM users WHERE id=?").get(tg.id);
    res.json({ ok: true, id, balance: fresh.balance });
  } catch (e) {
    const message = e.message === "INSUFFICIENT" ? "Insufficient balance" : e.message === "PENDING" ? "You already have a pending withdrawal" : "Could not create withdrawal request";
    return jsonError(res, 400, message);
  }
});

app.post("/api/withdrawals", (req, res) => {
  const tg = auth(req);
  if (!tg) return jsonError(res, 401, "Unauthorized");
  const rows = db.prepare("SELECT id,amount_susi,upi_id,status,created_at FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 20").all(tg.id);
  res.json({ ok: true, rows });
});

// Optional admin task creation endpoint. Use only after implementing verification for the task.
app.post("/api/admin/task", (req, res) => {
  if (!ADMIN_ID || String(req.headers["x-admin-id"]) !== String(ADMIN_ID)) return jsonError(res, 403, "Forbidden");
  const { title, reward } = req.body;
  if (!title || !Number.isFinite(Number(reward))) return jsonError(res, 400, "Invalid task");
  db.prepare("INSERT INTO tasks(title,reward,active) VALUES (?,?,0)").run(String(title).slice(0, 200), Number(reward));
  res.json({ ok: true, message: "Task saved disabled. Add verification before activating it." });
});

// -------------------- Telegram bot --------------------
const bot = new Telegraf(BOT_TOKEN || "disabled");
if (BOT_TOKEN) {
  bot.start(ctx => {
    const ref = ctx.message.text.split(" ")[1] || "";
    const base = WEBAPP_URL.replace(/\/$/, "");
    const url = ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
    ctx.reply(
      `🦎 Welcome to Susithelizard!\n\n🎁 Start with ${START_BALANCE} Susi Coins.\n👥 Each successful referral earns ${REFERRAL_REWARD.toLocaleString()} SUSI.\n📺 Rewarded ads can earn ${AD_REWARD} SUSI each, up to ${AD_DAILY_LIMIT} per day.\n💰 Minimum withdrawal: ${MIN_WITHDRAWAL.toLocaleString()} SUSI (₹300).`,
      Markup.inlineKeyboard([[Markup.button.webApp("🚀 Open Susi App", url)]])
    );
  });
  bot.command("id", ctx => ctx.reply(`Your Telegram ID: ${ctx.from.id}`));
  bot.catch(err => console.error("Telegram bot error:", err));
  bot.launch().catch(err => console.error("Telegram launch error:", err));
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

app.listen(PORT, "0.0.0.0", () => console.log(`Susi app running on port ${PORT}`));
