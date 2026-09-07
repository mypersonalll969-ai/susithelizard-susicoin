# Susithelizard • Susi Coins

Telegram Mini App for Susi Coins.

## Economy
- 100 SUSI = ₹1 for in-app reward accounting.
- New user: 100 SUSI.
- Daily claim: Day 1 = 10 SUSI, Day 2 = 20 SUSI, Day 3 = 30 SUSI, etc. A missed day resets the streak.
- Successful referral: 1,000 SUSI.
- Rewarded ad: 50 SUSI, maximum 20 completed rewarded views per day.
- Minimum withdrawal: 30,000 SUSI (₹300), UPI only.

## Important: real ad setup
The app does **not** fake ad rewards. AdsGram's rewarded format is wired so the browser opens the real rewarded ad, while the balance is credited only after the AdsGram Reward URL callback reaches the server. AdsGram documents the Reward URL as an optional server confirmation mechanism. See the official docs:
- https://docs.adsgram.ai/publisher/reward-interstitial-integration
- https://docs.adsgram.ai/publisher/get-block-id

Create an AdsGram Reward ad unit and pass moderation. Then set these Render environment variables:

- `ADSGRAM_BLOCK_ID` = your approved Reward block ID
- `ADSGRAM_REWARD_SECRET` = a long random secret

Configure the AdsGram Reward URL as:
`https://YOUR-DOMAIN/api/adsgram/reward?userid=[userId]&token=YOUR_ADSGRAM_REWARD_SECRET`

Do not put the reward secret in `index.html`.

## Render environment variables
Required:
- `BOT_TOKEN` = Telegram bot token (keep secret)
- `ADMIN_TELEGRAM_ID` = your Telegram numeric ID
- `WEBAPP_URL` = `https://susithelizard-susicoin.onrender.com`
- `BOT_USERNAME` = `Susithelizard` (without @)
- `ADSGRAM_BLOCK_ID` = approved AdsGram Reward block ID
- `ADSGRAM_REWARD_SECRET` = long random secret

Build command: `npm install`
Start command: `node server-root-index.js`
Root Directory: blank

## Withdrawal system
Withdrawals are recorded as `pending`, balance is reserved/deducted atomically, and the admin Telegram account is notified. The actual UPI payment is intentionally a manual/admin process until a regulated payout provider is connected. Never promise guaranteed cash value.

## Security notes
- Telegram Mini App `initData` is validated server-side with the bot token.
- The bot token and AdsGram reward secret are never placed in frontend code.
- Client-side code cannot directly award ad coins.
- Only one pending withdrawal is allowed per user.
- Ad rewards have a server-side daily limit of 20.
- Referral rewards only trigger when a new Telegram user account is created with a valid referral.
- Tasks are disabled until each task has a real verification method; this prevents fake click-to-earn rewards.
