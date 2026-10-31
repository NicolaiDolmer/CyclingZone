import test from "node:test";
import assert from "node:assert/strict";

import {
  developRidersForSeason as developRidersForSeasonEngine,
  ageForSeason,
  LAUNCH_REFERENCE_YEAR,
  loadRetiringRiderIds,
  seasonStartRetirementInputs,
  willRetireAtSeasonStart,
} from "./riderProgressionEngine.js";
import {
  PROGRESSION_CONFIG, AGING_V2_DECLINING_ABILITIES, developRiderSeasonV2, buildCapsForRider,
} from "./riderProgression.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

// #6499: motoren henter belastningen for den afsluttede sæson, før den skriver.
// Testene injicerer en tom belastning (= ingen bremse), medmindre de selv tester
// belastningen eller loader-stien.
function developRidersForSeason(args) {
  const injectsLoad = "seasonLoadByRider" in args || "loadSeasonDevelopmentLoadFn" in args;
  return developRidersForSeasonEngine(injectsLoad ? args : { seasonLoadByRider: new Map(), ...args });
}

// ── Minimal in-memory Supabase-mock (kun det engine'n bruger) ──────────────────
function createMockSupabase(state) {
  function builder(table, op = "select", filters = [], patch = null) {
    const matches = (row) => filters.every(([c, v]) => row[c] === v);
    return {
      select() { return builder(table, "select", filters, patch); },
      eq(col, val) {
        const nf = [...filters, [col, val]];
        if (op === "update") {
          for (const row of state[table]) if (nf.every(([c, v]) => row[c] === v)) Object.assign(row, patch);
          return Promise.resolve({ error: null });
        }
        return builder(table, op, nf, patch);
      },
      order() { return builder(table, op, filters, patch); },
      update(p) { return builder(table, "update", filters, p); },
      range(from, to) {
        return Promise.resolve({ data: state[table].filter(matches).slice(from, to + 1), error: null });
      },
      single() {
        const row = state[table].filter(matches)[0] ?? null;
        return Promise.resolve({ data: row, error: null });
      },
      maybeSingle() {
        return Promise.resolve({ data: state[table].filter(matches)[0] ?? null, error: null });
      },
      upsert(rows, opts = {}) {
        const conflict = (opts.onConflict || "").split(",").map((s) => s.trim()).filter(Boolean);
        for (const r of (Array.isArray(rows) ? rows : [rows])) {
          const exists = conflict.length && state[table].some((x) => conflict.every((c) => x[c] === r[c]));
          if (exists && opts.ignoreDuplicates) continue;
          state[table].push({ ...r });
        }
        return Promise.resolve({ error: null });
      },
    };
  }
  // Letvægts-fake af apply_rider_development (#2361): emulerer RPC'ens
  // ON-CONFLICT-DO-NOTHING-adfærd — INSERT i rider_development_log (guard på
  // rider_id+season_id, samme UNIQUE som den ægte migration), og KUN hvis
  // rækken faktisk blev indsat, mutation af rider_derived_abilities + riders.
  // Allerede-logget (samme rider_id+season_id) → { data: false, error: null }
  // UDEN at røre evner/rytter — spejler RPC'ens atomicitets-garanti 1:1.
  function rpc(fnName, args) {
    if (fnName !== "apply_rider_development") {
      return Promise.resolve({ data: null, error: { message: `unmocked rpc: ${fnName}` } });
    }
    const { p_rider_id, p_season_id, p_season_number, p_ability_patch, p_rider_patch, p_log } = args;
    state.rider_development_log ??= [];
    const alreadyLogged = state.rider_development_log.some(
      (l) => l.rider_id === p_rider_id && l.season_id === p_season_id
    );
    if (alreadyLogged) return Promise.resolve({ data: false, error: null });

    state.rider_development_log.push({
      rider_id: p_rider_id, season_id: p_season_id, season_number: p_season_number,
      age: p_log?.age ?? null, abilities: p_log?.abilities ?? {}, base_value: p_log?.base_value ?? null,
      retired_this_season: !!p_log?.retired_this_season,
    });

    const abRow = (state.rider_derived_abilities ?? []).find((a) => a.rider_id === p_rider_id);
    if (abRow) for (const [k, v] of Object.entries(p_ability_patch ?? {})) if (v != null) abRow[k] = v;

    const riderRow = (state.riders ?? []).find((r) => r.id === p_rider_id);
    if (riderRow) for (const [k, v] of Object.entries(p_rider_patch ?? {})) if (v != null) riderRow[k] = v;

    return Promise.resolve({ data: true, error: null });
  }
  return { from: (table) => { state[table] ??= []; return builder(table); }, rpc };
}

const ABILITY_DEFAULTS = { climbing: 55, time_trial: 55, prolog: 50, flat: 55, tempo: 55, sprint: 55, acceleration: 55, punch: 55, endurance: 55, recovery: 55, durability: 55, descending: 55, cobblestone: 55, positioning: 55, aggression: 55 };

function seedState({ riders, abilities }) {
  return {
    riders: riders.map((r) => ({ ...r })),
    rider_derived_abilities: abilities.map((a) => ({ ...ABILITY_DEFAULTS, ...a })),
    rider_development_log: [],
    teams: [{ id: "team-1", user_id: "user-1" }],
  };
}


