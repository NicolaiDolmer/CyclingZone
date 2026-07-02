# First-party Engagement-måling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erstat upålideligt vendor-bounce med ét førsteparts, bot-ekskluderet, consent-uafhængigt *landed → engaged → signup*-signal vi ejer — og fix den session-fragmentering der får `session_started` til at fyre 25.280× fra 50 brugere.

**Architecture:** `player_events` (logget-ind, allerede bot-frit) fixes så `session_started` kun fyrer én gang pr. ægte session. En tynd, storage-less, cookieless beacon på public-sider sender `pageview`/`engaged` til `POST /api/collect`, der bot-filtrerer (UA) + dedup'er server-side via `visit_hash` = `sha256(ip|ua|dag|secret)` (dagligt unlinkable, intet på enheden) og skriver rå anonyme rækker til `traffic_events` (service-role-only). En admin-scorecard aggregerer funnellen i SQL + ren funktion.

**Tech Stack:** React + Vite (frontend), Node + Express (backend), Supabase Postgres. Tests via `node --test`. Følger eksisterende mønstre: `signupAttribution.js`/`attributionDashboard.js` (ren builder + ren aggregator + tynd route + service-role-tabel), `rateLimiters.js`, `anonymousId.js`.

Spec: [`docs/superpowers/specs/2026-06-30-first-party-engagement-measurement-design.md`](../specs/2026-06-30-first-party-engagement-measurement-design.md). Refs #2040, #1369.

---

## File Structure

**Frontend (ny):**
- `frontend/src/lib/sessionId.js` (+ `.test.js`) — flygtigt session-id, 30-min sliding expiry.
- `frontend/src/lib/trafficBeacon.js` (+ `.test.js`) — engagement-tærskel-logik (ren) + beacon-send (tynd).
- `frontend/src/components/TrafficBeacon.jsx` — mountes i App, fyrer på public route-skift.
- `frontend/src/pages/admin/AdminTrafficMetrics...` → genbrug: nyt kort i `AdminAttributionPage.jsx` (samme admin-flade).

**Frontend (modify):**
- `frontend/src/lib/logEvent.js` — `logSessionStart()` med dedup pr. session-id.
- `frontend/src/App.jsx` — erstat de to `logEvent("session_started")` med `logSessionStart()`; mount `<TrafficBeacon>`.
- `frontend/src/pages/PrivacyPolicyPage.jsx` + `PrivacyPolicyPageEn.jsx` — én sætning om anonym aggregat-trafikstatistik.

**Backend (ny):**
- `backend/lib/botDetection.js` (+ `.test.js`) — UA-bot-klassifikation (ren).
- `backend/lib/visitHash.js` (+ `.test.js`) — `computeVisitHash({ ip, ua, day, secret })` (ren).
- `backend/lib/trafficMetrics.js` (+ `.test.js`) — `aggregateTraffic(rows)` (ren).

**Backend (modify):**
- `backend/routes/api.js` — `POST /api/collect` (offentlig, direkte `rateLimit`) + `GET /api/admin/metrics` (`requireAdmin`).
- `backend/cron.js` — daglig retention-cleanup (slet `traffic_events` > 180 dage).

**Migration:**
- `database/2026-06-30-traffic-events.sql` — `traffic_events`-tabel, service-role-only.

---

## Task 1: `sessionId.js` — flygtigt session-id med 30-min sliding expiry

