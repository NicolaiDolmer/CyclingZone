/**
 * Load-test-driver til #1174 — samtidige signup-bootstraps + aktiv-bruger-trafik
 * mod en LOKALT kørende backend (ALDRIG prod).
 *
 * Scenarier:
 *   signup : PUT /api/teams/my pr. ny virtuel bruger (Bearer lt-<n>) — hele
 *            backend-bootstrap-kæden (requireAuth → navnetjek → division-scan →
 *            team-insert → board-profil-insert). Svarer til trinnet efter
 *            supabase.auth.signUp() i LoginPage/SetupWizardModal.
 *   active : GET /api/teams/my + POST /api/presence for allerede oprettede
 *            brugere (read-path: requireAuth = 2 Supabase-kald pr. request).
 *
 * Brug:
 *   node scripts/loadtest/run-loadtest.js --base http://127.0.0.1:3101 \
 *        --levels 5,10,25,50,100 --per-level 200 --scenario both
 *
 * Output: måltabel pr. samtidighedsniveau (throughput, p50/p95/p99, fejlrate)
 * som markdown + JSON-resumé på stdout.
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"]);
    return acc;
  }, [])
);

const BASE = args.base || "http://127.0.0.1:3101";
const LEVELS = (args.levels || "5,10,25,50,100").split(",").map(Number);
const PER_LEVEL = Number(args["per-level"] || 200);
const SCENARIO = args.scenario || "both";

let nextUserId = 1; // global tæller — fortsætter på tværs af niveauer
const createdUsers = []; // ids med oprettet hold (bruges af active-scenariet)

function pct(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function timedFetch(url, options) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, options);
    await res.text(); // dræn body så keep-alive-socket genbruges
    return { ms: performance.now() - t0, status: res.status };
  } catch (err) {
    return { ms: performance.now() - t0, status: 0, error: String(err?.cause?.code || err.message) };
  }
}

async function signupOnce(userId) {
  return timedFetch(`${BASE}/api/teams/my`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer lt-${userId}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: `LT Team ${userId}`, manager_name: `LT Manager ${userId}` }),
  });
}

async function activeOnce(userId) {
  // OBS: GET /api/teams/my matches af /teams/:id-ruten (registreret først) og
  // er reelt død — vi bruger /api/me/onboarding-progress som dashboard-read.
  const a = await timedFetch(`${BASE}/api/me/onboarding-progress`, {
    headers: { Authorization: `Bearer lt-${userId}` },
  });
  const b = await timedFetch(`${BASE}/api/presence`, {
    method: "POST",
    headers: { Authorization: `Bearer lt-${userId}`, "Content-Type": "application/json" },
    body: "{}",
  });
  return [a, b];
}

async function runLevel({ scenario, concurrency, total }) {
  const results = [];
  let issued = 0;
  let activeCursor = 0;
  const t0 = performance.now();

  async function worker() {
    while (true) {
      const myIndex = issued++;
      if (myIndex >= total) return;
      if (scenario === "signup") {
        const userId = nextUserId++;
        const r = await signupOnce(userId);
        if (r.status === 201 || r.status === 200) createdUsers.push(userId);
        results.push(r);
      } else {
        // round-robin over oprettede brugere → holder pr-bruger-rate under
        // presencePulseLimiter (120/min) mens aggregatet presses op.
        const userId = createdUsers[activeCursor++ % createdUsers.length];
        const rs = await activeOnce(userId);
        results.push(...rs);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedS = (performance.now() - t0) / 1000;

  const ok = results.filter((r) => r.status >= 200 && r.status < 300);
  const rateLimited = results.filter((r) => r.status === 429);
  const failed = results.filter((r) => r.status === 0 || r.status >= 500);
  const other = results.length - ok.length - rateLimited.length - failed.length;
  const sorted = results.map((r) => r.ms).sort((a, b) => a - b);

  return {
    scenario,
    concurrency,
    requests: results.length,
    elapsedS: Number(elapsedS.toFixed(1)),
    rps: Number((results.length / elapsedS).toFixed(1)),
    p50: Number(pct(sorted, 50).toFixed(0)),
    p95: Number(pct(sorted, 95).toFixed(0)),
    p99: Number(pct(sorted, 99).toFixed(0)),
    max: Number(sorted[sorted.length - 1]?.toFixed(0) ?? NaN),
    ok: ok.length,
    rateLimited: rateLimited.length,
    failed: failed.length,
    other,
    errorRatePct: Number((((results.length - ok.length) / results.length) * 100).toFixed(2)),
    sampleErrors: [...new Set(results.filter((r) => r.error).map((r) => r.error))].slice(0, 3),
  };
}

function table(rows) {
  const header =
    "| Samtidighed | Requests | Varighed (s) | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | 2xx | 429 | Fejl | Fejlrate |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|";
  const body = rows
    .map(
      (r) =>
        `| ${r.concurrency} | ${r.requests} | ${r.elapsedS} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} | ${r.ok} | ${r.rateLimited} | ${r.failed} | ${r.errorRatePct}% |`
    )
    .join("\n");
  return `${header}\n${sep}\n${body}`;
}

async function main() {
  // Sanity: backend oppe?
  const health = await timedFetch(`${BASE}/health`, {});
  if (health.status !== 200) {
    console.error(`FEJL: backend svarer ikke på ${BASE}/health (status ${health.status} ${health.error || ""})`);
    process.exit(1);
  }

  const all = { signup: [], active: [] };

  if (SCENARIO === "signup" || SCENARIO === "both") {
    console.log(`\n== Scenario: signup-bootstrap (PUT /api/teams/my) — ${PER_LEVEL} signups pr. niveau ==`);
    for (const c of LEVELS) {
      const r = await runLevel({ scenario: "signup", concurrency: c, total: PER_LEVEL });
      all.signup.push(r);
      console.log(
        `  c=${String(c).padStart(3)}  ${r.rps} signups/s  p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms  fejlrate=${r.errorRatePct}% ${r.sampleErrors.length ? "fejl: " + r.sampleErrors.join(",") : ""}`
      );
    }
    console.log("\n" + table(all.signup));
  }

  if (SCENARIO === "active" || SCENARIO === "both") {
    if (createdUsers.length === 0) {
      // Stand-alone active-kørsel: bootstrap en pulje først
      console.log("\n(opretter 200 brugere som active-pulje …)");
      await runLevel({ scenario: "signup", concurrency: 20, total: 200 });
    }
    console.log(`\n== Scenario: aktive brugere (GET /api/me/onboarding-progress + POST /api/presence) — pulje=${createdUsers.length} brugere ==`);
    for (const c of LEVELS) {
      const r = await runLevel({ scenario: "active", concurrency: c, total: PER_LEVEL * 2 });
      all.active.push(r);
      console.log(
        `  c=${String(c).padStart(3)}  ${r.rps} req/s  p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms  fejlrate=${r.errorRatePct}% ${r.sampleErrors.length ? "fejl: " + r.sampleErrors.join(",") : ""}`
      );
    }
    console.log("\n" + table(all.active));
  }

  console.log("\nJSON-resumé:");
  console.log(JSON.stringify(all, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
