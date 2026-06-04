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
4. **Variables** — copy from your `.env`:

| Variable | Railway value |
|----------|----------------|
| `GOOGLE_SHEET_ID` | your sheet |
| `USE_SHEET_GROUPS` | `true` |
| `ENGAGE_ONLY` | `false` |
| `CHROME_BOT_DATA_DIR` | `/app/data/linkedin-bot-chrome` |
| `DATA_DIR` | `/app/data` |
| `CHROME_PATH` | `/usr/bin/chromium` |
| `CHROME_HEADLESS` | `true` |
| `TZ` | `America/New_York` (your timezone) |
| `CYCLES_PER_DAY` | `5` |
| `ACTIVE_HOURS_START` | `8` |
| `ACTIVE_HOURS_END` | `20` |

Plus your post/comment selectors from `.env`.

5. **Start command:** `node src/daemon.js` (default from Dockerfile)

6. **LinkedIn login (once):** Copy `linkedin-bot-chrome` from your laptop into the volume, or let the first cycle complete login (may be harder on datacenter IP).

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