**Files:**
- Create: `frontend/src/lib/sessionId.js`
- Test: `frontend/src/lib/sessionId.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSessionId, __testing__ } from "./sessionId.js";

function makeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("returnerer stabilt id inden for vinduet", () => {
  const s = makeStorage();
  const a = getSessionId(s, 1000);
  const b = getSessionId(s, 1500);
  assert.equal(a, b);
});

test("nyt id efter timeout", () => {
  const s = makeStorage();
  const a = getSessionId(s, 1000);
  const b = getSessionId(s, 1000 + 31 * 60 * 1000);
  assert.notEqual(a, b);
});

test("fallback uden storage giver stadig et id", () => {
  const id = getSessionId(null, 1000);
  assert.match(id, /./);
});

test("parseEntry afviser malformet", () => {
  assert.equal(__testing__.parseEntry("junk"), null);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd frontend && node --test src/lib/sessionId.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// frontend/src/lib/sessionId.js
// Flygtigt session-id til at deduplikere session_started (#2040). Lever i
// sessionStorage med 30-min sliding expiry — ikke cross-session, ikke koblet til
// en bruger. Bruges KUN i den logget-ind, consent-gated event-kontekst.
const KEY = "cz_session_v1"; // gitleaks:allow — sessionStorage key, ikke secret
const WINDOW_MS = 30 * 60 * 1000;

function randomId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `sid-${Math.random().toString(36).slice(2, 14)}`;
}

function parseEntry(raw) {
  if (typeof raw !== "string") return null;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.id === "string" && typeof o.ts === "number") return o;
  } catch { /* ignore */ }
  return null;
}

// `now` injectable for tests; defaults to Date.now() at call time.
export function getSessionId(storage = (typeof window !== "undefined" ? window.sessionStorage : null), now = Date.now()) {
  if (!storage) return randomId();
  try {
    const entry = parseEntry(storage.getItem(KEY));
    if (entry && now - entry.ts < WINDOW_MS) {
      storage.setItem(KEY, JSON.stringify({ id: entry.id, ts: now })); // slide
      return entry.id;
    }
    const id = randomId();
    storage.setItem(KEY, JSON.stringify({ id, ts: now }));
    return id;
  } catch {
    return randomId();
  }
}

export const __testing__ = { parseEntry, WINDOW_MS };
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd frontend && node --test src/lib/sessionId.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/sessionId.js frontend/src/lib/sessionId.test.js
git commit -m "feat(measurement): sessionId med 30-min sliding expiry (Refs #2040)"
```

---

## Task 2: Fix `session_started`-fragmentering

**Files:**
- Modify: `frontend/src/lib/logEvent.js` (tilføj `logSessionStart`)
- Modify: `frontend/src/App.jsx:103,118` (brug `logSessionStart`)

- [ ] **Step 1: Implement `logSessionStart` i `logEvent.js`**

Tilføj efter `logEvent`-eksporten:

```js
import { getSessionId } from "./sessionId.js";

// session_started fyrede før ved HVER getSession() + HVER SIGNED_IN → 25.280
// events fra 50 brugere (#2040). Dedup pr. ægte session-id (30-min vindue) så
// reloads/auth-re-init/token-refresh ikke fragmenterer én session i tusindvis.
let lastSessionStartId = null;
export function logSessionStart() {
  let sid;
  try { sid = getSessionId(); } catch { sid = null; }
  if (sid && sid === lastSessionStartId) return;
  lastSessionStartId = sid;
  logEvent("session_started", sid ? { sid } : {});
}
```

- [ ] **Step 2: Use it i `App.jsx`**

Erstat `logEvent("session_started")` begge steder (linje ~103 og ~118) med `logSessionStart()`, og importér det:
```js
import { logEvent, logSessionStart } from "./lib/logEvent";
```
(behold `logEvent`-importen — den bruges ikke længere i App, men fjern den hvis ingen anden brug; tjek med grep.)

- [ ] **Step 3: Verify**

Run: `cd frontend && node --test` (hele suiten grøn), + `grep -n "session_started" src` viser kun `logEvent.js`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/logEvent.js frontend/src/App.jsx
git commit -m "fix(measurement): dedup session_started pr. ægte session (Refs #2040)"
```

---

## Task 3: `botDetection.js` (backend, ren)

**Files:**
- Create: `backend/lib/botDetection.js` + `.test.js`

- [ ] **Step 1: Failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBotUserAgent } from "./botDetection.js";

test("kendte bots → true", () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "facebookexternalhit/1.1",
    "Twitterbot/1.0",
    "python-requests/2.31.0",
    "curl/8.4.0",
    "HeadlessChrome/120.0",
    "",
  ]) assert.equal(isBotUserAgent(ua), true, ua);
});

test("ægte browsere → false", () => {
  for (const ua of [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  ]) assert.equal(isBotUserAgent(ua), false, ua);
});
```

