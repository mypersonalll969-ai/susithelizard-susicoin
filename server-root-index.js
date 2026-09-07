import "dotenv/config";
import express from "express";
import Database from "better-sqlite3";
import { Telegraf, Markup } from "telegraf";
import crypto from "crypto";

const app = express();
const db = new Database("susi.sqlite");
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;

if (!BOT_TOKEN || !WEBAPP_URL) console.warn("Set BOT_TOKEN and WEBAPP_URL in .env");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance INTEGER DEFAULT 0,
  referrals INTEGER DEFAULT 0,
  referred_by INTEGER,
  last_daily TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  reward INTEGER NOT NULL,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS task_claims (
  user_id INTEGER, task_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, task_id)
);
`);

if (db.prepare("SELECT COUNT(*) c FROM tasks").get().c === 0) {
  const add = db.prepare("INSERT INTO tasks(title,reward) VALUES (?,?)");
  add.run("Join the Susi community", 100);
  add.run("Daily check-in", 50);
  add.run("Invite a friend", 150);
}

function ensureUser(u, ref) {
  let user = db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
  if (user) {
    db.prepare("UPDATE users SET username=?, first_name=? WHERE id=?")
      .run(u.username || "", u.first_name || "", u.id);
    return user;
  }
  let referredBy = null;
  if (ref && /^ref_\d+$/.test(ref) && Number(ref.slice(4)) !== u.id) {
    const referrer = db.prepare("SELECT id FROM users WHERE id=?").get(Number(ref.slice(4)));
    if (referrer) referredBy = referrer.id;
  }
  db.prepare("INSERT INTO users(id,username,first_name,balance,referred_by) VALUES (?,?,?,?,?)")
    .run(u.id, u.username || "", u.first_name || "", 100, referredBy);
  if (referredBy) {
    db.prepare("UPDATE users SET balance=balance+250, referrals=referrals+1 WHERE id=?").run(referredBy);
  }
  return db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
}

function telegramAuthValid(initData) {
  if (!initData || !BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()].sort().map(([k,v])=>`${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (calc !== hash) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now()/1000 - authDate > 86400) return null;
  return JSON.parse(params.get("user") || "{}");
}

app.use(express.json());
app.get("/", (req,res) => res.sendFile("index.html", { root: process.cwd() }));

app.post("/api/auth", (req,res)=>{
  const tg = telegramAuthValid(req.body.initData);
  if (!tg) return res.status(401).json({error:"Invalid Telegram session"});
  const ref = req.body.ref || "";
  const user = ensureUser(tg, ref);
  res.json({user});
});

app.post("/api/daily", (req,res)=>{
  const tg = telegramAuthValid(req.body.initData);
  if (!tg) return res.status(401).json({error:"Unauthorized"});
  const u = ensureUser(tg);
  const today = new Date().toISOString().slice(0,10);
  if (u.last_daily === today) return res.json({ok:false,message:"Already claimed today"});
  db.prepare("UPDATE users SET balance=balance+50,last_daily=? WHERE id=?").run(today,tg.id);
  res.json({ok:true,reward:50});
});

app.get("/api/leaderboard", (req,res)=>{
  const rows = db.prepare("SELECT first_name,username,balance,referrals FROM users ORDER BY balance DESC LIMIT 20").all();
  res.json(rows);
});

app.get("/api/tasks", (req,res)=>{
  res.json(db.prepare("SELECT * FROM tasks WHERE active=1 ORDER BY id").all());
});

app.post("/api/tasks/claim", (req,res)=>{
  const tg = telegramAuthValid(req.body.initData);
  if (!tg) return res.status(401).json({error:"Unauthorized"});
  const task = db.prepare("SELECT * FROM tasks WHERE id=? AND active=1").get(req.body.taskId);
  if (!task) return res.status(404).json({error:"Task not found"});
  try {
    db.prepare("INSERT INTO task_claims(user_id,task_id) VALUES (?,?)").run(tg.id,task.id);
    db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(task.reward,tg.id);
    res.json({ok:true,reward:task.reward});
  } catch {
    res.status(409).json({error:"Already claimed"});
  }
});

app.post("/api/admin/task", (req,res)=>{
  if (String(req.headers["x-admin-id"]) !== String(ADMIN_ID)) return res.status(403).json({error:"Forbidden"});
  const {title,reward}=req.body;
  if (!title || !Number.isFinite(Number(reward))) return res.status(400).json({error:"Invalid task"});
  db.prepare("INSERT INTO tasks(title,reward) VALUES (?,?)").run(title,Number(reward));
  res.json({ok:true});
});

const bot = new Telegraf(BOT_TOKEN || "disabled");
if (BOT_TOKEN) {
  bot.start(ctx => {
    const ref = ctx.message.text.split(" ")[1] || "";
    const url = ref ? `${WEBAPP_URL}?ref=${encodeURIComponent(ref)}` : WEBAPP_URL;
    ctx.reply(
      `🦎 Welcome to Susithelizard!\n\n🎁 Start with 100 Susi Coins.\n👥 Invite friends and earn more.\n🏆 Complete tasks and climb the leaderboard.`,
      Markup.inlineKeyboard([[Markup.button.webApp("🚀 Open Susi App", url)]])
    );
  });
  bot.command("id", ctx => ctx.reply(`Your Telegram ID: ${ctx.from.id}`));
  bot.launch();
  process.once("SIGINT",()=>bot.stop("SIGINT"));
  process.once("SIGTERM",()=>bot.stop("SIGTERM"));
}
app.listen(PORT,()=>console.log(`Susi app running on port ${PORT}`));