// #5842: sæsonskiftet må ikke flytte rytterværdier. Evner, alder og pension
// skrives; base_value og current_production_value står urørt til søndagskørslen.
test("#5842: sæson-transitionen skriver evner og is_u25, men aldrig base_value eller current_production_value", async () => {
  const rpcCalls = [];
  const state = seedState({
    riders: [
      { id: "r-young", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, current_production_value: 90000, is_u25: true, is_retired: false, team_id: null, firstname: "Ung", lastname: "Talent" },
      { id: "r-old", primary_type: "sprinter", potentiale: 5, birthdate: "1986-01-01", base_value: 50000, current_production_value: 40000, is_u25: false, is_retired: false, team_id: null, firstname: "Gammel", lastname: "Rytter" },
    ],
    abilities: [
      { rider_id: "r-young", climbing: 55, tempo: 55, endurance: 55, ability_caps: null },
      { rider_id: "r-old", sprint: 70, ability_caps: null },
    ],
  });
  const supabase = createMockSupabase(state);
  const spy = { from: supabase.from, rpc: (fn, args) => { rpcCalls.push(args); return supabase.rpc(fn, args); } };
  // Ingen app_config-tabel seedet: motoren må ikke engang slå en værdimodel op.
  const summary = await developRidersForSeason({ supabase: spy, seasonId: "s2", seasonNumber: 2, notify: false });

  assert.equal(summary.developed, 2);
  assert.equal(summary.retired, 1, "pensionen skrives stadig i skiftet");
  for (const call of rpcCalls) {
    assert.equal("base_value" in call.p_rider_patch, false, `${call.p_rider_id}: base_value i rider-patch`);
    assert.equal("current_production_value" in call.p_rider_patch, false, `${call.p_rider_id}: CPV i rider-patch`);
    assert.equal(call.p_log.base_value, null, "dev-loggen bærer ingen ny værdi");
    assert.equal(typeof call.p_rider_patch.is_u25, "boolean", "is_u25 skrives");
  }
  const young = state.riders.find((r) => r.id === "r-young");
  const old = state.riders.find((r) => r.id === "r-old");
  assert.ok(state.rider_derived_abilities.find((a) => a.rider_id === "r-old").sprint < 70, "evner ældes (#6499)");
  assert.equal(young.base_value, 100000, "base_value urørt");
  assert.equal(young.current_production_value, 90000, "CPV urørt");
  assert.equal(old.is_retired, true);
  assert.equal(old.base_value, 50000, "base_value urørt også ved pension");
  assert.equal(old.current_production_value, 40000, "CPV urørt også ved pension");
  assert.equal((state.app_config ?? []).length, 0);
});

test("ageForSeason er sæson-drevet (sæson 1 = launch-året)", () => {
  assert.equal(ageForSeason("2005-03-01", 1), LAUNCH_REFERENCE_YEAR - 2005); // 21
  assert.equal(ageForSeason("2005-03-01", 4), LAUNCH_REFERENCE_YEAR + 3 - 2005); // 24
  assert.equal(ageForSeason(null, 2), null);
});

test("#6499: ung høj-pot rytter vokser IKKE ved skiftet, men loftet initialiseres (værdien venter på søndag, #5842)", async () => {
  const state = seedState({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: null, firstname: "Ung", lastname: "Talent" }],
    abilities: [{ rider_id: "r1", climbing: 55, tempo: 55, endurance: 55, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  const summary = await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2 });

  assert.equal(summary.developed, 1);
  assert.equal(summary.grew, 0, "ingen sæsonvækst (#6499)");
  assert.equal(summary.caps_initialised, 1);
  const ab = state.rider_derived_abilities[0];
  assert.equal(ab.climbing, 55, "signatur-evnen står stille ved skiftet");
  assert.ok(ab.ability_caps && ab.ability_caps.climbing > 55, "loft sat fra baseline");
  assert.equal(state.riders[0].base_value, 100000, "base_value urørt i skiftet (#5842)");
  assert.equal(state.rider_development_log.length, 1, "snapshot skrevet til dev-log");
});

