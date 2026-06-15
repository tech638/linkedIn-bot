#!/usr/bin/env node
/** Close bot Chrome — works on Windows, macOS, and Linux. */
require("../lib/bootstrap");
const { closeBotChrome } = require("../lib/quit-bot-chrome");

closeBotChrome(process.env.CHROME_BOT_DATA_DIR);
