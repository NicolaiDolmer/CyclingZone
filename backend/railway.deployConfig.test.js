import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── #4150: forward-guard for backend/railway.json ─────────────────────────────
//
// To ting kan gå galt i den fil, og begge er tavse i CI indtil de rammer prod:
//
//  1. En for bred watch-pattern-exclude. Så deployer en ÆGTE backend-ændring
//     ikke, og ingen opdager det før en fejl bliver ved med at være der efter
//     et "merget" fix. Det er værre end problemet vi løser.
//  2. Et nedlukningsvindue i koden (SHUTDOWN_TIMEOUT_MS i server.js) der er
//     længere end Railways drainingSeconds. Så bliver processen SIGKILL'et
//     midt i ventetiden, og den høflige nedlukning er ren kosmetik — præcis
//     tilstanden før #4150 (drainingSeconds havde default 0 mod 30s i koden).
//
// Testen læser railway.json som data og server.js som rå tekst (server.js kan
// ikke importeres — den binder porten og starter cron ved import; samme
// begrundelse som det rå streng-match i cron.monitorCoverage.test.js).

const backendRoot = dirname(fileURLToPath(import.meta.url));
const railwayConfig = JSON.parse(readFileSync(join(backendRoot, "railway.json"), "utf8"));
const serverSource = readFileSync(join(backendRoot, "server.js"), "utf8");

// Stier der BEVISELIGT ikke kan påvirke backend-runtime. Railways root
// directory er /backend, så intet herunder er overhovedet med i build-konteksten
// — de står her fordi de er de mapper der reelt committes efter hver session.
// Tilføj kun en sti her hvis du kan pege på at intet i backend/ læser den ved
// runtime. Er du i tvivl: lad være. En manglende deploy er dyrere end en
// overflødig.
const APPROVED_EXCLUDES = new Set([
  "!/docs/**",
  "!/pr-screens/**",
  "!/superpowers/**",
  "!/.claude/**",
  "!/*.md",
]);

// Stier der ALTID skal udløse et deploy. Repræsentanter for backend-runtime
// plus de delte lag et deploy afhænger af.
const MUST_DEPLOY = [
  "backend/server.js",
  "backend/cron.js",
  "backend/lib/raceEngine.js",
  "backend/routes/api.js",
  "backend/package.json",
  "backend/package-lock.json",
  "backend/railway.json",
  "database/2026-08-30-noget.sql",
  "package.json",
  "frontend/src/App.jsx",
];

// Stier der IKKE skal udløse et deploy (de tre docs-commits fra 23/8 og de
// fire fra 30/8 er alle af denne form).
const MUST_NOT_DEPLOY = [
  "docs/NOW.md",
  "docs/design/PAGE_TEMPLATES.md",
  "docs/snapshots/4131/moved-2026-08-23.json",
  ".claude/learnings/2026-08-30-noget.md",
  "pr-screens/2181-sidebar-desktop.png",
  "superpowers/plans/noget.md",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
];

/**
 * Fokuseret gitignore-matcher for de mønster-FORMER vi tillader i railway.json.
 * Den er bevidst snæver: møder den en form den ikke kender, kaster den. Det er
 * selve vagten — et nyt mønster kan ikke snige sig ind uden at et menneske har
 * udvidet både denne matcher og APPROVED_EXCLUDES.
 */
function patternMatches(pattern, path) {
  const body = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  if (body === "**") return true;
  if (body.startsWith("/") && body.endsWith("/**")) {
    const dir = body.slice(1, -3);
    return path === dir || path.startsWith(`${dir}/`);
  }
  if (body === "/*.md") return !path.includes("/") && path.endsWith(".md");
  throw new Error(
    `Ukendt watch-pattern-form: ${pattern}. Udvid patternMatches() + APPROVED_EXCLUDES bevidst, eller lad være.`
  );
}

/** Sidste matchende regel vinder (gitignore-semantik). */
function triggersDeploy(patterns, path) {
  let matched = false;
  for (const pattern of patterns) {
    if (!patternMatches(pattern, path)) continue;
    matched = !pattern.startsWith("!");
  }
  return matched;
}

