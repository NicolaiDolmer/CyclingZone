// G6-kapacitetsharness (#4847, spec §7 G6) — hvad koster den samlede daglige sweep?
// ============================================================================
// GATEN (spec §7): "Sweep-varighed og skrivetryk pr. loebsdags-lukning: under
// cron-intervallet med margin, og med overlap-guard bevist i test."
//
// HVAD DEN MAALER. Hele produktionsstien i trainingDayCloseTrigger.js koert mod en
// INSTRUMENTERET Supabase-attrap: hver query og hver skrevet raekke taelles, og
// hvert DB-kald faar en konfigurerbar kunstig latenstid. Motoren (runTeamTrainingDay)
// erstattes af en attrap der taeller PRAECIS de writes den rigtige motor laver pr.
// hold (ability-updates, condition-upserts, to historik-upserts, run-row-update),
// saa skrivevolumen er den aegte, mens vi ikke behoever en database.
//
// HVORFOR IKKE MOD PROD. Sweepen SKRIVER. En maaling der koerer den mod prod ville
// traene hele bestanden. Prod-tallene (362 berettigede hold, ca. 18 ryttere pr. hold,
// ca. 6.540 rytter-writes/dag, 130-150 s for 308-318 raekker) er maalt 6/9 og staar
// i issue #4847; de er harnessens DEFAULTS, ikke et gaet.
//
// LATENSTIDEN ER DET AFGOERENDE TAL. Sweepen er I/O-bundet, ikke CPU-bundet:
// varigheden er (antal DB-kald) x (rundtur til Supabase). Default 12 ms pr. kald er
// den observerede stoerrelsesorden fra Railway til Supabase i samme region; koer med
// --latency for at se foelsomheden.
//
// Brug:
//   node backend/scripts/dev/trainingDayCloseCapacity4847.mjs
//   node backend/scripts/dev/trainingDayCloseCapacity4847.mjs --race-days 5 --teams 362 --latency 12
//   node backend/scripts/dev/trainingDayCloseCapacity4847.mjs --concurrency 4
//
// Ren maaling: ingen DB, ingen netvaerk, ingen skrivning nogen steder.

import { runTrainingDayCloseSweep, __resetTrainingDayCloseStateForTests } from "../../lib/trainingDayCloseTrigger.js";

// ── Argumenter ───────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const TEAMS = arg("teams", 362);            // maalt 6/9: berettigede hold
const RIDERS_PER_TEAM = arg("riders", 18);  // 6.540 rytter-writes / 362 hold ≈ 18
const RACE_DAYS = arg("race-days", 5);      // ejer 15/9: 5 loebsdage pr. kalenderdag
const DIVISIONS = arg("divisions", 4);
const LATENCY_MS = arg("latency", 12);      // kunstig rundtur pr. DB-kald
const CONCURRENCY = arg("concurrency", 1);  // motorens hold-parallelitet i attrappen
const CRON_INTERVAL_MS = 5 * 60 * 1000;

// Batch-stoerrelser SOM DE STAAR i produktionskoden — dokumenteret, ikke gættet.
const BATCH = {
  abilityUpdateConcurrency: 25,  // dailyTrainingEngine.js: runBatched(abilityUpdates, 25, ...)
  conditionUpsertRows: 500,      // dailyTrainingEngine.js: slice(i, i + 500)
  historyUpsertRows: 500,        // begge historik-tabeller
};

// ── Instrumenteret attrap ────────────────────────────────────────────────────
const counters = { queries: 0, rowsWritten: 0, writeCalls: 0, byTable: {} };

// VIRTUEL TID som default. Sweepen er I/O-bundet, saa varigheden ER summen af
// latenstiderne; at soeve dem AEGTE ville tage praecis lige saa lang tid som den
// sweep vi maaler (ca. 2-3 minutter) uden at gøre tallet mere sandt — tvaertimod
// tilfoejer setTimeout sin egen jitter. `--real` soever rigtigt for den der vil
// se wall-clock-tallet bekraefte den virtuelle sum.
const REAL_SLEEP = process.argv.includes("--real");
let simulatedMs = 0;
const sleep = (ms) => {
  if (ms <= 0) return Promise.resolve();
  simulatedMs += ms;
  return REAL_SLEEP ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
};

function bump(table, rows = 0, isWrite = false) {
  counters.queries += 1;
  if (isWrite) {
    counters.writeCalls += 1;
    counters.rowsWritten += rows;
  }
  counters.byTable[table] = (counters.byTable[table] ?? 0) + 1;
}

const NOW = new Date("2026-09-15T18:30:00Z"); // 20:30 dansk tid — i vindue
const SEASON = { id: "season-4", number: 4 };

