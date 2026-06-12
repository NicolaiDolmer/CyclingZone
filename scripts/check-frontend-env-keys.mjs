import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_ENV_FILES = [
  "frontend/.env",
  "frontend/.env.local",
  "frontend/.env.development",
  "frontend/.env.production",
];

const SERVER_ONLY_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  ["DISCORD", "BOT", "TOKEN"].join("_"),
  "DISCORD_TEST_CHANNEL_WEBHOOK_URL",
  "DISCORD_TOKEN",
  "DISCORD_WEBHOOK",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "SENTRY_AUTH_TOKEN",
  "SUPABASE_DB_URL",
  "SUPABASE_SERVICE_KEY",
  "TEST_ACCOUNT_PASSWORD",
]);

export function parseEnvKeyNames(text) {
  const keys = [];

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.push(match[1]);
  }

  return keys;
}

export function findBlockedFrontendEnvKeys(keys) {
  return [...new Set(keys.filter((key) => SERVER_ONLY_KEYS.has(key)))].sort();
}

export function checkFrontendEnvFiles(paths = DEFAULT_ENV_FILES) {
  const findings = [];

  for (const path of paths) {
    if (!existsSync(path)) continue;
    const blockedKeys = findBlockedFrontendEnvKeys(parseEnvKeyNames(readFileSync(path, "utf8")));
    if (blockedKeys.length > 0) findings.push({ path, blockedKeys });
  }

  return findings;
}

function main() {
  const paths = process.argv.slice(2);
  const findings = checkFrontendEnvFiles(paths.length > 0 ? paths : DEFAULT_ENV_FILES);

  if (findings.length === 0) {
    console.log("frontend-env-keys: OK");
    return;
  }

  console.error("frontend-env-keys: BLOCKED server-only variable name(s) in frontend env:");
  for (const finding of findings) {
    console.error(`  ${finding.path}: ${finding.blockedKeys.join(", ")}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
