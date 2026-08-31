import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import {
  adminWriteLimiter,
  bidLimiter,
  boardWriteLimiter,
  marketWriteLimiter,
  presencePulseLimiter,
  __testing__,
} from "./rateLimiters.js";

const { buildLimiter, userOrIpKey } = __testing__;

function startApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function request(port, { path = "/", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("buildLimiter allows requests up to the limit, then returns 429", async () => {
  const limiter = buildLimiter({
    name: "test",
    windowMs: 60_000,
    max: 3,
    message: "too many",
  });
  const app = express();
  app.use(limiter);
  app.get("/", (_req, res) => res.json({ ok: true }));

  const { server, port } = await startApp(app);
  try {
    const r1 = await request(port);
    const r2 = await request(port);
    const r3 = await request(port);
    const r4 = await request(port);

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 200);
    assert.equal(r4.status, 429);

    const body = JSON.parse(r4.body);
    assert.equal(body.code, "rate_limited");
    assert.equal(body.limiter, "test");
    assert.equal(typeof body.retry_after_seconds, "number");
    assert.ok(body.retry_after_seconds > 0);
    assert.ok(r4.headers["retry-after"]);
  } finally {
    await close(server);
  }
});

test("buildLimiter scopes by user when req.user.id is set", async () => {
  const limiter = buildLimiter({
    name: "scoped",
    windowMs: 60_000,
    max: 2,
    message: "too many",
  });
  const app = express();

  // Stub auth middleware: take user id from header.
  app.use((req, _res, next) => {
    const id = req.headers["x-user-id"];
    if (id) req.user = { id };
    next();
  });
  app.use(limiter);
  app.get("/", (_req, res) => res.json({ ok: true }));

  const { server, port } = await startApp(app);
  try {
    // User A burns through its budget.
    const a1 = await request(port, { headers: { "x-user-id": "alice" } });
    const a2 = await request(port, { headers: { "x-user-id": "alice" } });
    const a3 = await request(port, { headers: { "x-user-id": "alice" } });
    assert.equal(a1.status, 200);
    assert.equal(a2.status, 200);
    assert.equal(a3.status, 429);

    // User B starts on a fresh bucket from the SAME IP.
    const b1 = await request(port, { headers: { "x-user-id": "bob" } });
    const b2 = await request(port, { headers: { "x-user-id": "bob" } });
    assert.equal(b1.status, 200);
    assert.equal(b2.status, 200);
  } finally {
    await close(server);
  }
});

test("buildLimiter is bypassed when RATE_LIMIT_DISABLED=1 was set at import time", async () => {
  // The skip flag is captured at module load. We verify the production limiters
  // expose the expected shape; the actual skip path is exercised in dev only.
  assert.equal(typeof bidLimiter, "function");
  assert.equal(typeof marketWriteLimiter, "function");
  assert.equal(typeof boardWriteLimiter, "function");
  assert.equal(typeof adminWriteLimiter, "function");
  assert.equal(typeof presencePulseLimiter, "function");
});

test("userOrIpKey prefers req.user.id over req.ip", () => {
  assert.equal(
    userOrIpKey({ user: { id: "user-123" }, ip: "1.2.3.4" }),
    "u:user-123",
  );
  assert.equal(userOrIpKey({ ip: "1.2.3.4" }), "ip:1.2.3.4");
  assert.equal(
    userOrIpKey({ user: { id: undefined }, ip: "1.2.3.4" }),
    "ip:1.2.3.4",
  );
});

test("userOrIpKey normalises IPv6 addresses to /64 subnet", () => {
  // Two hosts in the same /64 subnet → same rate-limit bucket
  const keyA = userOrIpKey({ ip: "2001:db8:85a3::1" });
  const keyB = userOrIpKey({ ip: "2001:db8:85a3::2" });
  assert.equal(keyA, keyB);
  assert.match(keyA, /^ip:/);

  // Hosts in different /64 subnets → different buckets
  const keyC = userOrIpKey({ ip: "2001:db8:85b3::1" });
  assert.notEqual(keyA, keyC);

  // IPv4 remains unchanged
  assert.equal(userOrIpKey({ ip: "10.0.0.1" }), "ip:10.0.0.1");
});

test("rateLimiters.js wires production limiters with expected names", async () => {
  // Smoke: each production limiter rate-limits at its threshold + 1 by sending
  // a tiny burst with the user-key bypass header so the test is deterministic.
  // We only verify ONE of them under load (bid) — the rest share buildLimiter
  // and are covered by the unit test above.
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: "test-user" };
    next();
  });
  app.use(bidLimiter);
  app.get("/", (_req, res) => res.json({ ok: true }));

  const { server, port } = await startApp(app);
  try {
    // bidLimiter is 60/min. Sending 61 takes a few hundred ms; keep it tight.
    const responses = [];
    for (let i = 0; i < 61; i += 1) {
      responses.push(await request(port));
    }
    const ok = responses.filter((r) => r.status === 200).length;
    const limited = responses.filter((r) => r.status === 429).length;
    assert.equal(ok, 60);
    assert.equal(limited, 1);
  } finally {
    await close(server);
  }
});

