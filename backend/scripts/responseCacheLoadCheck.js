import http from "node:http";
import express from "express";
import { cached, __testing__ } from "../lib/responseCache.js";

const CONCURRENCY = 100;
const ROUNDS = 5;
const MOCK_DB_DELAY_MS = 40;

function percentile(values, pct) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index];
}

function startApp({ cacheEnabled }) {
  const app = express();
  let dbCalls = 0;
  const payload = {
    riders: Array.from({ length: 50 }, (_, i) => ({
      id: `r${i}`,
      firstname: `Rider${i}`,
      lastname: "Load",
      uci_points: 1000 - i,
      price: 100_000 + i,
      salary: 10_000 + i,
      is_u25: i % 3 === 0,
      nationality_code: "DK",
      popularity: 50,
      stat_fl: 70,
      stat_bj: 70,
      stat_kb: 70,
      stat_bk: 70,
      stat_tt: 70,
      stat_prl: 70,
      stat_bro: 70,
      stat_sp: 70,
      stat_acc: 70,
      stat_ned: 70,
      stat_udh: 70,
      stat_mod: 70,
      stat_res: 70,
      stat_ftr: 70,
      team: { id: "t1", name: "Load Team" },
    })),
    total: 50,
    page: 1,
    limit: 50,
  };

  async function handler(req, res) {
    dbCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, MOCK_DB_DELAY_MS));
    res.json(payload);
  }

  app.get(
    "/api/riders",
    cacheEnabled
      ? cached({ namespace: "riders-load", ttlMs: 60_000 }, handler)
      : handler,
  );
  app.get("/stats", (req, res) => res.json({ dbCalls }));

  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function get(port, path = "/api/riders?q=load&page=1&limit=50") {
  const startedAt = process.hrtime.bigint();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      res.resume();
      res.on("end", () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        resolve({ durationMs, status: res.statusCode });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function runScenario({ name, cacheEnabled }) {
  __testing__.reset();
  const { server, port } = await startApp({ cacheEnabled });
  try {
    if (cacheEnabled) {
      await get(port);
    }

    const latencies = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const responses = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => get(port)),
      );
      for (const response of responses) {
        if (response.status !== 200) throw new Error(`${name} returned ${response.status}`);
        latencies.push(response.durationMs);
      }
    }

    const statsResponse = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/stats", method: "GET" }, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => resolve(JSON.parse(raw)));
      });
      req.on("error", reject);
      req.end();
    });

    return {
      name,
      requests: latencies.length,
      p50_ms: Number(percentile(latencies, 50).toFixed(1)),
      p95_ms: Number(percentile(latencies, 95).toFixed(1)),
      db_calls: statsResponse.dbCalls - (cacheEnabled ? 1 : 0),
    };
  } finally {
    await close(server);
  }
}

const withoutCache = await runScenario({ name: "disabled", cacheEnabled: false });
const withCache = await runScenario({ name: "enabled_warm", cacheEnabled: true });
const reduction = 1 - withCache.db_calls / withoutCache.db_calls;

console.table([
  withoutCache,
  {
    ...withCache,
    supabase_call_reduction_pct: Number((reduction * 100).toFixed(1)),
  },
]);