- [ ] **Step 2: Run → FAIL.** `cd backend && node --test lib/botDetection.test.js`

- [ ] **Step 3: Implement**

```js
// backend/lib/botDetection.js
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
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(measurement): UA bot-detektion (Refs #2040)`

---

## Task 4: `visitHash.js` (backend, ren)

**Files:** Create `backend/lib/visitHash.js` + `.test.js`

- [ ] **Step 1: Failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVisitHash, dayString } from "./visitHash.js";

test("samme input → samme hash", () => {
  const a = computeVisitHash({ ip: "1.2.3.4", ua: "x", day: "2026-06-30", secret: "s" });
  const b = computeVisitHash({ ip: "1.2.3.4", ua: "x", day: "2026-06-30", secret: "s" });
  assert.equal(a, b);
});

test("anden dag → andet hash (unlinkable cross-day)", () => {
  const a = computeVisitHash({ ip: "1.2.3.4", ua: "x", day: "2026-06-30", secret: "s" });
  const b = computeVisitHash({ ip: "1.2.3.4", ua: "x", day: "2026-07-01", secret: "s" });
  assert.notEqual(a, b);
});

test("ingen rå IP/UA i output", () => {
  const h = computeVisitHash({ ip: "1.2.3.4", ua: "secretUA", day: "2026-06-30", secret: "s" });
  assert.doesNotMatch(h, /1\.2\.3\.4|secretUA/);
  assert.match(h, /^[a-f0-9]{32}$/);
});