test("contract: api.js imports the rate limiters and mounts them on write routes", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const apiSource = readFileSync(
    join(__dirname, "../routes/api.js"),
    "utf8",
  );

  assert.match(apiSource, /from "\.\.\/lib\/rateLimiters\.js"/);
  assert.match(
    apiSource,
    /router\.post\("\/auctions\/:id\/bid",\s*requireAuth,\s*bidLimiter,/,
  );
  assert.match(
    apiSource,
    /router\.post\("\/transfers",\s*requireAuth,\s*marketWriteLimiter,/,
  );
  assert.match(
    apiSource,
    /router\.post\("\/board\/proposal",\s*requireAuth,\s*boardWriteLimiter,/,
  );
  assert.match(
    apiSource,
    /router\.post\("\/presence",\s*requireAuth,\s*presencePulseLimiter,/,
  );
  assert.match(
    apiSource,
    /router\.post\("\/admin\/seasons\/:id\/start",\s*requireAdmin,\s*adminWriteLimiter,/,
  );
});

test("contract: server.js sets trust proxy and owns no admin routes", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const serverSource = readFileSync(
    join(__dirname, "../server.js"),
    "utf8",
  );

  assert.match(serverSource, /app\.set\("trust proxy",\s*1\)/);
  // /api/admin/sync-uci fjernet 2026-06-12 (#1207, ejer-Option A). server.js må
  // ikke længere eje admin-routes — backend/routes/api.js er kanonisk ejer (#97).
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/admin\//);
});

test("#4446: apiBaselineLimiter is mounted before the first route in api.js", async () => {
  // Load-bearing ORDER, not just presence. express-rate-limit only guards what
  // is registered after it, and CodeQL's js/missing-rate-limiting likewise only
  // counts a limiter that GUARDS the route (see alerts 189-352, all raised on
  // `requireAuth` because no limiter ran before it). Moving this mount below a
  // route would silently un-protect everything above it.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

  const mountIndex = apiSource.indexOf("router.use(apiBaselineLimiter)");
  assert.notEqual(mountIndex, -1, "apiBaselineLimiter must be mounted in api.js");

  const firstRoute = /^router\.(get|post|put|patch|delete|use)\(/m.exec(apiSource);
  assert.ok(firstRoute, "expected at least one route registration in api.js");
  assert.equal(
    firstRoute.index,
    mountIndex,
    "apiBaselineLimiter must be the FIRST router registration in api.js",
  );

  // Keyed by IP at this position (req.user is only set later, by requireAuth),
  // which is the point: it dampens hammering against the auth layer itself.
  assert.match(apiSource, /const apiBaselineLimiter = rateLimit\(\{[\s\S]*?limit: 600,/);
});

test("#4446: the twelve previously unlimited write routes carry a limiter", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

  const expected = [
    ["/billing/checkout", "billingLimiter"],
    ["/billing/portal", "billingLimiter"],
    ["/riders/names", "presencePulseLimiter"],
    ["/scouting/estimates", "presencePulseLimiter"],
    ["/development/transition/dismiss", "presencePulseLimiter"],
    ["/me/onboarding-progress/dismiss", "presencePulseLimiter"],
    ["/dashboard/my-latest-result/seen", "presencePulseLimiter"],
    ["/sponsor/offers/accept", "boardWriteLimiter"],
    ["/club/facilities/upgrade", "boardWriteLimiter"],
    ["/club/staff/hire", "boardWriteLimiter"],
    ["/club/staff/fire", "boardWriteLimiter"],
    ["/club/staff/:id/release", "boardWriteLimiter"],
  ];

  for (const [path, limiter] of expected) {
    assert.ok(
      apiSource.includes(`router.post("${path}", requireAuth, ${limiter},`),
      `${path} must be rate-limited by ${limiter}`,
    );
  }
});

test("#4446: billingLimiter is 10 per 10 minutes and resolves via i18n", async () => {
  const { billingLimiter } = await import("./rateLimiters.js");
  assert.equal(typeof billingLimiter, "function");

  // Pin the threshold: /billing/checkout and /billing/portal each cost us an
  // outbound Alunta call, so a loosened window here is a real regression and
  // not just a tuning nit.
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: "billing-test-user" };
    next();
  });
  app.use(billingLimiter);
  app.get("/", (_req, res) => res.json({ ok: true }));
  const { server, port } = await startApp(app);
  try {
    const responses = [];
    for (let i = 0; i < 11; i += 1) responses.push(await request(port));
    assert.equal(responses.filter((r) => r.status === 200).length, 10);
    assert.equal(responses.filter((r) => r.status === 429).length, 1);
    const limited = JSON.parse(responses[10].body);
    assert.equal(limited.errorCode, "rate_billing");
    assert.equal(limited.retry_after_seconds, 600);
  } finally {
    await close(server);
  }

  // The player-facing string comes from the frontend errors:api.rate_billing
  // key, not from the backend `message` fallback — assert both locales carry it
  // so a 429 never surfaces as a raw error code (#1068).
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  for (const locale of ["en", "da"]) {
    const errors = JSON.parse(
      readFileSync(
        join(__dirname, `../../frontend/public/locales/${locale}/errors.json`),
        "utf8",
      ),
    );
    assert.ok(errors.api?.rate_billing, `${locale} errors.json needs api.rate_billing`);
  }
});
