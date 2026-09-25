// backend/lib/seasonCalendarGate.test.js
// #5405 (ejer-beslutning 19/9): S4 må genereres tidligt og regenereres frit indtil sæsonen
// er aktiv, derefter låst. Testene dækker BEGGE gates i seasonCalendarGate.js:
//
//   evaluateSeasonCalendarWriteGate     — må der overhovedet skrives til denne sæson?
//   evaluateCalendarReplacementGate     — må sæsonens eksisterende løb erstattes rent?
//
// gatePlan (samme fil) testes i scripts/buildSeasonCalendar.test.js, hvor fixturerne bor.
// Undtagelse: §1d-reglen i gatePlan (#5658) testes nederst i denne fil.
//
// Refs #5405 #5658.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateSeasonCalendarWriteGate,
  evaluateCalendarReplacementGate,
  RACE_DEPENDENCY_TABLES,
  CALENDAR_WRITABLE_SEASON_STATUS,
  CALENDAR_LOCKED_SEASON_STATUSES,
  dependencyKey,
  gatePlan,
  detectPlanRaceDayViolations,
} from "./seasonCalendarGate.js";
import { SEASON_RACE_DAY_TARGET } from "./calendarRaceDayTargets.js";

// ── evaluateSeasonCalendarWriteGate ─────────────────────────────────────────

test("skrive-gate: 'upcoming' TILLADES — ejerens 19/9-regel, fri regenerering indtil aktivering", () => {
  const g = evaluateSeasonCalendarWriteGate({ seasonRow: { status: "upcoming" } });
  assert.equal(g.allowed, true);
  assert.equal(g.code, "upcoming");
  assert.equal(g.status, "upcoming");
});

test("skrive-gate: 'active' NÆGTES — kalenderen er låst fra aktivering", () => {
  const g = evaluateSeasonCalendarWriteGate({ seasonRow: { status: "active" } });
  assert.equal(g.allowed, false);
  assert.equal(g.code, "season_active");
});

test("skrive-gate: 'completed' NÆGTES — en afsluttet sæsons kalender er historik", () => {
  const g = evaluateSeasonCalendarWriteGate({ seasonRow: { status: "completed" } });
  assert.equal(g.allowed, false);
  assert.equal(g.code, "season_completed");
});

test("skrive-gate: sæsonen findes ikke → NÆGTES (fail-closed, ikke 'nok en ny sæson')", () => {
  const g = evaluateSeasonCalendarWriteGate({ seasonRow: null });
  assert.equal(g.allowed, false);
  assert.equal(g.code, "season_missing");
  assert.equal(g.status, null);
});

test("skrive-gate: helt uden argumenter → NÆGTES (defaulten er ikke 'ja')", () => {
  const g = evaluateSeasonCalendarWriteGate();
  assert.equal(g.allowed, false);
  assert.equal(g.code, "season_missing");
});

for (const status of [null, undefined, "", "   ", "paused", "archived", "UPCOMING_SOON", 4, {}]) {
  test(`skrive-gate: ukendt status ${JSON.stringify(status)} NÆGTES fail-closed`, () => {
    const g = evaluateSeasonCalendarWriteGate({ seasonRow: { status } });
    assert.equal(g.allowed, false, `status ${JSON.stringify(status)} burde ikke være tilladt`);
    assert.equal(g.code, "status_unknown");
  });
}

test("skrive-gate: status normaliseres (whitespace + versalers) — ' Upcoming ' er 'upcoming'", () => {
  // En manuel SQL-rettelse eller en import kan efterlade whitespace. Normaliseringen må
  // ikke gøre gaten løsere end reglen: KUN upcoming slipper igennem, uanset skrivemåde.
  const g = evaluateSeasonCalendarWriteGate({ seasonRow: { status: " Upcoming " } });
  assert.equal(g.allowed, true);
  const locked = evaluateSeasonCalendarWriteGate({ seasonRow: { status: "ACTIVE" } });
  assert.equal(locked.allowed, false);
  assert.equal(locked.code, "season_active");
});

