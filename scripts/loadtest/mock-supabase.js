/**
 * Mock Supabase (GoTrue + PostgREST) til lokal load-test af backenden (#1174).
 *
 * Emulerer KUN de endpoints backendens signup-bootstrap + presence-kæde rammer:
 *   GET  /auth/v1/user                  → token "lt-<n>" → deterministisk bruger
 *   GET  /rest/v1/teams?...             → user_id-lookup (.single), ilike-navnetjek,
 *                                          pulje-scan (pickDivisionForNewTeam, #1608)
 *   GET  /rest/v1/league_divisions?...  → div-4-puljer (bund-op-placering, #1608)
 *   POST /rest/v1/teams                 → insert + return=representation
 *   GET  /rest/v1/board_profiles?...    → lookup
 *   POST /rest/v1/board_profiles        → insert (return=minimal)
 *   PATCH/POST/GET alt andet            → generisk tomt svar (cron-ticks m.m.)
 *
 * Latens injiceres per kald via LT_LATENCY_MS (default 10 ms) for at simulere
 * Railway (europe-west4) ↔ Supabase (eu-central-1) netværks-RTT. Kør med
 * LT_LATENCY_MS=0 for at måle backendens rene CPU-ceiling.
 *
 * Brug:  node scripts/loadtest/mock-supabase.js   (port 54399, LT_MOCK_PORT overstyrer)
 *
 * INGEN secrets: serveren accepterer alle tokens og kører kun på loopback.
 */

import http from "node:http";

const PORT = Number(process.env.LT_MOCK_PORT || 54399);
const LATENCY_MS = Number(process.env.LT_LATENCY_MS ?? 10);

// ── In-memory datalag ────────────────────────────────────────────────────────
// Seed: 28 "rigtige" hold svarende til prod-bestanden 11/6 (20 i div 1, 8 i div 2)
// så pickDivisionForNewTeam-scanningen har realistisk startstørrelse.
const teams = [];
const boardProfiles = [];
let teamSeq = 0;

// #1608 form-frys: de 8 div-4-puljer (tier 4 = bunden) som migration
// 2026-06-21-league-divisions-pyramid.sql seeder. pickDivisionForNewTeam spreder nye
// managere på den mindst-fyldte af disse (bund-op-placering).
const leagueDivisions = Array.from({ length: 8 }, (_, index) => ({
  id: 8 + index,
  tier: 4,
  pool_index: index,
  label: `Division 4 — ${String.fromCharCode(65 + index)}`,
}));

