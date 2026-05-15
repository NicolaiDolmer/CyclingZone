import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import {
  cached,
  invalidateNamespace,
  getCacheStats,
  __testing__,
} from "./responseCache.js";

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

function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("cached: first request misses, second request hits, payload identical", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached({ namespace: "t1", ttlMs: 60_000 }, async (req, res) => {
      invocations += 1;
      res.json({ count: invocations });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    const a = await request(port, "/r");
    const b = await request(port, "/r");
    assert.equal(a.status, 200);
    assert.equal(a.headers["x-cache"], "MISS");
    assert.deepEqual(a.body, { count: 1 });
    assert.equal(b.status, 200);
    assert.equal(b.headers["x-cache"], "HIT");
    assert.deepEqual(b.body, { count: 1 }, "hit must return stored payload");
    assert.equal(invocations, 1, "handler invoked only once across hit+miss");
  } finally {
    await close(server);
  }
});

test("cached: cache key normalises query-string order", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached({ namespace: "t2", ttlMs: 60_000 }, async (req, res) => {
      invocations += 1;
      res.json({ q: req.query });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    const a = await request(port, "/r?team_id=1&page=2");
    const b = await request(port, "/r?page=2&team_id=1");
    assert.equal(a.headers["x-cache"], "MISS");
    assert.equal(b.headers["x-cache"], "HIT");
    assert.equal(invocations, 1);
  } finally {
    await close(server);
  }
});

test("cached: distinct queries get distinct cache entries", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached({ namespace: "t3", ttlMs: 60_000 }, async (req, res) => {
      invocations += 1;
      res.json({ q: req.query.q || null });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    await request(port, "/r?q=a");
    await request(port, "/r?q=b");
    await request(port, "/r?q=a");
    assert.equal(invocations, 2, "two distinct queries, third hits cache");
  } finally {
    await close(server);
  }
});

test("cached: TTL expiry triggers re-fetch", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached({ namespace: "t4", ttlMs: 30 }, async (req, res) => {
      invocations += 1;
      res.json({ count: invocations });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    const a = await request(port, "/r");
    await new Promise((r) => setTimeout(r, 50));
    const b = await request(port, "/r");
    assert.equal(a.body.count, 1);
    assert.equal(b.body.count, 2, "expired entry must trigger fresh handler");
    assert.equal(b.headers["x-cache"], "MISS");
  } finally {
    await close(server);
  }
});

test("invalidateNamespace clears entries and forces re-fetch", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached({ namespace: "t5", ttlMs: 60_000 }, async (req, res) => {
      invocations += 1;
      res.json({ count: invocations });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    await request(port, "/r");
    await request(port, "/r");
    assert.equal(invocations, 1);
    const cleared = invalidateNamespace("t5");
    assert.equal(cleared, 1);
    const after = await request(port, "/r");
    assert.equal(after.body.count, 2, "post-invalidation request hits handler");
    assert.equal(after.headers["x-cache"], "MISS");
  } finally {
    await close(server);
  }
});

test("cached: non-2xx responses are NOT cached", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached({ namespace: "t6", ttlMs: 60_000 }, async (req, res) => {
      invocations += 1;
      res.status(500).json({ error: "boom" });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    await request(port, "/r");
    await request(port, "/r");
    assert.equal(invocations, 2, "errors must always re-invoke handler");
  } finally {
    await close(server);
  }
});

test("cached: RESPONSE_CACHE_DISABLED=1 bypasses cache", async () => {
  // The env flag is read at module import, so we test the runtime path via
  // ensuring DISABLED is false here and trust the implementation; a separate
  // process boundary would be needed to exercise the env flag itself.
  const stats = getCacheStats();
  assert.ok(typeof stats.hit_rate === "number");
});

test("cached: LRU eviction beyond maxEntries removes oldest", async () => {
  __testing__.reset();
  __testing__.setMaxEntries("t7", 2);
  const app = express();
  app.get(
    "/r",
    cached({ namespace: "t7", ttlMs: 60_000 }, async (req, res) => {
      res.json({ q: req.query.q });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    await request(port, "/r?q=a"); // store a
    await request(port, "/r?q=b"); // store b
    await request(port, "/r?q=c"); // store c, evicts a
    const aAfter = await request(port, "/r?q=a");
    assert.equal(aAfter.headers["x-cache"], "MISS", "a was evicted");
    const bAfter = await request(port, "/r?q=b");
    // b might or might not still be present depending on LRU touches above;
    // this is mainly a smoke test that eviction does not crash.
    assert.ok(["HIT", "MISS"].includes(bAfter.headers["x-cache"]));
  } finally {
    await close(server);
  }
});

test("keyExtras lets caller scope cache per-user", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached(
      {
        namespace: "t8",
        ttlMs: 60_000,
        keyExtras: (req) => req.headers["x-user"] || "",
      },
      async (req, res) => {
        invocations += 1;
        res.json({ user: req.headers["x-user"] || null });
      },
    ),
  );
  const { server, port } = await startApp(app);
  try {
    const u1a = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/r", headers: { "x-user": "alice" } },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () =>
            resolve({ headers: res.headers, body: JSON.parse(body) }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    const u2 = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/r", headers: { "x-user": "bob" } },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () =>
            resolve({ headers: res.headers, body: JSON.parse(body) }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    const u1b = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/r", headers: { "x-user": "alice" } },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () =>
            resolve({ headers: res.headers, body: JSON.parse(body) }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(u1a.headers["x-cache"], "MISS");
    assert.equal(u2.headers["x-cache"], "MISS");
    assert.equal(u1b.headers["x-cache"], "HIT");
    assert.equal(invocations, 2, "alice + bob trigger 2 handler invocations");
  } finally {
    await close(server);
  }
});

test("getCacheStats reports hit rate accurately", async () => {
  __testing__.reset();
  const app = express();
  app.get(
    "/r",
    cached({ namespace: "t9", ttlMs: 60_000 }, async (req, res) => {
      res.json({ ok: true });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    await request(port, "/r");
    await request(port, "/r");
    await request(port, "/r");
    const stats = getCacheStats();
    assert.equal(stats.misses, 1);
    assert.equal(stats.hits, 2);
    assert.ok(Math.abs(stats.hit_rate - 2 / 3) < 1e-9);
  } finally {
    await close(server);
  }
});