function buildFixture() {
  const races = [];
  const stages = [];
  const teams = [];
  for (let d = 0; d < DIVISIONS; d += 1) {
    const divisionId = `div-${d}`;
    const raceId = `race-${d}`;
    races.push({ id: raceId, league_division_id: divisionId, stages_completed: RACE_DAYS, finalize_state: null });
    for (let g = 0; g < RACE_DAYS; g += 1) {
      stages.push({
        race_id: raceId,
        stage_number: g + 1,
        // Hver division har sin EGEN akse fra loebsdag 0 (CALENDAR_RULES §0b). Det er
        // ogsaa det der holder maalingen aerlig efter #4846: prior-opslaget nedenfor er
        // tomt (saesonens foerste loebsdato), saa spaendet starter paa loebsdag 0 og er
        // dermed praecis dagens RACE_DAYS loebsdage, som foer.
        game_day: g,
        scheduled_at: new Date(NOW.getTime() - (RACE_DAYS - g) * 3600 * 1000).toISOString(),
      });
    }
  }
  for (let t = 0; t < TEAMS; t += 1) {
    teams.push({ id: `team-${t}`, league_division_id: `div-${t % DIVISIONS}` });
  }
  return { races, stages, teams };
}

function makeSupabase({ races, stages, teams }) {
  const flags = {
    training_tick_per_race_day: true,
    daily_training_enabled: true,
    race_day_engine_enabled: false,
  };
  return {
    from(table) {
      const ctx = { key: null, legacy: false, gte: false, order: null, limit: null };
      const chain = {
        select() { return this; },
        in() { return this; },
        // #4847 regel 4: sweepen laver TO race_stage_schedule-opslag pr. koersel.
        // Dagens etaper filtreres med .gte(dayStart).lt(dayEnd); "sidste loebsdag
        // FOER i dag" med .lt(dayStart) + order desc + limit 1. Uden at skelne dem
        // ville prior-opslaget faa dagens egne raekker tilbage, spaendet blive
        // forkert, og hele G6-maalingen (tick-antal, skrevne raekker, varighed)
        // maale noget andet end den aegte sweep.
        gte() { ctx.gte = true; return this; },
        lt() { return this; },
        order(col, o = {}) { ctx.order = { col, ascending: o.ascending !== false }; return this; },
        limit(n) { ctx.limit = n; return this; },
        range() { return this; },
        is() { ctx.legacy = true; return this; },
        eq(col, val) { if (col === "key") ctx.key = val; return this; },
        async maybeSingle() { return this.__resolve(); },
        async __resolve() {
          bump(table);
          await sleep(LATENCY_MS);
          if (table === "app_config") return { data: { value: flags[ctx.key] ?? false }, error: null };
          if (table === "seasons") return { data: SEASON, error: null };
          if (table === "races") return { data: races, error: null };
          if (table === "race_stage_schedule") {
            if (ctx.gte) return { data: stages, error: null };
            // Prior-opslaget. Harnessens fixture lader alle etaper ligge INDE i
            // dagens doegn, saa der findes ingen tidligere loebsdag — et tomt svar,
            // altsaa saesonens foerste loebsdato (#4846): spaendet starter paa
            // loebsdag 0, og aksen starter ogsaa dér, saa spaendet er dagens egne
            // loebsdage. (Sidste-dato-opslaget, .gte uden .lt, rammer grenen ovenfor
            // og faar dagens etaper: "der kommer mere", ingen forlaengelse.)
            // Sorteringen/limit spejles alligevel, saa mock'en ikke lyver om formen.
            let rows = [];
            if (ctx.order) {
              rows = [...rows].sort((a, b) => (ctx.order.ascending
                ? Number(a[ctx.order.col]) - Number(b[ctx.order.col])
                : Number(b[ctx.order.col]) - Number(a[ctx.order.col])));
            }
            return { data: Number.isFinite(ctx.limit) ? rows.slice(0, ctx.limit) : rows, error: null };
          }
          if (table === "teams") return { data: teams, error: null };
          if (table === "training_day_runs") return { data: [], error: null };
          return { data: [], error: null };
        },
        then(resolve, reject) { return this.__resolve().then(resolve, reject); },
      };
      return chain;
    },
  };
}

