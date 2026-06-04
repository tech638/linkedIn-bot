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

6. **LinkedIn session (required on Railway):** Email/password login **does not work** in headless on Railway (`login_failed` on `/login/`). Use saved cookies instead:

   **On your laptop** (log in once with visible Chrome — `CHROME_HEADLESS=false` in `.env` or local run):

   ```bash
   npm run cycle          # complete LinkedIn login in the bot window
   npm run export-cookies # writes linkedin-cookies.json
   ```

   **On Railway** (pick one):

   - Upload `linkedin-cookies.json` to the volume at `/app/data/linkedin-cookies.json`
   - Or set variable `LINKEDIN_LI_AT` to the `li_at` cookie value (DevTools → Application → Cookies → linkedin.com)

   Redeploy. Logs should show `Restoring LinkedIn session` then `Session restore OK`.

   Production skips password login when no session file is present (`no_session_on_server`).

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
