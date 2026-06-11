import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");
const FRONTEND_SRC = join(__dirname, "../../frontend/src");

// ============================================================
// #517/#1180 — discord_settings: route-ownership forward-guard
// ------------------------------------------------------------
// Rod-årsag (#1180-audit 11/6): #529-tab-refactoren genskabte direkte
// supabase-CRUD på discord_settings i den NYE live-fil (AdminSystemTab.jsx),
// mens #517-hærdningen kun levede videre i den døde AdminPage.jsx — ingen
// guard pegede på den fil der faktisk var routet, så regressionen var
// usynlig for CI. Denne test scanner HELE frontend/src, så en fremtidig
// refactor ikke kan genindføre klient-CRUD på webhook-secrets uden at fejle.
// ============================================================

function walkSourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSourceFiles(full, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(full);
  }
  return out;
}

test("ingen frontend-fil laver direkte supabase-CRUD på discord_settings", () => {
  const offenders = walkSourceFiles(FRONTEND_SRC).filter((file) =>
    /supabase\s*\.\s*from\(\s*["'`]discord_settings["'`]\s*\)/.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(
    offenders.map((f) => f.slice(FRONTEND_SRC.length)),
    [],
    "discord_settings ejes af backend (#517) — brug /api/admin/discord-settings-routes, aldrig supabase-klienten",
  );
});

test("AdminSystemTab.jsx bruger de hærdede discord-settings-routes", () => {
  const source = readFileSync(
    join(FRONTEND_SRC, "pages/admin/AdminSystemTab.jsx"),
    "utf8",
  );
  assert.match(source, /\/api\/admin\/discord-settings/, "list/opret skal gå via backend-routen");
  assert.match(
    source,
    /\/api\/admin\/discord-settings\/\$\{[^}]+\}\/test/,
    "webhook-test skal ske via :id/test (gemt URL server-side), ikke ved at sende rå webhook_url fra klienten",
  );
  assert.match(source, /webhook_url_masked/, "UI skal vise den maskerede URL, ikke rå webhook_url");
});

test("rå-URL test-routen POST /admin/discord/test er fjernet", () => {
  assert.doesNotMatch(
    apiSource,
    /router\.post\(\s*"\/admin\/discord\/test"/,
    "Routen der tog rå webhook_url fra klienten må ikke genindføres — brug /admin/discord-settings/:id/test",
  );
});

test("alle discord-settings-routes er requireAdmin-gated (+ rate-limited på writes)", () => {
  assert.match(apiSource, /router\.get\(\s*"\/admin\/discord-settings"\s*,\s*requireAdmin/);
  assert.match(apiSource, /router\.post\(\s*"\/admin\/discord-settings"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/);
  assert.match(apiSource, /router\.patch\(\s*"\/admin\/discord-settings\/:id\/default"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/);
  assert.match(apiSource, /router\.delete\(\s*"\/admin\/discord-settings\/:id"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/);
  assert.match(apiSource, /router\.post\(\s*"\/admin\/discord-settings\/:id\/test"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/);
});

test("GET /admin/discord-settings returnerer kun maskerede URLs", () => {
  const block = apiSource.match(
    /router\.get\(\s*"\/admin\/discord-settings"[\s\S]*?\n\}\);/,
  );
  assert.ok(block, "Kunne ikke isolere GET /admin/discord-settings-handler-block");
  assert.match(
    block[0],
    /webhook_url_masked:\s*maskWebhookUrl\(/,
    "GET-handleren skal maskere webhook_url server-side før respons",
  );
});