test("ability-history: season-transition skriver én season-snapshot pr. udviklet rytter (#2000)", async () => {
  const state = seedState({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: null, firstname: "Ung", lastname: "Talent" }],
    abilities: [{ rider_id: "r1", climbing: 55, tempo: 55, endurance: 55, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  await developRidersForSeason({
    supabase, seasonId: "s2", seasonNumber: 2,
    now: new Date("2026-06-12T10:00:00+02:00"),
  });

  const hist = state.rider_derived_ability_history ?? [];
  assert.equal(hist.length, 1, "én season-snapshot for den udviklede rytter");
  const row = hist[0];
  assert.equal(row.rider_id, "r1");
  assert.equal(row.source, "season_transition");
  assert.equal(row.snapshot_date, "2026-06-12");
  assert.equal(row.season_number, 2);
  assert.equal(row.abilities?.climbing, state.rider_derived_abilities[0].climbing, "snapshot = post-udviklings-vektor");
});

test("ability-history: idempotent — anden season-kørsel skriver ingen ny snapshot", async () => {
  const state = seedState({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: null, firstname: "A", lastname: "B" }],
    abilities: [{ rider_id: "r1", climbing: 55, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  const args = { supabase, seasonId: "s2", seasonNumber: 2, now: new Date("2026-06-12T10:00:00+02:00") };
  await developRidersForSeason(args);
  await developRidersForSeason(args); // 2. kørsel: alle allerede udviklet → ingen nye logRows
  assert.equal((state.rider_derived_ability_history ?? []).length, 1, "kun én snapshot trods to kørsler");
});

test("idempotent: anden kørsel skipper alle og muterer intet yderligere", async () => {
  const state = seedState({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: null, firstname: "A", lastname: "B" }],
    abilities: [{ rider_id: "r1", climbing: 55, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2 });
  const afterFirst = state.rider_derived_abilities[0].climbing;
  const bvFirst = state.riders[0].base_value;

  const summary2 = await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2 });
  assert.equal(summary2.developed, 0);
  assert.equal(summary2.skipped_already_done, 1);
  assert.equal(state.rider_derived_abilities[0].climbing, afterFirst, "abilities uændret ved re-run");
  assert.equal(state.riders[0].base_value, bvFirst, "base_value uændret ved re-run");
  assert.equal(state.rider_development_log.length, 1, "ingen dublet-snapshot");
});

test("garanteret retirement ved 40 + notifikation til ejer-hold", async () => {
  // født 1986 → ved sæson 2 (2027): alder 41 → garanteret retirement
  const notified = [];
  const state = seedState({
    riders: [{ id: "old", primary_type: "sprinter", potentiale: 5, birthdate: "1986-01-01", base_value: 50000, is_u25: false, is_retired: false, team_id: "team-1", firstname: "Gammel", lastname: "Rytter" }],
    abilities: [{ rider_id: "old", sprint: 70, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  const summary = await developRidersForSeason({
    supabase, seasonId: "s2", seasonNumber: 2,
    notifyTeamOwnerFn: async (args) => { notified.push(args); return { delivered: true }; },
  });

  assert.equal(summary.retired, 1);
  assert.equal(state.riders[0].is_retired, true);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].type, "rider_retired");
  assert.equal(notified[0].teamId, "team-1");
});

// ── #5073: pensionsvarslet er et LØFTE, ikke et rul der køres forfra ──────────
// Kontrakten hviler på ÉT led motoren ejer alene: `endingSeason = seasonNumber − 1`.
// Læste cutover frysningen for den NYE sæson i stedet for den afsluttede, ville
// hele suiten være grøn (retirementNotice.test.js tester kun den rene
// developRiderSeason) og fejlen først vise sig ved sæsonskiftet som en
// pensionering der modsiger banneret. Derfor to tests HER, gennem
// developRidersForSeason → apply_rider_development, ikke på den rene funktion.
//
// Rytteren: født 1990 ⇒ alder 38 i sæson 3 (det seedede vindue 36-39) og 39 ved
// cutover til sæson 4. `r-ret-1` er valgt fordi dagens rul siger JA
// (retirementDecision(38, "r-ret-1", 4).retire === true) — så et frosset "nej"
// kan kun vinde hvis kolonnen faktisk læses.
const NOTICE_RIDER = {
  id: "r-ret-1", primary_type: "sprinter", potentiale: 4, birthdate: "1990-01-01",
  base_value: 50000, is_u25: false, is_retired: false, team_id: null,
  firstname: "Frossen", lastname: "Varsel",
};

test("#5073: et frosset 'nej' for den AFSLUTTEDE sæson blokerer pensioneringen ved cutover", async () => {
  const state = seedState({
    riders: [{
      ...NOTICE_RIDER,
      // Frysningen står for sæson 3 = den sæson der slutter når sæson 4 starter.
      retirement_notice_season: 3,
      retirement_notice_after_season: null,   // NULL = intet varsel ⇒ "nej"
      retirement_notice_given_at: null,
    }],
    abilities: [{ rider_id: NOTICE_RIDER.id, sprint: 70, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  const summary = await developRidersForSeason({ supabase, seasonId: "s4", seasonNumber: 4 });

  assert.equal(summary.retirement_notice_read, 1, "cutover skal LÆSE frysningen");
  assert.equal(summary.retirement_notice_frozen, 0, "et allerede frosset svar må ikke skrives igen");
  assert.equal(summary.retired, 0, "rullet siger ja — frysningen siger nej, og frysningen vinder");
  assert.equal(state.riders[0].is_retired, false);
  assert.equal(state.riders[0].retirement_notice_season, 3, "markøren må ikke flyttes til den nye sæson");
});

test("#5073: uden frysning ruller cutover og skriver svaret ned for sæson N−1", async () => {
  const state = seedState({
    riders: [{ ...NOTICE_RIDER }],   // ingen varsel-kolonner sat
    abilities: [{ rider_id: NOTICE_RIDER.id, sprint: 70, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  const summary = await developRidersForSeason({ supabase, seasonId: "s4", seasonNumber: 4 });

  assert.equal(summary.retirement_notice_read, 0, "der var intet frosset svar at læse");
  assert.equal(summary.retirement_notice_frozen, 1, "motorens eget rul skal skrives ned");
  assert.equal(summary.retired, 1, "rullet for (38, r-ret-1, sæson 4) siger ja");
  // Off-by-one-guarden: frysningen hører til den AFSLUTTEDE sæson (3), aldrig
  // den nye (4) — ellers ville banneret for sæson 4 læse et svar der blev
  // afgjort for sæson 3 og sige det modsatte af rytterkortet.
  assert.equal(state.riders[0].retirement_notice_season, 3);
  assert.equal(state.riders[0].retirement_notice_after_season, 3, "han stopper EFTER sæson 3");
  assert.ok(state.riders[0].retirement_notice_given_at, "et ja skal bære en dato");
});

test("#5073: mangler varsel-kolonnerne, kører sæsonskiftet videre uden dem (ingen tavs nul-sæson)", async () => {
  // Er migrationen ikke applied når season-transition kører, fejler selectet.
  // Uden fallbacken kaster developRidersForSeason, economyEngine sluger fejlen,
  // og HELE sæsonen gennemføres uden rytterudvikling og uden en eneste
  // pensionering. Her skal den i stedet hente rytterne uden varsel-kolonnerne og
  // opføre sig præcis som før #5073: alt rulles, intet fryses.
  const state = seedState({
    riders: [{ ...NOTICE_RIDER }],
    abilities: [{ rider_id: NOTICE_RIDER.id, sprint: 70, ability_caps: null }],
  });
  const base = createMockSupabase(state);
  const missingColumn = {
    code: "42703",
    message: 'column riders.retirement_notice_season does not exist',
  };
  const supabase = {
    rpc: base.rpc,
    from(table) {
      const q = base.from(table);
      if (table !== "riders") return q;
      return {
        ...q,
        select(columns) {
          if (typeof columns === "string" && columns.includes("retirement_notice_season")) {
            const dead = { range: () => Promise.resolve({ data: null, error: missingColumn }) };
            dead.eq = () => dead;
            dead.order = () => dead;
            return dead;
          }
          return q.select(columns);
        },
      };
    },
  };

  const summary = await developRidersForSeason({ supabase, seasonId: "s4", seasonNumber: 4 });
  assert.equal(summary.developed, 1, "rytteren skal stadig udvikles");
  assert.equal(summary.retired, 1, "rullet afgør pensionen som før #5073");
  assert.equal(summary.retirement_notice_read, 0);
  assert.equal(summary.retirement_notice_frozen, 1, "patchen bygges stadig — RPC'ens kolonneliste ignorerer den bare");
});

// ── #4153: sæson-payrollen spørger motoren FØR den kører ──────────────────────
// loadRetiringRiderIds kaldes af processSeasonStart før payroll, så en rytter der
// pensioneres i skiftet ikke lønnes for den nye sæson. Paritetskravet: mængden
// den forudsiger, er PRÆCIS de holdryttere motoren derefter pensionerer — på
// tværs af alders-grænser, det seedede vindue, frosne varsler og de ryttere
// motoren springer over.
test("#4153: loadRetiringRiderIds forudsiger præcis de holdryttere motoren pensionerer", async () => {
  const seasonNumber = 4;
  const { windowStartAge, guaranteedAge } = PROGRESSION_CONFIG.retirement;
  const born = (endedSeasonAge) => `${LAUNCH_REFERENCE_YEAR + seasonNumber - 2 - endedSeasonAge}-01-01`;
  const base = { primary_type: "sprinter", potentiale: 4, base_value: 50000, is_u25: false, is_retired: false, team_id: "team-1", firstname: "A", lastname: "B" };
  const windowSpan = guaranteedAge - windowStartAge;
  const windowRiders = Array.from({ length: 16 }, (_, i) => ({
    ...base, id: `window-${i}`, birthdate: born(windowStartAge + (i % windowSpan)),
  }));
  const riders = [
    { ...base, id: "young", birthdate: born(windowStartAge - 8) },
    ...windowRiders,
    { ...base, id: "guaranteed", birthdate: born(guaranteedAge) },
    {
      ...base, id: "frozen-no", birthdate: born(guaranteedAge - 1),
      retirement_notice_season: seasonNumber - 1, retirement_notice_after_season: null, retirement_notice_given_at: null,
    },
    {
      ...base, id: "frozen-yes", birthdate: born(windowStartAge),
      retirement_notice_season: seasonNumber - 1, retirement_notice_after_season: seasonNumber - 1,
      retirement_notice_given_at: "2026-09-01T00:00:00.000Z",
    },
    { ...base, id: "no-abilities", birthdate: born(guaranteedAge) },
    { ...base, id: "no-type", primary_type: null, birthdate: born(guaranteedAge) },
    { ...base, id: "free-agent", team_id: null, birthdate: born(guaranteedAge) },
  ];
  const state = seedState({
    riders,
    abilities: riders.filter((r) => r.id !== "no-abilities").map((r) => ({ rider_id: r.id, sprint: 60, ability_caps: null })),
  });
  const supabase = createMockSupabase(state);

  // Samme rækkefølge som sæsonskiftet: opslag (payroll) FØR motoren.
  const predicted = await loadRetiringRiderIds({ supabase, seasonNumber });
  await developRidersForSeason({
    supabase, seasonId: "s4", seasonNumber, notify: false,
  });
  const retiredOnTeams = state.riders.filter((r) => r.is_retired && r.team_id != null).map((r) => r.id);

  assert.deepEqual([...predicted].sort(), retiredOnTeams.sort(), "forudsigelse og motor skal være enige, rytter for rytter");
  assert.ok(predicted.has("guaranteed"));
  assert.ok(predicted.has("frozen-yes"), "et frosset ja vinder over rullet");
  assert.ok(!predicted.has("frozen-no"), "et frosset nej vinder over rullet");
  assert.ok(!predicted.has("young"));
  assert.ok(!predicted.has("no-abilities"), "motoren springer ryttere uden evne-række over");
  assert.ok(!predicted.has("no-type"), "motoren springer ryttere uden type over");
  assert.ok(!predicted.has("free-agent"), "kun holdryttere er relevante for lønnen");
  const windowRetired = windowRiders.filter((r) => predicted.has(r.id)).length;
  assert.ok(windowRetired > 0 && windowRetired < windowRiders.length, "vinduet skal give begge udfald, ellers tester pariteten kun alders-grænserne");
});

test("#4153: willRetireAtSeasonStart følger motorens spring-over-regel", () => {
  const seasonNumber = 4;
  const { guaranteedAge } = PROGRESSION_CONFIG.retirement;
  const birthdate = `${LAUNCH_REFERENCE_YEAR + seasonNumber - 2 - guaranteedAge}-01-01`;
  assert.equal(willRetireAtSeasonStart({ id: "a", primary_type: "sprinter", potentiale: 3, birthdate }, seasonNumber), true);
  assert.equal(willRetireAtSeasonStart({ id: "b", primary_type: null, potentiale: 3, birthdate }, seasonNumber), false);
  assert.equal(willRetireAtSeasonStart({ id: "c", primary_type: "sprinter", potentiale: null, birthdate }, seasonNumber), false);
  assert.equal(willRetireAtSeasonStart({ id: "d", primary_type: "sprinter", potentiale: 3, birthdate: null }, seasonNumber), false);
  assert.equal(seasonStartRetirementInputs({ id: "e", primary_type: "sprinter", potentiale: 3, birthdate }, null), null);
});

test("is_u25 opdateres når rytter passerer 25 (board #813 ser aldringen)", async () => {
  // født 2003 → ved sæson 1 (2026) er 23 (u25), ved sæson 4 (2029) er 26 (ikke u25)
  const state = seedState({
    riders: [{ id: "r1", primary_type: "rouleur", potentiale: 3, birthdate: "2003-01-01", base_value: 50000, is_u25: true, is_retired: false, team_id: null, firstname: "X", lastname: "Y" }],
    abilities: [{ rider_id: "r1", flat: 60, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  await developRidersForSeason({ supabase, seasonId: "s4", seasonNumber: 4 });
  assert.equal(state.riders[0].is_u25, false, "rytter på 26 er ikke længere U25");
});

// UCI-reglen (ejer-beslutning 2/9-2026): sæson-alder ≤ 25, dvs. den 25-årige
// er STADIG U25 (tidligere konvention var < 25, hvor 25 allerede var falsk).
test("is_u25 - boundary 25 er STADIG U25 under UCI-reglen (ejer-beslutning 2/9)", async () => {
  // født 2004 → ved sæson 4 (2029) er 25 år (2029-2004=25).
  const state = seedState({
    riders: [{ id: "r1", primary_type: "rouleur", potentiale: 3, birthdate: "2004-01-01", base_value: 50000, is_u25: true, is_retired: false, team_id: null, firstname: "X", lastname: "Y" }],
    abilities: [{ rider_id: "r1", flat: 60, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  await developRidersForSeason({ supabase, seasonId: "s4", seasonNumber: 4 });
  assert.equal(state.riders[0].is_u25, true, "rytter på 25 er stadig U25 (UCI-reglen)");
});

test("pensionerede ryttere udvikles ikke (filtreret på is_retired)", async () => {
  const state = seedState({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: true, team_id: null, firstname: "Pen", lastname: "Sioneret" }],
    abilities: [{ rider_id: "r1", climbing: 55, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  const summary = await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2 });
  assert.equal(summary.developed, 0);
});

// ── #6499: ingen sæsonvækst for nogen holdtype (den gamle gren er væk) ────────
// Før #6499 voksede AI- og frie ryttere ved skiftet, managerryttere sprang væksten
// over når daglig træning var tændt (#1305), og træningsfokus (#1163) kunne biase
// væksten. Alt det er væk: ingen holdtype, ingen akademirytter og intet flag kan
// bringe den gamle vækst tilbage.

// Helpers til at bygge state med menneskelige og AI-holds
function seedStateWithTeams({ riders, abilities, teams }) {
  return {
    riders: riders.map((r) => ({ ...r })),
    rider_derived_abilities: abilities.map((a) => ({ ...ABILITY_DEFAULTS, ...a })),
    rider_development_log: [],
    teams: teams.map((t) => ({ ...t })),
    app_config: [],
  };
}

const ALL_TEAM_KINDS = [
  { id: "human-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
  { id: "ai-1", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false },
  { id: "bank-1", is_ai: false, is_bank: true, is_frozen: false, is_test_account: false },
  { id: "frozen-1", is_ai: false, is_bank: false, is_frozen: true, is_test_account: false },
  { id: "test-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: true },
];

test("#6499: unge ryttere vokser ikke ved skiftet på nogen holdtype (manager, AI, bank, frosset, test, fri, akademi)", async () => {
  const young = (id, team_id, extra = {}) => ({
    id, primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000,
    is_u25: true, is_retired: false, team_id, firstname: id, lastname: "X", ...extra,
  });
  const riders = [
    ...ALL_TEAM_KINDS.map((t) => young(`on-${t.id}`, t.id)),
    young("free", null),
    young("academy", "human-1", { is_academy: true }),
  ];
  const state = seedStateWithTeams({
    riders,
    abilities: riders.map((r) => ({ rider_id: r.id, climbing: 40, endurance: 40, ability_caps: null })),
    teams: ALL_TEAM_KINDS,
  });
  // Planer for den afsluttede sæson må ikke længere biase noget.
  state.training_plans = riders.map((r) => ({ team_id: r.team_id, rider_id: r.id, season_id: "s1", focus: "vo2max", intensity: "hard" }));
  const before = JSON.parse(JSON.stringify(state.rider_derived_abilities));
  const summary = await developRidersForSeason({ supabase: createMockSupabase(state), seasonId: "s2", seasonNumber: 2, trainingSeasonId: "s1" });

  assert.equal(summary.developed, riders.length);
  assert.equal(summary.grew, 0);
  assert.equal("trained" in summary, false, "træningsfokus-tælleren er væk sammen med grenen");
  assert.equal("growth_skipped" in summary, false, "anti-double-dip-tælleren er væk sammen med grenen");
  for (const [i, ab] of state.rider_derived_abilities.entries()) {
    for (const k of VISIBLE_ABILITIES) assert.equal(ab[k], before[i][k], `${ab.rider_id}.${k}`);
    assert.ok(ab.ability_caps, `${ab.rider_id}: lofterne skrives stadig`);
  }
});

test("#6499: managerrytter i faldalderen falder ved skiftet (tilbagegangen gælder alle)", async () => {
  // sæson 2 → alder = 2027 − 1993 = 34
  const state = seedStateWithTeams({
    riders: [{ id: "r1", primary_type: "sprinter", potentiale: 5, birthdate: "1993-01-01", base_value: 200000, is_u25: false, is_retired: false, team_id: "human-1", firstname: "Gml", lastname: "Rytter" }],
    abilities: [{ rider_id: "r1", sprint: 80, acceleration: 75, ability_caps: null }],
    teams: ALL_TEAM_KINDS,
  });
  const summary = await developRidersForSeason({ supabase: createMockSupabase(state), seasonId: "s2", seasonNumber: 2 });
  assert.equal(summary.declined, 1);
  assert.ok(state.rider_derived_abilities[0].sprint < 80, "evne falder for veteranen");
});

test("#6499: anden kørsel skipper allerede-udviklede og muterer intet", async () => {
  const state = seedStateWithTeams({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "1994-01-01", base_value: 100000, is_u25: false, is_retired: false, team_id: "human-1", firstname: "A", lastname: "B" }],
    abilities: [{ rider_id: "r1", climbing: 55, ability_caps: null }],
    teams: ALL_TEAM_KINDS,
  });
  const supabase = createMockSupabase(state);
  await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2 });

  const climbAfterFirst = state.rider_derived_abilities[0].climbing;
  assert.ok(climbAfterFirst < 55, "første kørsel ælder rytteren");
  const summary2 = await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2 });

  assert.equal(summary2.skipped_already_done, 1, "anden kørsel skipper");
  assert.equal(summary2.developed, 0);
  assert.equal(state.rider_derived_abilities[0].climbing, climbAfterFirst, "ability uændret ved re-run");
  assert.equal(state.rider_development_log.length, 1, "ingen dublet log-row");
});

// ── Re-run-sikkerhed efter delvis fejl (#2361) ──────────────────────────────────
// Beviser den atomiske pr.-rytter-RPC løser den præcise bug: dev-log-skrivning og
// evne/rytter-mutation kan IKKE længere komme ud af trit med hinanden. Simulerer
// et RPC-kald der fejler for én rytter (r2) midt i en batch af tre; assertér at
// r1+r3 er committet atomisk (log OG evner), r2 er urørt, og at en re-run udvikler
// r2 PRÆCIS én gang uden at r1/r3 genudvikles.
test("re-run-sikkerhed: RPC-fejl for én rytter → rytteren udvikles præcis 1× ved re-run, forudgående ryttere forbliver committet (#2361)", async () => {
  const state = seedState({
    riders: [
      { id: "r1", primary_type: "climber", potentiale: 5, birthdate: "1994-01-01", base_value: 100000, is_u25: false, is_retired: false, team_id: null, firstname: "A", lastname: "One" },
      { id: "r2", primary_type: "climber", potentiale: 5, birthdate: "1994-01-01", base_value: 100000, is_u25: false, is_retired: false, team_id: null, firstname: "B", lastname: "Two" },
      { id: "r3", primary_type: "climber", potentiale: 5, birthdate: "1994-01-01", base_value: 100000, is_u25: false, is_retired: false, team_id: null, firstname: "C", lastname: "Three" },
    ],
    abilities: [
      { rider_id: "r1", climbing: 55, tempo: 55, endurance: 55, ability_caps: null },
      { rider_id: "r2", climbing: 55, tempo: 55, endurance: 55, ability_caps: null },
      { rider_id: "r3", climbing: 55, tempo: 55, endurance: 55, ability_caps: null },
    ],
  });
  const supabase = createMockSupabase(state);

  // Wrapper: r2's FØRSTE RPC-kald fejler (simulerer fx en netværks-timeout midt i
  // batchen); alle andre kald (r1, r3, og r2 ved re-run) går til den ægte mock-rpc.
  let r2Failed = false;
  const flakySupabase = {
    from: supabase.from,
    rpc: (fn, args) => {
      if (args.p_rider_id === "r2" && !r2Failed) {
        r2Failed = true;
        return Promise.resolve({ data: null, error: { message: "simulated rpc failure for r2" } });
      }
      return supabase.rpc(fn, args);
    },
  };

  await assert.rejects(
    () => developRidersForSeason({ supabase: flakySupabase, seasonId: "s2", seasonNumber: 2 }),
    /simulated rpc failure/,
    "fejlende RPC-kald propagerer (season-transition må ikke sluge det)"
  );

  // r1 + r3 committet ATOMISK (log OG abilities OG riders sammen); r2 slet ikke rørt.
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r1").length, 1, "r1 logget");
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r3").length, 1, "r3 logget");
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r2").length, 0, "r2 IKKE logget ved fejl (atomicitet — ikke 'logget men ikke anvendt')");
  assert.equal(state.rider_derived_abilities.find((a) => a.rider_id === "r2").climbing, 55, "r2 abilities urørt efter fejl");
  assert.equal(state.riders.find((r) => r.id === "r2").base_value, 100000, "r2 base_value urørt efter fejl");

  const r1ClimbAfterRun1 = state.rider_derived_abilities.find((a) => a.rider_id === "r1").climbing;
  const r3ClimbAfterRun1 = state.rider_derived_abilities.find((a) => a.rider_id === "r3").climbing;
  assert.ok(r1ClimbAfterRun1 < 55, "r1 udviklet (ældet, #6499) i første kørsel");
  assert.ok(r3ClimbAfterRun1 < 55, "r3 udviklet (ældet, #6499) i første kørsel");

  // Re-run (nu uden injiceret fejl): r1+r3 skippes (alreadyDeveloped-filter), kun r2 udvikles.
  const summary2 = await developRidersForSeason({ supabase: flakySupabase, seasonId: "s2", seasonNumber: 2 });

  assert.equal(summary2.developed, 1, "kun r2 udvikles ved re-run");
  assert.equal(summary2.skipped_already_done, 2, "r1+r3 skippes ved re-run (allerede committet)");
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r2").length, 1, "r2 udviklet præcis 1× — ikke nul, ikke to gange");
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r1").length, 1, "r1 IKKE genudviklet ved re-run");
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r3").length, 1, "r3 IKKE genudviklet ved re-run");
  assert.equal(state.rider_derived_abilities.find((a) => a.rider_id === "r1").climbing, r1ClimbAfterRun1, "r1 abilities uændret ved re-run (allerede committede ryttere rører intet)");
  assert.equal(state.rider_derived_abilities.find((a) => a.rider_id === "r3").climbing, r3ClimbAfterRun1, "r3 abilities uændret ved re-run");
  assert.ok(state.rider_derived_abilities.find((a) => a.rider_id === "r2").climbing < 55, "r2 endelig korrekt udviklet efter re-run");
  assert.equal(state.riders.find((r) => r.id === "r2").base_value, 100000, "r2 base_value urørt efter re-run (#5842: søndagskørslen ejer værdien)");
});

// ══ #6499: Udvikling 2.0 del 1 — tilbagegang ved sæsonskiftet (eneste vej) ════

// Blandet bestand: ung AI, ung manager, ung fri, plateau-alder, veteran på hvert
// holdtype, en pensionist i vinduet. Fødselsår regnet mod sæson 5 (2030).
function mixedPopulation() {
  const rider = (id, birthYear, team_id, primary_type = "climber") => ({
    id, primary_type, secondary_type: "rouleur", potentiale: 4, birthdate: `${birthYear}-03-01`,
    base_value: 100000, is_u25: false, is_retired: false, team_id, firstname: id, lastname: "X",
  });
  const riders = [
    rider("young-ai", 2010, "ai-1"),
    rider("young-human", 2010, "human-1"),
    rider("young-free", 2010, null),
    rider("plateau-ai", 2000, "ai-1", "sprinter"),
    rider("vet-human", 1996, "human-1", "sprinter"),
    rider("vet-ai", 1996, "ai-1", "rouleur"),
    rider("vet-free", 1993, null, "gc"),
    rider("old-human", 1990, "human-1"),
  ];
  const abilities = riders.map((r, i) => ({
    rider_id: r.id, climbing: 50 + i, time_trial: 52, flat: 54, tempo: 56, sprint: 58, acceleration: 49,
    punch: 51, endurance: 53, recovery: 55, durability: 57, descending: 60, cobblestone: 61,
    positioning: 62, aggression: 63, tactics: 44, teamwork: 45, leadership: 46, ability_caps: null,
  }));
  return seedStateWithTeams({
    riders, abilities,
    teams: [
      { id: "ai-1", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "human-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
    ],
  });
}

function captureRun(state, args) {
  const calls = [];
  const supabase = createMockSupabase(state);
  // retirement_notice_given_at er væguret (noticeFreezePatch kaldes uden `now`),
  // så det normaliseres til "sat/ikke sat" før sammenligning.
  const snapshot = (a) => {
    const copy = JSON.parse(JSON.stringify(a));
    if (copy.p_rider_patch?.retirement_notice_given_at) copy.p_rider_patch.retirement_notice_given_at = "<set>";
    return copy;
  };
  const spy = { from: supabase.from, rpc: (fn, a) => { calls.push(snapshot(a)); return supabase.rpc(fn, a); } };
  return developRidersForSeason({ supabase: spy, seasonId: "s5", seasonNumber: 5, notify: false, now: new Date("2026-10-25T10:00:00Z"), ...args })
    .then((summary) => ({ summary, calls, state }));
}

// Bit-identitet med den rene regel: hver RPC-skrivning er præcis det,
// developRiderSeasonV2 + buildCapsForRider giver for rytteren, med D6-bremsen
// (hårde dage tæller kun for managerryttere). Er det sandt, er motoren en ren
// orkestrator om den nye regel, og der findes ingen anden vej igennem den.
test("#6499: hver skrivning er bit-identisk med developRiderSeasonV2 for rytteren (D6-bremse, lofter, pension, log)", async () => {
  const load = new Map([
    ["young-ai", { raceDays: 40, hardDays: 90 }],
    ["vet-human", { raceDays: 30, hardDays: 40 }],
    ["vet-ai", { raceDays: 20, hardDays: 200 }],
    ["vet-free", { raceDays: 5, hardDays: 0 }],
    ["old-human", { raceDays: 0, hardDays: 60 }],
  ]);
  const seed = mixedPopulation();
  const { summary, calls } = await captureRun(mixedPopulation(), { seasonLoadByRider: load });
  const humanTeams = new Set(seed.teams.filter((t) => !t.is_ai && !t.is_bank && !t.is_frozen && !t.is_test_account).map((t) => t.id));
  const seasonNumber = 5;

  assert.equal(calls.length, seed.riders.length);
  let expectedDeclined = 0;
  let expectedPoints = 0;
  for (const r of seed.riders) {
    const call = calls.find((c) => c.p_rider_id === r.id);
    const abRow = seed.rider_derived_abilities.find((a) => a.rider_id === r.id);
    const abilities = {};
    for (const k of VISIBLE_ABILITIES) if (abRow[k] != null) abilities[k] = Number(abRow[k]);
    const age = ageForSeason(r.birthdate, seasonNumber);
    const raw = load.get(r.id) ?? null;
    const riderLoad = raw && !humanTeams.has(r.team_id) ? { ...raw, hardDays: 0 } : raw;
    const expected = developRiderSeasonV2(
      { id: r.id, primary_type: r.primary_type, potentiale: r.potentiale, age, frozenRetirementNotice: null },
      abilities, seasonNumber, { load: riderLoad },
    );
    const caps = buildCapsForRider(abilities, { ...r, age }, r.primary_type, r.secondary_type);
    assert.deepEqual(call.p_ability_patch, { ...expected.next, ability_caps: caps }, `${r.id}: evne-patch`);
    assert.deepEqual(call.p_log, { age, abilities: expected.next, base_value: null, retired_this_season: expected.retirement.retire }, `${r.id}: dev-log`);
    assert.equal(call.p_rider_patch.is_u25, age <= 25, `${r.id}: is_u25`);
    assert.equal(call.p_rider_patch.is_retired === true, expected.retirement.retire, `${r.id}: pension`);
    if (expected.aging.totalDrop > 0) expectedDeclined++;
    expectedPoints += expected.aging.totalDrop;
  }
  assert.equal(summary.grew, 0);
  assert.equal(summary.declined, expectedDeclined);
  assert.equal(summary.aging_v2.ability_points_declined, expectedPoints);
  assert.equal(summary.aging_v2.riders_with_load, load.size);
  assert.ok(expectedPoints > 0, "testen skal ramme mindst én rytter der falder");
});

test("#6499: flaget kan ikke længere vælge den gamle gren — off/beta/on/ingen række giver identiske skrivninger", async () => {
  const runs = [];
  for (const value of [null, "off", "beta", "on"]) {
    const state = mixedPopulation();
    if (value) state.app_config.push({ key: "development_v2_aging_enabled", value });
    runs.push(await captureRun(state, {}));
  }
  for (const other of runs.slice(1)) {
    assert.deepEqual(other.calls, runs[0].calls, "RPC-kald");
    assert.deepEqual(other.summary, runs[0].summary, "summary");
    assert.deepEqual(other.state.rider_derived_abilities, runs[0].state.rider_derived_abilities);
  }
  const youngAi = runs[0].calls.find((c) => c.p_rider_id === "young-ai");
  assert.equal(youngAi.p_ability_patch.climbing, 50, "AI-rytteren vokser ikke, uanset flaget");
});

test("#6499: ingen vækst, plateau står stille, veteraner falder kun fysisk + brosten, bremset af egen belastning", async () => {
  const load = new Map([
    ["vet-ai", { raceDays: 120, hardDays: 0 }],      // fuld bremse
    ["vet-human", { raceDays: 30, hardDays: 40 }],   // delvis
  ]);
  const { summary, calls } = await captureRun(mixedPopulation(), { seasonLoadByRider: load });
  const before = new Map(mixedPopulation().rider_derived_abilities.map((a) => [a.rider_id, a]));
  const byId = new Map(calls.map((c) => [c.p_rider_id, c]));

  for (const id of ["young-ai", "young-human", "young-free", "plateau-ai", "vet-ai"]) {
    const patch = byId.get(id).p_ability_patch;
    for (const k of VISIBLE_ABILITIES) {
      assert.equal(patch[k], before.get(id)[k], `${id}.${k} må ikke flytte sig`);
    }
  }
  for (const id of ["vet-human", "vet-free", "old-human"]) {
    const patch = byId.get(id).p_ability_patch;
    let dropped = 0;
    for (const k of VISIBLE_ABILITIES) {
      const delta = before.get(id)[k] - patch[k];
      assert.ok(delta >= 0, `${id}.${k}: ingen vækst`);
      if (!AGING_V2_DECLINING_ABILITIES.includes(k)) assert.equal(delta, 0, `${id}.${k} er teknisk/mental`);
      dropped += delta;
    }
    assert.ok(dropped > 0, `${id} falder`);
  }
  // Delvis bremse falder mindre end samme alder uden belastning ville.
  assert.equal(summary.aging_v2.riders_with_load, 2);
  assert.ok(summary.aging_v2.ability_points_declined > 0);
  assert.equal("trained" in summary, false, "ingen træningsfokus-gren længere");
  // Lofter, is_u25 og pension skrives stadig.
  for (const c of calls) {
    assert.ok(c.p_ability_patch.ability_caps, `${c.p_rider_id}: lofterne skrives`);
    assert.equal(typeof c.p_rider_patch.is_u25, "boolean");
  }
});

test("#6499/D6: hårde træningsdage bremser kun managerryttere; AI bremses kun af egne løbsdage", async () => {
  const opts = {};
  const noLoad = await captureRun(mixedPopulation(), { ...opts, seasonLoadByRider: new Map() });
  const hardOnly = await captureRun(mixedPopulation(), {
    ...opts,
    seasonLoadByRider: new Map([["vet-ai", { raceDays: 0, hardDays: 240 }], ["vet-human", { raceDays: 0, hardDays: 240 }]]),
  });
  const patch = (run, id) => run.calls.find((c) => c.p_rider_id === id).p_ability_patch;
  const before = new Map(mixedPopulation().rider_derived_abilities.map((a) => [a.rider_id, a]));
  const drop = (run, id) => VISIBLE_ABILITIES.reduce((sum, k) => sum + (before.get(id)[k] - patch(run, id)[k]), 0);
  assert.ok(drop(noLoad, "vet-ai") > 0, "AI-veteranen falder uden belastning");
  assert.equal(drop(hardOnly, "vet-ai"), drop(noLoad, "vet-ai"), "hårde dage bremser ikke en AI-rytter");
  assert.equal(drop(hardOnly, "vet-human"), 0, "240 hårde dage = fuld bremse for en managerrytter");
});

test("#6499: uden injiceret belastning hentes den for den AFSLUTTEDE sæson", async () => {
  const seen = [];
  const { summary } = await captureRun(mixedPopulation(), {
    loadSeasonDevelopmentLoadFn: async (args) => { seen.push(args.seasonNumber); return { byRider: new Map() }; },
  });
  assert.deepEqual(seen, [4], "sæson 5 starter → sæson 4's belastning");
  assert.equal(summary.aging_v2.riders_with_load, 0);
});

test("#6499: sæson 1 har ingen afsluttet sæson — uden injiceret belastning kaster motoren før den skriver", async () => {
  const state = mixedPopulation();
  await assert.rejects(
    () => developRidersForSeasonEngine({ supabase: createMockSupabase(state), seasonId: "s1", seasonNumber: 1, notify: false }),
    /seasonNumber >= 2/,
  );
  assert.equal(state.rider_development_log.length, 0);
});

test("#6499: kan belastningen ikke læses, kaster skiftet FØR noget skrives (aldrig tavst fuldt fald)", async () => {
  const state = mixedPopulation();
  const calls = [];
  const supabase = createMockSupabase(state);
  const spy = { from: supabase.from, rpc: (fn, a) => { calls.push(a); return supabase.rpc(fn, a); } };
  await assert.rejects(() => developRidersForSeason({
    supabase: spy, seasonId: "s5", seasonNumber: 5, notify: false,
    loadSeasonDevelopmentLoadFn: async () => { throw new Error("timeout"); },
  }), /timeout/);
  assert.equal(calls.length, 0, "ingen rytter udviklet");
  assert.equal(state.rider_development_log.length, 0);
});
