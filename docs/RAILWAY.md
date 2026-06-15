# Deploy on Railway (fully automatic)

No web UI, no port, no manual cron. Push the repo and run **`npm start`** — the scheduler handles everything.

## What runs automatically

- **5 cycles per day** (like → comment → cooldown → post), spaced **2–3 hours**
- Only during **active hours** (default 8:00–20:00, set `TZ` + `ACTIVE_HOURS_*`)
- **Post verification** every 30 minutes
- **Group rotation** from your Google Sheet

## Railway setup

1. **New project** → Deploy from GitHub
2. **Dockerfile** builder (includes Chromium)
3. **Volume** → mount `/app/data` (LinkedIn login + daily state survive redeploys)
4. **No Railway env variables required** — settings live in:
   - `lib/hardcoded-config.js` (sheet ID, schedule, Chrome, limits)
   - `lib/auth-credentials.js` (LinkedIn login)

5. **Start command:** `node src/daemon.js` (default from Dockerfile)

6. **LinkedIn login:** Bot Chrome → email/password → open group.

   **6-digit email OTP (Railway):** Project → your service → **Variables** → **New variable**
   - Name: `LINKEDIN_VERIFICATION_CODE`
   - Value: `038323` (latest 6 digits from LinkedIn email, no spaces)
   - **Redeploy** or restart the service after each new code (codes expire in minutes).

   **After one successful login:** session is stored in `/app/data/linkedin-bot-chrome`. Restarts should log `Session restored from bot profile` and **not** send a new OTP.

   **Required:** Volume mounted at `/app/data` — without it, every redeploy wipes the profile and LinkedIn emails a new code again.

## Copy local Chrome session → Railway (skip prod login)

Log in once on your machine, then push the same bot profile to production:

1. **Local:** `CHROME_HEADLESS: "false"` in `lib/hardcoded-config.js`
2. Run `node index.js` and complete login (email, password, captcha/OTP)
3. Stop the bot and close Chrome: `bash scripts/quit-bot-chrome.sh`
4. **Push to Railway** (needs [Railway CLI](https://docs.railway.com/guides/cli) + `railway link`):

   ```bash
   npm run push-profile
   ```

   Or manually:

   ```bash
   npm run export-profile
   # upload chrome-profile-export.tar.gz somewhere, then:
   railway run node scripts/import-chrome-profile.js --url=https://YOUR_FILE_URL
   ```

5. **Restart** the Railway service. Logs should show `Session restored from bot profile`.

**Notes:** Pause the Railway bot before import. The archive contains login cookies — do not commit it to git.

   **2Captcha** is only for puzzle captchas, not email OTP.

7. **Test schedule on Railway:** `RAILWAY_TEST_SCHEDULE=true` in `lib/hardcoded-config.js` runs cycles every **5 minutes** (24h window). Set `RAILWAY_TEST_SCHEDULE` to `"false"` before real production.

## Local

```bash
npm start    # same scheduler as Railway
npm run cycle   # one cycle only (debug)
```

## You do not need

- Port 3000 / HTTP API
- `CRON_SECRET`
- External cron services
- `npm run daemon` (same as `npm start` now)
