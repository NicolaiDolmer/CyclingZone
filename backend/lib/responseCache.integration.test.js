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

function request(port, path, { method = "GET", body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : undefined,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: raw ? JSON.parse(raw) : null,
          }),
        );
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("response cache integration: riders hits, auction finalize invalidates, stats align", async () => {
  __testing__.reset();
  const breadcrumbs = [];
  __testing__.setTimingSink((data) => breadcrumbs.push(data));

  const mockSupabase = {
    riderReads: 0,
    generation: 1,
    async listRiders() {
      this.riderReads += 1;
      return {
        riders: [{ id: "r1", firstname: "Ada", generation: this.generation }],
        total: 1,
        page: 1,
        limit: 50,
      };
    },
    async finalizeAuction() {
      this.generation += 1;
      return { ok: true };
    },
  };

  const app = express();
  app.use(express.json());
  app.get(
    "/api/riders",
    cached({ namespace: "riders", ttlMs: 60_000 }, async (req, res) => {
      res.json(await mockSupabase.listRiders());
    }),
  );
  app.post("/api/auctions/:id/finalize", async (req, res) => {
    const result = await mockSupabase.finalizeAuction(req.params.id);
    invalidateNamespace("riders");
    res.json({ success: true, result });
  });
  app.get("/api/admin/cache-stats", async (req, res) => {
    res.json(getCacheStats());
  });

  const { server, port } = await startApp(app);
  try {
    const firstFive = [];
    for (let i = 0; i < 5; i += 1) {
      firstFive.push(await request(port, "/api/riders"));
    }
    assert.equal(mockSupabase.riderReads, 1);
    assert.equal(firstFive[0].headers["x-cache"], "MISS");
    assert.deepEqual(firstFive.slice(1).map((r) => r.headers["x-cache"]), ["HIT", "HIT", "HIT", "HIT"]);
    assert.deepEqual(
      breadcrumbs.filter((b) => b.namespace === "riders").map((b) => b.hit),
      [false, true, true, true, true],
    );

    const finalize = await request(port, "/api/auctions/a1/finalize", { method: "POST" });
    assert.equal(finalize.status, 200);

    const afterFinalize = await request(port, "/api/riders");
    assert.equal(afterFinalize.headers["x-cache"], "MISS");
    assert.equal(afterFinalize.body.riders[0].generation, 2);
    assert.equal(mockSupabase.riderReads, 2);

    const stats = await request(port, "/api/admin/cache-stats");
    assert.equal(stats.body.hits, 4);
    assert.equal(stats.body.misses, 2);
    assert.equal(stats.body.invalidations, 1);
    assert.equal(stats.body.namespaces.find((n) => n.name === "riders").size, 1);
  } finally {
    await close(server);
  }
});