test("skrive-gate: PRÆCIS én status er skrivbar, og de låste er kendte", () => {
  assert.equal(CALENDAR_WRITABLE_SEASON_STATUS, "upcoming");
  assert.deepEqual([...CALENDAR_LOCKED_SEASON_STATUSES], ["active", "completed"]);
  for (const s of CALENDAR_LOCKED_SEASON_STATUSES) {
    assert.equal(evaluateSeasonCalendarWriteGate({ seasonRow: { status: s } }).allowed, false);
  }
});

// ── evaluateCalendarReplacementGate ─────────────────────────────────────────

/** Alle FK-tællinger på 0 — udgangspunktet for en `upcoming` sæson uden gameplay. */
function zeroCounts(overrides = {}) {
  const counts = {};
  for (const d of RACE_DEPENDENCY_TABLES) counts[dependencyKey(d)] = 0;
  return { ...counts, ...overrides };
}

test("erstatnings-gate: 0 eksisterende løb → 'fresh' (der er intet at erstatte)", () => {
  const g = evaluateCalendarReplacementGate({ existingRaceCount: 0, dependentCounts: zeroCounts() });
  assert.equal(g.mode, "fresh");
  assert.deepEqual(g.blocking, []);
});

test("erstatnings-gate: løb findes, 0 gameplay-rækker → 'replace' (ren erstatning)", () => {
  const g = evaluateCalendarReplacementGate({
    existingRaceCount: 430,
    // Kalender-formen ER ikke-nul — det er præcis dét der udskiftes, og den må ikke gate.
    dependentCounts: zeroCounts({
      "race_stage_schedule.race_id": 1138,
      "race_stage_profiles.race_id": 1138,
      "teams.my_result_seen_race_id": 12,
    }),
  });
  assert.equal(g.mode, "replace");
  assert.deepEqual(g.blocking, []);
});

test("erstatnings-gate: holdudtagelser (race_entries) NÆGTER erstatningen", () => {
  const g = evaluateCalendarReplacementGate({
    existingRaceCount: 430, dependentCounts: zeroCounts({ "race_entries.race_id": 7 }),
  });
  assert.equal(g.mode, "denied");
  assert.equal(g.blocking.length, 1);
  assert.match(g.blocking[0], /race_entries\.race_id: 7/);
});

test("erstatnings-gate: resultater, præmier og notifikationer nægter hver for sig", () => {
  for (const key of ["race_results.race_id", "finance_transactions.race_id", "race_notify_outbox.race_id"]) {
    const g = evaluateCalendarReplacementGate({
      existingRaceCount: 10, dependentCounts: zeroCounts({ [key]: 1 }),
    });
    assert.equal(g.mode, "denied", `${key} burde nægte`);
    assert.match(g.blocking.join(" "), new RegExp(key.replace(".", "\\.")));
  }
});

test("erstatnings-gate: FLERE gameplay-fund rapporteres ALLE, ikke bare det første", () => {
  const g = evaluateCalendarReplacementGate({
    existingRaceCount: 10,
    dependentCounts: zeroCounts({ "race_entries.race_id": 3, "race_results.race_id": 5, "rider_peak_plans.target_race_id": 1 }),
  });
  assert.equal(g.mode, "denied");
  assert.equal(g.blocking.length, 3);
});

test("erstatnings-gate: en MANGLENDE tælling er ikke nul — den nægter fail-closed", () => {
  const counts = zeroCounts();
  delete counts["race_entries.race_id"];
  const g = evaluateCalendarReplacementGate({ existingRaceCount: 10, dependentCounts: counts });
  assert.equal(g.mode, "denied");
  assert.match(g.blocking.join(" "), /race_entries\.race_id: kunne ikke måles/);
});

test("erstatnings-gate: et UMÅLELIGT antal løb nægter — også når alle FK-tællinger er 0", () => {
  // `undefined` er IKKE med: det betyder "ikke oplyst" og rammer default 0 (= 'fresh',
  // testen nedenfor). Alt andet ikke-endeligt er en MISLYKKET måling og skal nægte.
  for (const bad of [null, NaN, -1, "430"]) {
    const g = evaluateCalendarReplacementGate({ existingRaceCount: bad, dependentCounts: zeroCounts() });
    assert.equal(g.mode, "denied", `existingRaceCount ${String(bad)} burde nægte`);
  }
});

