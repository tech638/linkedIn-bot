# Setup — Ubuntu & Windows

Same codebase runs on **Ubuntu/Linux** and **Windows**. Config is in code (no `.env`).

| File | Purpose |
|------|---------|
| `lib/auth-credentials.js` | LinkedIn email + password |
| `lib/hardcoded-config.js` | Schedule, limits, sheet ID, Chrome |
| `posts.json` | Group post copy (20 posts) |

---

## 1. Prerequisites (both OS)

- **Node.js 18+** — https://nodejs.org/
- **Google Chrome** — https://www.google.com/chrome/
- **Git** (to clone the repo)

Verify setup:

```bash
npm install
npm run setup
```

---

## 2. Ubuntu / Linux

### Install Chrome

```bash
# Google Chrome (recommended)
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable

# Or Chromium
sudo apt install -y chromium-browser
```

### Install Node (if needed)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Clone & run

```bash
git clone <your-repo-url> linkedIn-bot
cd linkedIn-bot
npm install
npm run setup
```

Edit `lib/auth-credentials.js` with LinkedIn login.

```bash
npm start
```

### Ubuntu paths (automatic)

| Item | Path |
|------|------|
| Chrome | Auto: `/opt/google/chrome/google-chrome` or `/usr/bin/google-chrome` |
| Bot profile | `~/.config/linkedin-bot-chrome` |
| State file | `./.engagement-state.json` (project folder) |

First login: keep `CHROME_HEADLESS: "false"` in `hardcoded-config.js` so you see the browser.

---

## 3. Windows

### Install

1. Install **Node.js LTS** from https://nodejs.org/
2. Install **Google Chrome** from https://www.google.com/chrome/
3. Clone or copy the project folder

Open **Command Prompt** or **PowerShell**:

```cmd
cd C:\path\to\linkedIn-bot
npm install
npm run setup
```

Edit `lib/auth-credentials.js` with LinkedIn login.

```cmd
npm start
```

### Windows paths (automatic)

| Item | Path |
|------|------|
| Chrome | Auto: `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Bot profile | `%LOCALAPPDATA%\linkedin-bot-chrome` |
| State file | `.engagement-state.json` in project folder |

If Chrome is in a custom location, set path in `lib/hardcoded-config.js` → `localChromePath()` return value.

---

## 4. Common commands (both OS)

| Command | What it does |
|---------|----------------|
| `npm run setup` | Check Chrome, credentials, paths |
| `npm start` | Run scheduler (5 cycles/day) |
| `npm run cycle` | Run one cycle only |
| `npm run quit-chrome` | Close bot Chrome |
| `npm run reset-today` | Reset today's cycle counters |
| `npm run reset-deploy` | Full reset (counters + group visits) |
| `npm run export-profile` | Pack Chrome session for Railway |
| `npm run push-profile` | Export + upload session to Railway |

---

## 5. First-time LinkedIn login

1. `CHROME_HEADLESS` = `"false"` in `hardcoded-config.js` (local default)
2. Run `npm start`
3. Complete email, password, captcha/OTP in the visible Chrome window
4. Session saves to the bot profile — next runs skip login

Optional: set `LINKEDIN_VERIFICATION_CODE` in `hardcoded-config.js` if LinkedIn emails a 6-digit code.

---

## 6. Railway (production)

See [RAILWAY.md](./RAILWAY.md). Log in locally on Ubuntu or Windows, then:

```bash
npm run push-profile
```

Requires Railway CLI: `npm i -g @railway/cli` → `railway login` → `railway link`

---

## 7. Troubleshooting

| Error | Fix |
|-------|-----|
| `Browser was not found at executablePath` | Run `npm run setup` — install Chrome or fix path |
| `Bot Chrome locked` | `npm run quit-chrome` then restart |
| Login every time | Profile wiped — don't delete bot profile folder |
| Daily cycle cap | `npm run reset-today` |
| Skip old groups | `npm run reset-deploy` |
