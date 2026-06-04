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

6. **LinkedIn session (recommended):** Railway datacenter IPs often block email/password login (you will see `Still on login page` / `login_failed`). After a successful login on your laptop:

   ```bash
   # From your machine (profile path from lib/hardcoded-config.js / CHROME_BOT_DATA_DIR)
   railway volume list
   railway run bash   # or use Railway shell + upload
   # Copy ~/.config/linkedin-bot-chrome (or your local bot profile) into the volume at /app/data/linkedin-bot-chrome
   ```

   The bot stores Chrome under `CHROME_BOT_DATA_DIR` on the mounted volume so `li_at` cookies survive redeploys.

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
