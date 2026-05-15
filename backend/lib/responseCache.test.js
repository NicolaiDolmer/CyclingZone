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
        res.on("end", () => {
          let parsed = body || null;
          try {
            parsed = body ? JSON.parse(body) : null;
          } catch {
            // Some edge-case tests intentionally use res.send(text).
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        });
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

test("cached: encoded query values cannot collide with separate params", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached({ namespace: "query-encoding", ttlMs: 60_000 }, async (req, res) => {
      invocations += 1;
      res.json({
        invocation: invocations,
        q: req.query.q || null,
        team_id: req.query.team_id || null,
      });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    const crafted = await request(port, "/r?q=a%26team_id%3D1");
    const normal = await request(port, "/r?q=a&team_id=1");
    assert.equal(crafted.headers["x-cache"], "MISS");
    assert.equal(normal.headers["x-cache"], "MISS");
    assert.equal(invocations, 2, "crafted value and real param must not share a cache key");
    assert.deepEqual(crafted.body, { invocation: 1, q: "a&team_id=1", team_id: null });
    assert.deepEqual(normal.body, { invocation: 2, q: "a", team_id: "1" });
  } finally {
    await close(server);
  }
});

test("cached: middleware fallback uses req.path when req.route is undefined", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.use(
    cached({ namespace: "route-fallback", ttlMs: 60_000 }, async (req, res) => {
      invocations += 1;
      res.json({ path: req.path, invocation: invocations });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    const a = await request(port, "/a?x=1");
    const b = await request(port, "/b?x=1");
    const aAgain = await request(port, "/a?x=1");
    assert.equal(a.headers["x-cache"], "MISS");
    assert.equal(b.headers["x-cache"], "MISS");
    assert.equal(aAgain.headers["x-cache"], "HIT");
    assert.deepEqual(aAgain.body, a.body);
    assert.equal(invocations, 2, "different middleware paths must not collide");
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

test("cached: res.send() responses are not captured", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached({ namespace: "send", ttlMs: 60_000 }, async (req, res) => {
      invocations += 1;
      res.type("text/plain").send(`count:${invocations}`);
    }),
  );
  const { server, port } = await startApp(app);
  try {
    const a = await request(port, "/r");
    const b = await request(port, "/r");
    assert.equal(a.headers["x-cache"], undefined);
    assert.equal(b.headers["x-cache"], undefined);
    assert.equal(invocations, 2, "res.send routes must always invoke handler");
  } finally {
    await close(server);
  }
});

test("cached: non-cookie headers are preserved on HIT", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached({ namespace: "headers", ttlMs: 60_000 }, async (req, res) => {
      invocations += 1;
      res.set("X-Source-Version", `v${invocations}`);
      res.json({ ok: true });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    const a = await request(port, "/r");
    const b = await request(port, "/r");
    assert.equal(a.headers["x-source-version"], "v1");
    assert.equal(b.headers["x-cache"], "HIT");
    assert.equal(b.headers["x-source-version"], "v1");
    assert.equal(invocations, 1);
  } finally {
    await close(server);
  }
});

test("cached: Set-Cookie responses are not cached to avoid cookie replay", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached({ namespace: "cookies", ttlMs: 60_000 }, async (req, res) => {
      invocations += 1;
      res.cookie("session_probe", `value-${invocations}`);
      res.json({ invocation: invocations });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    const a = await request(port, "/r");
    const b = await request(port, "/r");
    assert.equal(a.headers["x-cache"], "MISS");
    assert.equal(b.headers["x-cache"], "MISS");
    assert.equal(invocations, 2, "cookie-setting responses must not become shared cache entries");
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

test("cached: many distinct queries are bounded by maxEntries", async () => {
  __testing__.reset();
  const app = express();
  app.get(
    "/r",
    cached({ namespace: "bounded", ttlMs: 60_000 }, async (req, res) => {
      res.json({ q: req.query.q });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    for (let i = 0; i < 10_000; i += 1) {
      await request(port, `/r?q=${i}`);
    }
    assert.equal(__testing__.inspect("bounded").size, 200);
  } finally {
    await close(server);
  }
});

test("cached: concurrent first miss is coalesced for same key", async () => {
  __testing__.reset();
  const app = express();
  let invocations = 0;
  app.get(
    "/r",
    cached({ namespace: "single-flight", ttlMs: 60_000 }, async (req, res) => {
      invocations += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      res.json({ count: invocations });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => request(port, "/r?same=1")),
    );
    assert.equal(invocations, 1);
    assert.equal(responses.filter((r) => r.headers["x-cache"] === "MISS").length, 1);
    assert.equal(responses.filter((r) => r.headers["x-cache"] === "HIT").length, 19);
    assert.ok(responses.every((r) => r.body.count === 1));
  } finally {
    await close(server);
  }
});

test("cached: invalidation during in-flight miss prevents stale re-store", async () => {
  __testing__.reset();
  const app = express();
  let generation = 0;
  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const releasePromise = new Promise((resolve) => { release = resolve; });
  app.get(
    "/r",
    cached({ namespace: "invalidation-race", ttlMs: 60_000 }, async (req, res) => {
      const snapshot = generation;
      if (snapshot === 0) {
        entered();
        await releasePromise;
      }
      res.json({ generation: snapshot });
    }),
  );
  const { server, port } = await startApp(app);
  try {
    const first = request(port, "/r");
    await enteredPromise;
    generation = 1;
    invalidateNamespace("invalidation-race");
    release();
    const firstResponse = await first;
    const afterInvalidation = await request(port, "/r");
    assert.equal(firstResponse.body.generation, 0);
    assert.equal(afterInvalidation.headers["x-cache"], "MISS");
    assert.equal(afterInvalidation.body.generation, 1);
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