test("dayString formaterer YYYY-MM-DD i UTC", () => {
  assert.equal(dayString(new Date("2026-06-30T23:30:00Z")), "2026-06-30");
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```js
// backend/lib/visitHash.js
// Storage-less, consent-uafhængig visit-dedup (#2040). Hash inkluderer dagen, så
// samme besøgende får ÉT hash pr. dag (dedup) men er UNLINKABLE på tværs af dage.
// Intet lægges på brugerens enhed; rå IP/UA gemmes aldrig — kun dette hash.
import { createHash } from "node:crypto";

export function dayString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function computeVisitHash({ ip, ua, day, secret }) {
  const input = `${ip || ""}|${ua || ""}|${day || ""}|${secret || ""}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(measurement): storage-less visit_hash (Refs #2040)`

---

## Task 5: Migration `traffic_events`

**Files:** Create `database/2026-06-30-traffic-events.sql`

- [ ] **Step 1: Write migration (idempotent, service-role-only)**

```sql
-- #2040 First-party engagement-måling. traffic_events: rå anonyme web-events fra
-- den consent-uafhængige beacon (public-sider). INGEN PII: ingen rå IP/UA, intet
-- bruger-id; visit_hash er dagligt-unlinkable (sha256(ip|ua|dag|secret)).
-- Service-role-only (RLS on, ingen policies/grants — som signup_attribution):
-- skrives af /api/collect via service_role, læses kun af GET /api/admin/metrics.
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS. schema_migrations håndteres af
-- .github/workflows/auto-migrate.yml.

CREATE TABLE IF NOT EXISTS public.traffic_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event       TEXT NOT NULL,          -- 'pageview' | 'engaged'
  path        TEXT,
  device      TEXT,                   -- 'mobile' | 'desktop' | 'tablet' | null
  is_bot      BOOLEAN NOT NULL DEFAULT FALSE,
  visit_hash  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traffic_events_occurred ON public.traffic_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_traffic_events_visit    ON public.traffic_events(visit_hash);

ALTER TABLE public.traffic_events ENABLE ROW LEVEL SECURITY;
-- Ingen policies + ingen GRANTs → kun service_role (bypasser RLS) kan røre tabellen.

COMMENT ON TABLE public.traffic_events IS
  '#2040 Rå anonyme web-events fra cookieless beacon. Ingen PII. visit_hash = sha256(ip|ua|dag|secret), dagligt unlinkable. Retention 180 dage (cron). Service-role-only.';
```

- [ ] **Step 2: Lint idempotency**

Run: `node scripts/lint-migration-idempotency.mjs database/2026-06-30-traffic-events.sql`
Expected: PASS (ingen ikke-idempotent DDL).

- [ ] **Step 3: Commit** — `feat(db): traffic_events tabel for engagement-måling (Refs #2040)`

> ⚠️ PR'en med denne migration **merges af ejeren** (auto-applies i prod via auto-migrate.yml).

---

## Task 6: `POST /api/collect`

**Files:** Modify `backend/routes/api.js`

- [ ] **Step 1: Tilføj imports + en direkte rateLimit (CodeQL-sporbar) nær adminApiLimiter**

```js
import { isBotUserAgent } from "../lib/botDetection.js";
import { computeVisitHash, dayString } from "../lib/visitHash.js";

// Offentligt, ikke-autentificeret telemetri-endpoint → direkte rateLimit() (ikke
// factory'en) så CodeQL js/missing-rate-limiting kan spore den. IP-nøgle.
const collectLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `collect:${ipKeyGenerator(req.ip)}`,
  skip: () => process.env.RATE_LIMIT_DISABLED === "1",
  handler: (_req, res) => res.status(429).json({ code: "rate_limited" }),
});
```
(importér `ipKeyGenerator` fra `express-rate-limit` øverst — verificér den eksisterende import.)

- [ ] **Step 2: Tilføj route (offentlig — INGEN requireAuth)**

```js
// POST /api/collect — anonym, consent-uafhængig web-telemetri (#2040). Storage-less
// dedup via visit_hash; bots flagges men tælles. Fire-and-forget; må aldrig fejle
// for klienten. INGEN PII gemmes.
const COLLECT_EVENTS = new Set(["pageview", "engaged"]);
const TRAFFIC_SALT = process.env.TRAFFIC_SALT || "cz-traffic-v1";

router.post("/collect", collectLimiter, async (req, res) => {
  res.status(204).end(); // svar straks; resten er best-effort
  try {
    const { event, path, deviceType } = req.body || {};
    if (!COLLECT_EVENTS.has(event)) return;
    const ua = req.headers["user-agent"] || "";
    const ip = req.ip || "";
    const row = {
      event,
      path: typeof path === "string" ? path.slice(0, 200) : null,
      device: typeof deviceType === "string" ? deviceType.slice(0, 20) : null,
      is_bot: isBotUserAgent(ua),
      visit_hash: computeVisitHash({ ip, ua, day: dayString(), secret: TRAFFIC_SALT }),
    };
    await supabase.from("traffic_events").insert(row);
  } catch (e) {
    console.error("[collect] insert fejlede:", e?.message);
  }
});
```

- [ ] **Step 3: Verify endpoint mod ægte tabel** (test-real-endpoint, #2040 spec)

Run (efter migration er kørt i Supabase via apply_migration ELLER lokalt): et lille script/`curl` der POSTer `{event:"pageview",path:"/"}` og verificér en række lander med korrekt `is_bot`/`visit_hash`-form. Verificér kolonnerne findes (`select` mod tabellen).

- [ ] **Step 4: Commit** — `feat(measurement): POST /api/collect anonym telemetri (Refs #2040)`

---

## Task 7: `trafficMetrics.js` (ren aggregator)

**Files:** Create `backend/lib/trafficMetrics.js` + `.test.js`

- [ ] **Step 1: Failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateTraffic } from "./trafficMetrics.js";

// rows: pre-grupperet pr. visit_hash: { visit_hash, is_bot, pageviews, engaged_events }
test("bounce = visits med 1 pageview og ingen engaged", () => {
  const r = aggregateTraffic([
    { visit_hash: "a", is_bot: false, pageviews: 1, engaged_events: 0 }, // bounce
    { visit_hash: "b", is_bot: false, pageviews: 3, engaged_events: 0 }, // engaged (≥2 pv)
    { visit_hash: "c", is_bot: false, pageviews: 1, engaged_events: 1 }, // engaged (event)
    { visit_hash: "d", is_bot: true,  pageviews: 1, engaged_events: 0 }, // bot, ekskluderet
  ]);
  assert.equal(r.humanVisits, 3);
  assert.equal(r.engagedVisits, 2);
  assert.equal(r.bounceRate, 1 / 3); // 1 bounce / 3 human visits
  assert.equal(r.botVisits, 1);
});

test("tom input", () => {
  const r = aggregateTraffic([]);
  assert.equal(r.humanVisits, 0);
  assert.equal(r.bounceRate, 0);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```js
// backend/lib/trafficMetrics.js
// Ren aggregator (#2040), mønster som attributionDashboard.js. Input = rækker
// pre-grupperet pr. visit_hash. En visit er ENGAGED hvis ≥2 pageviews ELLER ≥1
// engaged-event. Bounce regnes KUN på bot-ekskluderede (human) visits.
export function aggregateTraffic(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let humanVisits = 0, engagedVisits = 0, botVisits = 0;
  for (const r of list) {
    if (r?.is_bot) { botVisits++; continue; }
    humanVisits++;
    const engaged = (Number(r?.pageviews) || 0) >= 2 || (Number(r?.engaged_events) || 0) >= 1;
    if (engaged) engagedVisits++;
  }
  const bounceVisits = humanVisits - engagedVisits;
  return {
    humanVisits,
    engagedVisits,
    botVisits,
    engagedRate: humanVisits ? engagedVisits / humanVisits : 0,
    bounceRate: humanVisits ? bounceVisits / humanVisits : 0,
    botShare: (humanVisits + botVisits) ? botVisits / (humanVisits + botVisits) : 0,
  };
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(measurement): trafficMetrics aggregator (Refs #2040)`

---

## Task 8: `GET /api/admin/metrics`

**Files:** Modify `backend/routes/api.js`

- [ ] **Step 1: Tilføj route (mønster som /admin/attribution)**

```js
import { aggregateTraffic } from "../lib/trafficMetrics.js";

// GET /api/admin/metrics — førsteparts engagement-scorecard (#2040). Grupperer
// traffic_events pr. visit i SQL (sidste N dage) + tæller signups fra player_events.
router.get("/admin/metrics", requireAdmin, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    const { data: visitRows, error: vErr } = await supabase.rpc("traffic_visit_rollup", { since_ts: since });
    if (vErr) throw vErr;
    const traffic = aggregateTraffic(visitRows || []);

    const { count: signups } = await supabase
      .from("player_events")
      .select("*", { count: "exact", head: true })
      .eq("event_name", "signup")
      .gte("created_at", since);

    res.json({ days, traffic, signups: signups || 0 });
  } catch (e) {
    console.error("[admin/metrics] fejl:", e?.message);
    res.status(500).json({ error: "metrics_failed" });
  }
});
```

- [ ] **Step 2: Tilføj `traffic_visit_rollup` RPC i migrationen (Task 5-tillæg)**

Tilføj til `database/2026-06-30-traffic-events.sql` (idempotent `CREATE OR REPLACE FUNCTION`, `SECURITY DEFINER`, kun service_role kalder den via route):

```sql
CREATE OR REPLACE FUNCTION public.traffic_visit_rollup(since_ts TIMESTAMPTZ)
RETURNS TABLE (visit_hash TEXT, is_bot BOOLEAN, pageviews BIGINT, engaged_events BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT visit_hash,
         bool_or(is_bot) AS is_bot,
         count(*) FILTER (WHERE event = 'pageview') AS pageviews,
         count(*) FILTER (WHERE event = 'engaged')  AS engaged_events
  FROM public.traffic_events
  WHERE occurred_at >= since_ts
  GROUP BY visit_hash
$$;
REVOKE ALL ON FUNCTION public.traffic_visit_rollup(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
```
(verificér grant-mønster mod `2026-06-29-secure-securitydefiner-rpc-grants.sql`.)

- [ ] **Step 3: Re-lint migration + verify route returnerer 200 m. admin-token.**
- [ ] **Step 4: Commit** — `feat(measurement): GET /api/admin/metrics scorecard (Refs #2040)`

---

## Task 9: `trafficBeacon.js` (ren tærskel-logik + send)

**Files:** Create `frontend/src/lib/trafficBeacon.js` + `.test.js`

- [ ] **Step 1: Failing test (ren tærskel-maskine)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEngagementTracker } from "./trafficBeacon.js";

test("engaged efter ≥2 pageviews", () => {
  let fired = 0;
  const t = makeEngagementTracker(() => fired++);
  t.pageview(); assert.equal(fired, 0);
  t.pageview(); assert.equal(fired, 1);
  t.pageview(); assert.equal(fired, 1); // kun én gang
});

test("engaged ved interaktion efter 10s", () => {
  let fired = 0;
  const t = makeEngagementTracker(() => fired++);
  t.interaction(5000); assert.equal(fired, 0);
  t.interaction(11000); assert.equal(fired, 1);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement (ren maskine + tynd send)**

```js
// frontend/src/lib/trafficBeacon.js
// Anonym, storage-less, cookieless engagement-beacon (#2040) — KUN public-sider.
// Ingen id/cookie/storage på enheden; serveren dedup'er via visit_hash. Engaged =
// ≥2 pageviews i denne page-session ELLER interaktion efter ≥10s.
const API = import.meta.env.VITE_API_URL;
const ENABLED = import.meta.env.PROD && Boolean(API);

export function makeEngagementTracker(onEngaged) {
  let pageviews = 0, engaged = false, startTs = 0;
  function fire() { if (!engaged) { engaged = true; onEngaged(); } }
  return {
    pageview() { pageviews++; if (pageviews >= 2) fire(); },
    // `elapsed` = ms siden page-load; injiceres i test, ellers beregnet i wrapper.
    interaction(elapsed) { if (elapsed >= 10_000) fire(); },
    _set(ts) { startTs = ts; }, get _startTs() { return startTs; },
  };
}

function deviceType() {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  return "desktop";
}

export function sendBeacon(event, path) {
  if (!ENABLED) return;
  try {
    const body = JSON.stringify({ event, path, deviceType: deviceType() });
    const url = `${API}/api/collect`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* telemetry må aldrig kaste */ }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(measurement): anonym engagement-beacon (Refs #2040)`

---

## Task 10: `TrafficBeacon.jsx` — mount på public route-skift

**Files:** Create `frontend/src/components/TrafficBeacon.jsx`; Modify `frontend/src/App.jsx`

- [ ] **Step 1: Implement komponent**

```jsx
// frontend/src/components/TrafficBeacon.jsx
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { makeEngagementTracker, sendBeacon } from "../lib/trafficBeacon.js";

// Måler den logget-UD cold-population (logget-ind måles via player_events).
// Storage-less + consent-uafhængig. Mountes inde i BrowserRouter.
export default function TrafficBeacon({ session }) {
  const loc = useLocation();
  const tracker = useRef(null);
  const loadTs = useRef(Date.now());
  if (!tracker.current) tracker.current = makeEngagementTracker(() => sendBeacon("engaged", loc.pathname));

  // pageview pr. route-skift (kun logget-ud)
  useEffect(() => {
    if (session) return;
    sendBeacon("pageview", loc.pathname);
    tracker.current.pageview();
  }, [session, loc.pathname]);

  // 10s+interaktion → engaged
  useEffect(() => {
    if (session) return;
    const onInteract = () => tracker.current.interaction(Date.now() - loadTs.current);
    window.addEventListener("scroll", onInteract, { passive: true, once: false });
    window.addEventListener("click", onInteract);
    return () => {
      window.removeEventListener("scroll", onInteract);
      window.removeEventListener("click", onInteract);
    };
  }, [session]);

  return null;
}
```

- [ ] **Step 2: Mount i `App.jsx`** (i `<Suspense>` ved siden af de andre integrationer):
```jsx
const TrafficBeacon = lazy(() => import("./components/TrafficBeacon.jsx"));
// ...
<TrafficBeacon session={session} />
```

- [ ] **Step 3: Verify** `cd frontend && node --test` grøn; build OK.
- [ ] **Step 4: Commit** — `feat(measurement): mount TrafficBeacon på public route-skift (Refs #2040)`

---

## Task 11: Admin-scorecard (nyt kort på AdminAttributionPage)

**Files:** Modify `frontend/src/pages/AdminAttributionPage.jsx`

- [ ] **Step 1: Hent `/api/admin/metrics` + vis funnel-kort**

Tilføj et `useEffect` der henter `${API}/api/admin/metrics?days=30` med `getAuth()`, og render et `Card` med:
- `landed` (humanVisits), `engaged` (engagedVisits), `engagedRate`, `bounceRate` (public), `botShare`, `signups`.
- Genbrug `KpiCard` + `pct`-helperen der allerede findes i filen.

Konkret kort (efter de eksisterende KPI-kort):
```jsx
{metrics && (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    <KpiCard label="Public visits (30d)" value={metrics.traffic.humanVisits} sub={`${Math.round(metrics.traffic.botShare*100)}% bots ekskluderet`} />
    <KpiCard label="Engaged" value={metrics.traffic.engagedVisits} sub={`${Math.round(metrics.traffic.engagedRate*100)}% engaged-rate`} />
    <KpiCard label="Public bounce" value={`${Math.round(metrics.traffic.bounceRate*100)}%`} sub="bot-ekskluderet, ægte" />
    <KpiCard label="Signups (30d)" value={metrics.signups} />
  </div>
)}
```

- [ ] **Step 2: Verify** build + `node --test` grøn; preview viser kortet (admin).
- [ ] **Step 3: Commit** — `feat(measurement): engagement-scorecard på admin-attribution (Refs #2040)`

---

## Task 12: Privatlivspolitik-sætning (EN+DA)

**Files:** Modify `frontend/src/pages/PrivacyPolicyPage.jsx` (DA) + `PrivacyPolicyPageEn.jsx` (EN)

- [ ] **Step 1: Tilføj én sætning** i afsnittet om anonyme data:
  - DA: "Vi indsamler anonym, aggregeret trafikstatistik (sidevisninger og engagement) uden cookies og uden at gemme IP-adresser eller andre personhenførbare data. Dette kræver ikke samtykke, da det ikke kan henføres til dig."
  - EN: tilsvarende oversættelse.
- [ ] **Step 2: Verify** build OK. **Commit** — `docs(privacy): nævn anonym aggregat-trafikstatistik (Refs #2040)`

---

## Task 13: Retention-cleanup (180 dage)

**Files:** Modify `backend/cron.js`

- [ ] **Step 1: Tilføj daglig cleanup** (find eksisterende daglig cron-blok; tilføj):
```js
// #2040 retention: traffic_events er rå anonyme events — hold dem ikke for evigt.
await supabase.from("traffic_events").delete().lt("occurred_at", new Date(Date.now() - 180 * 86400_000).toISOString());
```
(verificér cron.js' eksisterende schedule-mønster; placér i en daglig job.)

- [ ] **Step 2: Verify** `cd backend && node --test` grøn. **Commit** — `feat(measurement): 180-dages retention for traffic_events (Refs #2040)`

---

## Final verification (før PR)

- [ ] `pwsh -File scripts/verify-local.ps1` (backend+frontend tests + build) grøn.
- [ ] `cd frontend && npx playwright test core-smoke.spec.js` (alle 3 projekter) grøn.
- [ ] `node scripts/lint-migration-idempotency.mjs` grøn.
- [ ] Patch notes: intern måling → skriv hvorfor ikke brugerrettet (kun privacy-sætning).
- [ ] Åbn PR. **Migrationen → ejer merger** (auto-applies i prod).
- [ ] Flip #2040 status efter merge; #2039/#2042 er PR 2/3.

## Self-Review-noter (udført)
- Spec-dækning: session-fix (T1-2), collect+tabel+bot+hash (T3-6), metrics (T7-8), beacon (T9-10), scorecard (T11), privacy (T12), retention (T13) — alle spec-sektioner dækket.
- Typer konsistente: `computeVisitHash({ip,ua,day,secret})`, `aggregateTraffic(rows)`-form matcher RPC-output (`visit_hash,is_bot,pageviews,engaged_events`).
- Ingen placeholders i kode-steps.