test("watchPatterns starter med ** — ellers virker negationerne ikke", () => {
  const patterns = railwayConfig.build?.watchPatterns;
  assert.ok(Array.isArray(patterns), "build.watchPatterns mangler i backend/railway.json");
  // Railways egen dokumentation: "negations will only work if you include files
  // in a preceding rule". Uden ** som første regel matcher INTET, og så
  // deployer backenden aldrig igen.
  assert.equal(patterns[0], "**");
});

test("hver exclude er en godkendt, runtime-irrelevant sti", () => {
  for (const pattern of railwayConfig.build.watchPatterns.slice(1)) {
    assert.ok(pattern.startsWith("!"), `Kun negationer må følge efter **: ${pattern}`);
    assert.ok(
      APPROVED_EXCLUDES.has(pattern),
      `${pattern} er ikke på APPROVED_EXCLUDES. Bevis at intet i backend/ læser stien ved runtime før du udvider listen.`
    );
  }
});

test("ægte ændringer udløser stadig deploy", () => {
  const patterns = railwayConfig.build.watchPatterns;
  for (const path of MUST_DEPLOY) {
    assert.equal(triggersDeploy(patterns, path), true, `${path} skal udløse deploy`);
  }
});

test("rene docs-ændringer udløser ikke deploy", () => {
  const patterns = railwayConfig.build.watchPatterns;
  for (const path of MUST_NOT_DEPLOY) {
    assert.equal(triggersDeploy(patterns, path), false, `${path} må ikke udløse deploy`);
  }
});

test("Railways drain-vindue er længere end koden venter", () => {
  const drainingSeconds = railwayConfig.deploy?.drainingSeconds;
  assert.equal(typeof drainingSeconds, "number", "deploy.drainingSeconds mangler i backend/railway.json");

  const match = serverSource.match(/const SHUTDOWN_TIMEOUT_MS = ([\d_]+);/);
  assert.ok(match, "kunne ikke læse SHUTDOWN_TIMEOUT_MS ud af server.js");
  const shutdownSeconds = Number(match[1].replaceAll("_", "")) / 1000;

  // Streng ulighed: processens eget process.exit(0) skal nå at køre FØR
  // Railways SIGKILL, ellers når "[shutdown] alle cron-ticks afsluttet" aldrig
  // i deploy-loggen — og så er ventetiden i server.js uden effekt.
  assert.ok(
    drainingSeconds > shutdownSeconds,
    `drainingSeconds (${drainingSeconds}s) skal være større end SHUTDOWN_TIMEOUT_MS (${shutdownSeconds}s)`
  );
});

test("nedlukningsvinduet dækker en hel etape-afvikling", () => {
  // Et løb tager 90-110s at afslutte (#4150). Venter vi kortere, kan et deploy
  // stadig lande midt i en afvikling — det var hele pointen med issuet.
  const match = serverSource.match(/const SHUTDOWN_TIMEOUT_MS = ([\d_]+);/);
  const shutdownSeconds = Number(match[1].replaceAll("_", "")) / 1000;
  assert.ok(shutdownSeconds >= 110, `SHUTDOWN_TIMEOUT_MS er ${shutdownSeconds}s, skal dække et løb på op til 110s`);
});

test("gracefulShutdown stopper nye cron-ticks før den venter", () => {
  // Rækkefølgen er load-bearing: venter vi FØR vi stopper planlægningen, når
  // den gamle proces at fyre nye ticks i hele drain-vinduet, parallelt med den
  // nye proces. Se kommentaren ved stopCronScheduling() i cron.js.
  const stopIndex = serverSource.indexOf("stopCronScheduling()");
  const awaitIndex = serverSource.indexOf("await awaitCronsIdle(");
  assert.ok(stopIndex > 0, "server.js kalder ikke stopCronScheduling()");
  assert.ok(awaitIndex > 0, "server.js kalder ikke awaitCronsIdle()");
  assert.ok(stopIndex < awaitIndex, "stopCronScheduling() skal kaldes FØR awaitCronsIdle()");
});