function uuidFromSeq(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

for (let i = 0; i < 28; i++) {
  teamSeq += 1;
  teams.push({
    id: uuidFromSeq(teamSeq),
    user_id: `11111111-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name: `Seed Team ${i}`,
    manager_name: `Seed Manager ${i}`,
    division: i < 20 ? 1 : 2,
    league_division_id: null,
    balance: 800000,
    sponsor_income: 240000,
    is_ai: false,
    is_test_account: false,
    is_frozen: false,
    created_at: new Date().toISOString(),
  });
}

// ── Stats (læses af driveren via GET /__stats) ───────────────────────────────
const stats = { requests: 0, byPath: new Map() };

function userIdFromToken(token) {
  // Tokens har formen "lt-<n>" — deterministisk UUID pr. virtuel bruger.
  const m = /^lt-(\d+)$/.exec(token || "");
  if (!m) return null;
  return `22222222-0000-4000-8000-${String(m[1]).padStart(12, "0")}`;
}

function send(res, status, body, headers = {}) {
  const respond = () => {
    if (body === null) {
      res.writeHead(status, headers);
      res.end();
    } else {
      const json = JSON.stringify(body);
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(json);
    }
  };
  if (LATENCY_MS > 0) setTimeout(respond, LATENCY_MS);
  else respond();
}

function wantsSingleObject(req) {
  return (req.headers.accept || "").includes("vnd.pgrst.object+json");
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : null); } catch { resolve(null); }
    });
  });
}

const PGRST_NO_ROW = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
  details: "The result contains 0 rows",
  hint: null,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  stats.requests += 1;
  stats.byPath.set(path, (stats.byPath.get(path) || 0) + 1);

  // ── Driver-introspektion (ingen latens) ────────────────────────────────────
  if (path === "/__stats") {
    const byPath = Object.fromEntries(stats.byPath);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ requests: stats.requests, teams: teams.length, boardProfiles: boardProfiles.length, byPath }));
  }

  // ── GoTrue: GET /auth/v1/user ───────────────────────────────────────────────
  if (path === "/auth/v1/user" && req.method === "GET") {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const id = userIdFromToken(token);
    if (!id) return send(res, 401, { message: "invalid token" });
    return send(res, 200, {
      id,
      aud: "authenticated",
      role: "authenticated",
      email: `${token}@loadtest.invalid`,
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date().toISOString(),
    });
  }

  // ── PostgREST: /rest/v1/teams ───────────────────────────────────────────────
  if (path === "/rest/v1/teams") {
    if (req.method === "GET") {
      const userIdEq = url.searchParams.get("user_id");
      const nameIlike = url.searchParams.get("name");
      const select = url.searchParams.get("select") || "*";

      if (userIdEq?.startsWith("eq.")) {
        const uid = userIdEq.slice(3);
        const rows = teams.filter((t) => t.user_id === uid);
        if (wantsSingleObject(req)) {
          if (rows.length === 1) return send(res, 200, rows[0]);
          return send(res, 406, PGRST_NO_ROW);
        }
        return send(res, 200, rows);
      }

      const idEq = url.searchParams.get("id");
      if (idEq?.startsWith("eq.")) {
        const rows = teams.filter((t) => t.id === idEq.slice(3));
        if (wantsSingleObject(req)) {
          if (rows.length === 1) return send(res, 200, rows[0]);
          return send(res, 406, PGRST_NO_ROW);
        }
        return send(res, 200, rows);
      }

      if (nameIlike?.startsWith("ilike.")) {
        const needle = nameIlike.slice(6).toLowerCase();
        const rows = teams
          .filter((t) => t.name.toLowerCase() === needle)
          .map((t) => ({ id: t.id }));
        if (wantsSingleObject(req)) {
          if (rows.length === 1) return send(res, 200, rows[0]);
          return send(res, 406, PGRST_NO_ROW);
        }
        return send(res, 200, rows);
      }

      if (select.includes("league_division_id") || select.includes("division")) {
        // pickDivisionForNewTeam (#1608): alle ikke-AI/test/frosne hold — bruges til
        // pulje-fyldnings-tælling (league_division_id) / division-scan.
        const rows = teams
          .filter((t) => !t.is_ai && !t.is_test_account && !t.is_frozen)
          .map((t) => ({ division: t.division, league_division_id: t.league_division_id ?? null }));
        return send(res, 200, rows);
      }

      return send(res, 200, teams);
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      teamSeq += 1;
      const row = {
        id: uuidFromSeq(teamSeq),
        is_ai: false,
        is_test_account: false,
        is_frozen: false,
        created_at: new Date().toISOString(),
        ...body,
      };
      teams.push(row);
      if (wantsSingleObject(req)) return send(res, 201, row);
      return send(res, 201, [row]);
    }

    if (req.method === "PATCH") {
      const body = await readBody(req);
      const idEq = url.searchParams.get("id");
      if (idEq?.startsWith("eq.")) {
        const t = teams.find((x) => x.id === idEq.slice(3));
        if (t) Object.assign(t, body);
        if (wantsSingleObject(req)) return send(res, 200, t || PGRST_NO_ROW);
        return send(res, 200, t ? [t] : []);
      }
      return send(res, 204, null);
    }
  }

  // ── PostgREST: /rest/v1/board_profiles ──────────────────────────────────────
  if (path === "/rest/v1/board_profiles") {
    if (req.method === "GET") {
      const teamIdEq = url.searchParams.get("team_id");
      const rows = teamIdEq?.startsWith("eq.")
        ? boardProfiles.filter((b) => b.team_id === teamIdEq.slice(3))
        : boardProfiles;
      return send(res, 200, rows.map((b) => ({ id: b.id })));
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const row = { id: uuidFromSeq(900000 + boardProfiles.length + 1), ...body };
      boardProfiles.push(row);
      // insert uden .select() → Prefer: return=minimal → 201 tom body
      return send(res, 201, null);
    }
  }

  // ── PostgREST: /rest/v1/league_divisions (#1608 bund-op pulje-scan) ─────────
  if (path === "/rest/v1/league_divisions") {
    if (req.method === "GET") {
      const tierEq = url.searchParams.get("tier");
      const rows = tierEq?.startsWith("eq.")
        ? leagueDivisions.filter((p) => p.tier === Number(tierEq.slice(3)))
        : leagueDivisions;
      return send(res, 200, rows.map((p) => ({ id: p.id })));
    }
  }

  // ── PostgREST: RPC + alt andet (cron-ticks, presence-update m.m.) ───────────
  if (path.startsWith("/rest/v1/rpc/")) {
    return send(res, 200, []);
  }
  if (path.startsWith("/rest/v1/")) {
    if (req.method === "HEAD") {
      // count: "exact", head: true → PostgREST svarer med Content-Range
      const respond = () => {
        res.writeHead(200, { "Content-Range": "*/0" });
        res.end();
      };
      if (LATENCY_MS > 0) setTimeout(respond, LATENCY_MS);
      else respond();
      return;
    }
    if (req.method === "GET") {
      if (wantsSingleObject(req)) return send(res, 406, PGRST_NO_ROW);
      return send(res, 200, []);
    }
    if (req.method === "PATCH" || req.method === "DELETE") return send(res, 204, null);
    if (req.method === "POST") {
      await readBody(req);
      if (wantsSingleObject(req)) return send(res, 406, PGRST_NO_ROW);
      return send(res, 201, []);
    }
  }

  return send(res, 404, { message: `mock: unhandled ${req.method} ${path}` });
});

// Hæv backloggen så burst-tests ikke afvises af OS-køen.
server.listen(PORT, "127.0.0.1", 1024, () => {
  console.log(`[mock-supabase] lytter på http://127.0.0.1:${PORT} (latens ${LATENCY_MS} ms/kald)`);
});