test("erstatnings-gate: helt uden argumenter → 'fresh' (0 løb), ikke en sletning", () => {
  assert.equal(evaluateCalendarReplacementGate().mode, "fresh");
});

test("erstatnings-gate: UI-seen-state og kalender-form gater ALDRIG, uanset hvor mange", () => {
  const g = evaluateCalendarReplacementGate({
    existingRaceCount: 1,
    dependentCounts: zeroCounts({
      "teams.my_result_seen_race_id": 9999,
      "race_stage_schedule.race_id": 9999,
      "race_stage_profiles.race_id": 9999,
    }),
  });
  assert.equal(g.mode, "replace");
});

// ── Forward-guard: katalogen må ikke blive forældet ─────────────────────────

test("FK-katalogen dækker HVER FK→races i database/schema-snapshot.json (#5405 forward-guard)", () => {
  // Rod-årsagen til at #3546's wipe-script var ufuldstændigt var ikke at nogen skrev listen
  // forkert — det var at intet fangede at skemaet flyttede sig bagefter (CALENDAR_RULES §12).
  // Denne test er dén vagt: en ny tabel med en FK til races skal placeres i en gruppe, ellers
  // fejler den her FØR nogen sletter noget i prod.
  const snapshot = JSON.parse(
    readFileSync(new URL("../../database/schema-snapshot.json", import.meta.url), "utf8"),
  );
  const known = new Set(RACE_DEPENDENCY_TABLES.map(dependencyKey));
  const missing = Object.entries(snapshot.foreignKeys)
    .filter(([, target]) => target === "races")
    .map(([key]) => key)
    .filter((key) => !known.has(key));

  assert.deepEqual(
    missing, [],
    `FK→races uden plads i RACE_DEPENDENCY_TABLES: ${missing.join(", ")}. ` +
    "Placér hver i 'calendar' (er kalenderen), 'gameplay' (stopper en erstatning) eller 'ui' (nulles).",
  );
});

test("FK-katalogen er intern konsistent: unikke nøgler, kendte grupper, mindst én pr. gruppe", () => {
  const keys = RACE_DEPENDENCY_TABLES.map(dependencyKey);
  assert.equal(new Set(keys).size, keys.length, "dublet i RACE_DEPENDENCY_TABLES");
  const groups = new Set(RACE_DEPENDENCY_TABLES.map((d) => d.group));
  assert.deepEqual([...groups].sort(), ["calendar", "gameplay", "ui"]);
  assert.ok(Object.isFrozen(RACE_DEPENDENCY_TABLES), "katalogen skal være frossen");
});

test("FK-katalogen har race_notify_outbox med, selvom snapshotten er ældre end #3624", () => {
  // Dens FK er ON DELETE CASCADE: uden denne linje ville en erstatning slette ventende
  // udgående beskeder TAVST. Snapshotten (10/9) er ældre end tabellen (18/9), så
  // forward-guarden ovenfor ville ikke selv have fanget den.
  const row = RACE_DEPENDENCY_TABLES.find((d) => d.table === "race_notify_outbox");
  assert.ok(row, "race_notify_outbox mangler i RACE_DEPENDENCY_TABLES");
  assert.equal(row.group, "gameplay");
});

// ── #5658 · gatePlan dømmer §1d: samme antal løbsdage i alle divisioner ─────────────
//
// Ejerens låste regel (TRAINING_RULES.md §13.3 beslutning 2, CALENDAR_RULES.md §1d): alle
// divisioner har lige mange løbsdage, og i sæson 4 er tallet sæsonens mål. Før #5658
// dømte kun CLI'ens scorecard reglen; auto-stien (seasonTransition.js) gik uden om den.
//
// Fixturerne er syntetiske summary-linjer i materializerens form. De bærer kun det gaten
// læser for §1d; `compositionStats.raceDays > 0` holder tier-løkkens "tom kalender"-brud ude.
// Resten af compositionStats er tom, så kompositions-reglerne kan køre uden at kaste; de brud
// de giver, filtreres fra via præfikset "løbsdage pr. division".

