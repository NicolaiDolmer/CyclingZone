import assert from "node:assert/strict";
import test from "node:test";

import {
  findBlockedFrontendEnvKeys,
  parseEnvKeyNames,
} from "./check-frontend-env-keys.mjs";

test("parseEnvKeyNames returns names only and ignores comments", () => {
  const secretValue = "must-not-appear-in-output";
  const keys = parseEnvKeyNames(`
    # local frontend config
    VITE_API_URL=https://example.test
    export VITE_SUPABASE_ANON_KEY=${secretValue}

    INVALID LINE
  `);

  assert.deepEqual(keys, ["VITE_API_URL", "VITE_SUPABASE_ANON_KEY"]);
  assert.doesNotMatch(JSON.stringify(keys), new RegExp(secretValue));
});

test("findBlockedFrontendEnvKeys allows browser-safe Vite variables", () => {
  const blocked = findBlockedFrontendEnvKeys([
    "VITE_API_URL",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_SENTRY_DSN",
  ]);

  assert.deepEqual(blocked, []);
});

test("findBlockedFrontendEnvKeys rejects server-only variables", () => {
  const blocked = findBlockedFrontendEnvKeys([
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_DB_URL",
    "DISCORD_TOKEN",
    "DISCORD_BOT_TOKEN",
    "SENTRY_AUTH_TOKEN",
    "TEST_ACCOUNT_PASSWORD",
  ]);

  assert.deepEqual(blocked, [
    "DISCORD_BOT_TOKEN",
    "DISCORD_TOKEN",
    "SENTRY_AUTH_TOKEN",
    "SUPABASE_DB_URL",
    "SUPABASE_SERVICE_KEY",
    "TEST_ACCOUNT_PASSWORD",
  ]);
});
