# Susithelizard — Susi Coins Telegram Mini App

## 1. Install
- Install Node.js 20+
- Extract this project
- Run `npm install`

## 2. Create the Telegram bot
Use Telegram's BotFather to create a bot and copy its token.
Set `BOT_TOKEN` in `.env`.

## 3. Configure
Copy `.env.example` to `.env` and set:
BOT_TOKEN=...
WEBAPP_URL=https://your-https-domain
ADMIN_TELEGRAM_ID=...

Start with:
npm start

For local testing, expose port 3000 with an HTTPS tunnel, then put that HTTPS URL in WEBAPP_URL.

## 4. Important Telegram setup
The bot's /start button opens the Mini App. For production, set your bot's domain/web app settings in BotFather to your HTTPS domain.

## 5. Test
Open your bot and send /start.
The Mini App should open and authenticate using Telegram's signed initData.

## 6. Referral links
The app generates referral IDs like:
https://t.me/YOUR_BOT?start=ref_123456

The backend awards 250 SUSI to the referrer and gives the new user 100 SUSI.

## 7. Production hardening
Before handling real money or an on-chain token:
- Use PostgreSQL instead of SQLite.
- Add rate limiting and audit logs.
- Verify every external task server-side.
- Add CSRF/origin controls where appropriate.
- Never trust balances sent by the client.
- Use a secure wallet/claim architecture if a real token is introduced.
- Have legal/compliance review for token, referral, and earnings claims.

## Files
- server.js — Telegram bot + API + SQLite
- public/index.html — Mini App UI
- .env.example — configuration