// Attrap for runTeamTrainingDay: taeller PRAECIS de DB-kald og raekker den aegte
// motor laver for ÉT hold paa ÉN loebsdag (dailyTrainingEngine.js, fase 1 + 2).
async function fakeRunTeamTrainingDay() {
  const riders = RIDERS_PER_TEAM;

  // Fase 1 — loads: flag (1) + riders (1) + 2 flag-opslag + 4 parallelle loads +
  // staff-context (1). Ni kald pr. hold pr. loebsdag i den aegte motor.
  // #4847: 9 -> 11. Bindings-opslaget (race_entry_days) er nyt, og
  // race_results-lookuppet koeres nu ogsaa naar UDVIKLINGEN er slukket, saa
  // "koerte" kan skelnes fra "hviledag" paa loebsdags-aksen.
  const loadCalls = 11;
  for (let i = 0; i < loadCalls; i += 1) bump("engine_load");
  await sleep(LATENCY_MS); // loadsene er i al vaesentlighed parallelle (Promise.all)

  // Fase 2 — writes.
  // a) ability-updates: ÉT update-kald pr. rytter, batched 25 ad gangen.
  const abilityBatches = Math.ceil(riders / BATCH.abilityUpdateConcurrency);
  // #4847: ÉT bump PR. RYTTER, ikke ét for hele batchen. runBatched koerer 25
  // SAMTIDIGE update-kald — de er parallelle i tid (derfor abilityBatches i
  // sleep'en nedenfor), men de er 18 fysiske kald mod databasen. Taellingen sagde
  // tidligere 1, saa "DB-kald i alt" undervurderede den faktiske belastning med
  // 17 kald pr. tick. Varigheden er uaendret; det er maalepunktet der var forkert.
  for (let i = 0; i < riders; i += 1) {
    bump("rider_derived_abilities", i === 0 ? riders : 0, true);
  }
  await sleep(LATENCY_MS * abilityBatches);

  // b) + c) to historik-upserts (kalenderdag + loebsdag), 500 raekker pr. kald.
  for (const table of ["rider_derived_ability_history", "rider_ability_race_day_history"]) {
    const batches = Math.max(1, Math.ceil(riders / BATCH.historyUpsertRows));
    bump(table, riders, true);
    await sleep(LATENCY_MS * batches);
  }

  // d) condition-upsert, 500 raekker pr. kald.
  bump("rider_condition", riders, true);
  await sleep(LATENCY_MS * Math.max(1, Math.ceil(riders / BATCH.conditionUpsertRows)));

  // e) reservation (INSERT) + rapport (UPDATE) paa training_day_runs.
  bump("training_day_runs", 1, true);
  bump("training_day_runs", 1, true);
  await sleep(LATENCY_MS * 2);

  return { alreadyRan: false };
}

// ── Koersel ──────────────────────────────────────────────────────────────────
async function main() {
  __resetTrainingDayCloseStateForTests();
  const fixture = buildFixture();
  const supabase = makeSupabase(fixture);

  const started = Date.now();
  const result = await runTrainingDayCloseSweep({
    supabase,
    now: NOW,
    runDay: fakeRunTeamTrainingDay,
    logger: { error() {} },
  });
  const realWall = Date.now() - started;
  // Sekventiel varighed = summen af I/O-latenstiderne (+ det CPU-arbejde der
  // faktisk blev udfoert). Med --real er de to naesten ens; uden er `realWall`
  // ren CPU-tid, og `simulatedMs` er svaret.
  const wall = REAL_SLEEP ? realWall : simulatedMs + realWall;

  // Sekventiel default (TEAM_CONCURRENCY = 1) er den maalte; en parallel koersel
  // udledes lineaert, fordi hvert holds arbejde er uafhaengigt og I/O-bundet.
  const projected = CONCURRENCY > 1 ? Math.round(wall / CONCURRENCY) : wall;

  const lines = [
    "─".repeat(78),
    "G6 — kapacitet for den samlede daglige traenings-sweep (#4847)",
    "─".repeat(78),
    `Input:    ${TEAMS} hold x ${RACE_DAYS} loebsdage x ${RIDERS_PER_TEAM} ryttere, ${DIVISIONS} divisioner`,
    `Latens:   ${LATENCY_MS} ms pr. DB-kald (konfigurerbar med --latency)`,
    "",
    `Planlagte ticks:        ${result.planned}`,
    `Koerte ticks:           ${result.swept}`,
    `Loebsdage i dag:        ${result.gameDays?.length ?? 0}`,
    `DB-kald i alt:          ${counters.queries}`,
    `Skrive-kald:            ${counters.writeCalls}`,
    `Rytter-raekker skrevet: ${counters.rowsWritten.toLocaleString("da-DK")}`,
    "",
    `Varighed (sekventiel):  ${(wall / 1000).toFixed(1)} s${REAL_SLEEP ? " (maalt wall-clock)" : " (I/O-sum + maalt CPU)"}`,
    `  heraf CPU:            ${(realWall / 1000).toFixed(2)} s`,
    CONCURRENCY > 1 ? `Varighed (x${CONCURRENCY} parallelt, udledt): ${(projected / 1000).toFixed(1)} s` : null,
    `Cron-interval:          ${(CRON_INTERVAL_MS / 1000).toFixed(0)} s`,
    `Margin:                 ${((1 - projected / CRON_INTERVAL_MS) * 100).toFixed(1)} %`,
    "",
    "Batch-stoerrelser (som de staar i dailyTrainingEngine.js):",
    `  ability-updates:      ${BATCH.abilityUpdateConcurrency} samtidige`,
    `  condition-upsert:     ${BATCH.conditionUpsertRows} raekker pr. kald`,
    `  historik-upsert:      ${BATCH.historyUpsertRows} raekker pr. kald (x2 tabeller)`,
    "",
    projected < CRON_INTERVAL_MS
      ? `GATE G6: GROEN — sweepen er faerdig ${((CRON_INTERVAL_MS - projected) / 1000).toFixed(0)} s foer naeste cron-tick.`
      : "GATE G6: ROED — sweepen loeber ud over cron-intervallet. Overlap-guarden forhindrer dobbelt-koersel, men dagen bliver forsinket.",
    "NB: overlap-guarden er bevist separat i backend/lib/trainingDayCloseTrigger.test.js.",
    "─".repeat(78),
  ].filter(Boolean);
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