const S4_TARGET = SEASON_RACE_DAY_TARGET[4];
const line = (tier, raceDayAxisLength, raceDayTarget = S4_TARGET) => ({
  tier, raceDayAxisLength, raceDayTarget,
  compositionStats: { raceDays: 1, counts: {}, pct: {}, unknown: {} },
  calendarViolations: [],
});
const raceDayBlocking = (blocking) => blocking.filter((b) => b.startsWith("løbsdage pr. division"));

test("#5658 fixture: division 4 har en kortere akse end de andre → gaten er RØD", () => {
  const summary = { tiers: [line(1, S4_TARGET), line(2, S4_TARGET), line(3, S4_TARGET), line(4, S4_TARGET - 42)] };
  const { blocking, raceDayViolations } = gatePlan(summary);
  assert.ok(raceDayViolations.some((v) => v.includes("IKKE ens")), `ulighed skal stå som brud: ${raceDayViolations.join(" · ")}`);
  assert.ok(raceDayViolations.some((v) => v.startsWith("tier 4:")), "division 4's afstand til målet skal stå som brud");
  assert.ok(!raceDayViolations.some((v) => /^tier [123]:/.test(v)), "divisionerne der rammer målet må ikke dømmes");
  assert.equal(raceDayBlocking(blocking).length, raceDayViolations.length, "alle §1d-brud skal blokere på auto-stien");
});

test("#5658 fixture: alle fire divisioner på sæsonens mål → §1d er grøn", () => {
  const summary = { tiers: [1, 2, 3, 4].map((t) => line(t, S4_TARGET)) };
  const { blocking, raceDayViolations } = gatePlan(summary);
  assert.deepEqual(raceDayViolations, []);
  assert.deepEqual(raceDayBlocking(blocking), []);
});

test("#5658 fixture: lige lange akser der IKKE rammer målet er også rødt", () => {
  const summary = { tiers: [1, 2, 3, 4].map((t) => line(t, S4_TARGET - 1)) };
  const { raceDayViolations } = gatePlan(summary);
  assert.equal(raceDayViolations.length, 4, "hver division er én løbsdag fra målet");
  assert.ok(raceDayViolations.every((v) => /^tier \d: /.test(v)));
});

test("#5658 uden mål dømmes §1d ikke (S3-kalendere er ikke ulovlige bagud; samme afgrænsning som scorecardet)", () => {
  const summary = { tiers: [line(1, 60, null), line(4, 40, null)] };
  const { blocking, raceDayViolations } = gatePlan(summary);
  assert.deepEqual(raceDayViolations, []);
  assert.deepEqual(raceDayBlocking(blocking), []);
});

test("#5658 fail-closed: en tier med løb men uden målt akse kan ikke bevise målet", () => {
  const summary = { tiers: [line(1, S4_TARGET), line(4, null)] };
  const { violations } = detectPlanRaceDayViolations(summary);
  assert.ok(violations.some((v) => v.startsWith("tier 4:") && v.includes("ikke målt")), violations.join(" · "));
});

test("#5658 fail-closed: divisioner pakket mod forskellige mål er et brud", () => {
  const summary = { tiers: [line(1, S4_TARGET), line(4, S4_TARGET - 5, S4_TARGET - 5)] };
  const { violations } = detectPlanRaceDayViolations(summary);
  assert.ok(violations.some((v) => v.includes("forskellige")), violations.join(" · "));
});

test("#5658 raceDayEqualityBlocking:false (CLI'en) — bruddene rapporteres, men lægges ikke i blocking", () => {
  // buildSeasonCalendar.js gater samme regel via scorecardets placerings-gate, så dry-runnet
  // kan måle videre og bruddet ikke står to gange.
  const summary = { tiers: [line(1, S4_TARGET), line(4, S4_TARGET - 42)] };
  const { blocking, raceDayViolations } = gatePlan(summary, { raceDayEqualityBlocking: false });
  assert.ok(raceDayViolations.length > 0);
  assert.deepEqual(raceDayBlocking(blocking), []);
});
