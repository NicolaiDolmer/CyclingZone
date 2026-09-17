import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// #4873 — GET /api/teams/:id/manager-status. Rodårsag: TeamProfilePage.jsx
// læste last_seen via en rå frontend-Supabase-join (manager:user_id(last_seen)),
// som database/2026-05-22-rls-permissive-policy-lockdown.sql:65-69 med rette
// gjorde RLS-blokeret for alle andre brugeres rækker (P1 PII-leak-fix). Denne
// route leverer samme (ikke-følsomme) felt via backend/service-role, ligesom
// GET /managers/:teamId allerede gør for ManagerProfilePage — som derfor
// aldrig ramte bugget. Source-scan-mønster, samme som facilityAdminGate og
// managerProfileNullGuards-testene (api.js er ét stort route-modul uden let
// testbar handler-ekstraktion for disse simple GET-ruter).

const here = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(here, "api.js"), "utf8");

const routeBlock = (() => {
  const start = api.indexOf('router.get("/teams/:id/manager-status"');
  assert.ok(start !== -1, "GET /teams/:id/manager-status skal findes i routes/api.js");
  const end = api.indexOf("router.", start + 1);
  assert.ok(end !== -1, "slutningen af /teams/:id/manager-status-handleren skal findes (næste route)");
  return api.slice(start, end);
})();

test("GET /teams/:id/manager-status kræver auth og validerer UUID", () => {
  assert.match(routeBlock, /requireAuth/);
  assert.match(routeBlock, /UUID_RE\.test\(req\.params\.id\)/);
});

test("AI-styret hold (user_id=null) giver last_seen: null uden DB-opslag på users (#2876-mønster)", () => {
  assert.match(
    routeBlock,
    /if \(!team\.user_id\) return res\.json\(\{ last_seen: null, is_online: false \}\);/,
    "samme null-guard som #2876 forhindrede i GET /managers/:teamId — team.user_id er null for AI-hold",
  );
});

test("henter KUN last_seen fra users — ikke email/discord_id/consent_preferences (ingen ny PII-lækage)", () => {
  assert.match(routeBlock, /\.from\("users"\)\s*\n?\s*\.select\("last_seen"\)/);
});

test("is_online beregnes med samme 5-minutters-vindue som GET /managers/:teamId", () => {
  assert.match(routeBlock, /5 \* 60 \* 1000/);
});

test("handleren er try/catch-indpakket (ingen hængende request ved DB-fejl)", () => {
  assert.match(routeBlock, /try\s*\{/);
  assert.match(routeBlock, /\}\s*catch\s*\(e\)\s*\{[\s\S]*?res\.status\(500\)/);
});
