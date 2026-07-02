// UA-baseret bot-klassifikation for /api/collect (#2040). Bots TÆLLES men flagges
// (is_bot=true) så bot-andelen er synlig men ekskluderet fra headline-bounce.
// Ren funktion — unit-testbar uden HTTP.
const BOT_PATTERNS = [
  /bot\b/i, /crawl/i, /spider/i, /slurp/i,
  /googlebot/i, /bingbot/i, /yandex/i, /baiduspider/i, /duckduckbot/i,
  /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i, /embedly/i, /quora link preview/i,
  /pinterest/i, /redditbot/i, /discordbot/i, /telegrambot/i, /whatsapp/i, /slackbot/i,
  /headless/i, /phantomjs/i, /puppeteer/i, /playwright/i, /selenium/i,
  /python-requests/i, /python-urllib/i, /\bcurl\//i, /\bwget\b/i, /go-http-client/i, /axios\//i, /node-fetch/i,
  /ahrefs/i, /semrush/i, /mj12bot/i, /dotbot/i, /petalbot/i, /applebot/i, /gptbot/i, /claudebot/i, /ccbot/i,
  /monitor/i, /uptime/i, /pingdom/i, /lighthouse/i,
];

export function isBotUserAgent(ua) {
  if (typeof ua !== "string" || ua.trim().length === 0) return true; // tom UA = bot/script
  return BOT_PATTERNS.some((re) => re.test(ua));
}

export const __testing__ = { BOT_PATTERNS };
