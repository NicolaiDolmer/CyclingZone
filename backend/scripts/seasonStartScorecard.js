#!/usr/bin/env node
// backend/scripts/seasonStartScorecard.js
//
// Simulér-før-ship-harness for de to sæsonskifte-beslutninger (#2910 + #2911).
// 100 % READ-ONLY mod prod — kun SELECT. Ingen insert/update/delete/rpc.
//
// Sektion A (#2910, træthed):
//   Bruger de ÆGTE felter og de ÆGTE parcours fra den sidste løbsdag i sæsonen
//   (race_entries + race_stage_profiles) og kører den ÆGTE raceSimulator.simulateStage
//   for hver option. Fordi fatigue IKKE forbruger rng, er støj/udbrud/dagsform
//   bit-identiske på tværs af optionerne — forskellen i resultatet ER trætheden.
//   Måler: hvor mange top-3-pladser der skifter i forhold til et felt uden
//   resttræthed (= "hvor meget af uge 1 afgøres af resttræthed").
//
// Sektion B (#2911, akademi):
//   Fremskriver akademiets bestand S2→S6 fra den ÆGTE aldersfordeling og den ÆGTE
//   underskrivningsrate, under forskellige optagelsesregler (antal, alderskriterium,
//   potentiale-fordeling).
//
// Determinisme: alle tilfældige træk er seedede (--seed). To kørsler med samme
// seed mod samme data giver identiske tal.
//
// Usage:
//   cd backend && node scripts/seasonStartScorecard.js
//   node scripts/seasonStartScorecard.js --section=fatigue --races=8 --seed=2910
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_KEY (service-role, læse-adgang).

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { simulateStage } from "../lib/raceSimulator.js";
import { seasonResetFatigue } from "../lib/seasonFatigueReset.js";
import { planSeasonAcademyIntake } from "../lib/seasonAcademyIntake.js";
import { ACADEMY } from "../lib/academyFlag.js";
import { POTENTIALE_TIERS } from "../lib/academyGenerator.js";
import { makeRng, gaussian } from "../lib/fictionalRiderGenerator.js";
import { ABILITY_KEYS } from "../lib/riderTypes.js";
import { fetchAllPaged, selectInChunks } from "../lib/dbChunk.js";

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const SECTION = argv.get("section") ?? "all";
const RACE_LIMIT = Number(argv.get("races") ?? 10);
const SEED = Number(argv.get("seed") ?? 2910);
const SEASONS_AHEAD = Number(argv.get("seasons") ?? 5);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler i env.");
  process.exit(1);
}
const supabase = createClient(url, key);

const line = (c = "=") => console.log(c.repeat(78));
const pct = (n) => `${(n * 100).toFixed(1)} %`;
const num = (n, d = 1) => (n == null || Number.isNaN(n) ? "—" : Number(n).toFixed(d));

// selectInChunks alene er IKKE nok når ét id kan have mange rækker (race_entries:
// ~140 pr. løb). PostgREST capper tavst ved 1000 rækker pr. request (#1839/#2967-
// klassen), så en chunk på 200 løb ville droppe ~85 % af feltet uden at fejle.
// Derfor: små id-chunks + range-paginering indeni.
async function selectInChunksPaged({ table, columns, inColumn, ids, chunkSize = 20 }) {
  const out = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const { data, error } = await fetchAllPaged(() =>
      supabase.from(table).select(columns).in(inColumn, slice).order(inColumn)
    );
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
  }
  return out;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function describe(values) {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return { n: s.length, mean, p10: quantile(s, 0.1), median: quantile(s, 0.5), p90: quantile(s, 0.9) };
}

// Spearman rho MED ties-korrektion (gennemsnitsrang). Uden den giver et felt hvor
// næsten alle har træthed 100 en falsk rho ≈ 1, fordi sorteringen falder tilbage
// på input-rækkefølgen (= måludfaldet). Alt-ens input → nul varians → rho 0.
function averageRanks(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const rx = averageRanks(xs), ry = averageRanks(ys);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx), my = mean(ry);
  let cov = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    cov += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? cov / Math.sqrt(dx * dy) : 0;
}

// ── Sektion A: træthed (#2910) ───────────────────────────────────────────────
const FATIGUE_OPTIONS = [
  { id: "A", label: "Uændret (nuværende adfærd)", mode: "off" },
  { id: "B", label: "Fuld nulstilling (alle på 0)", mode: "full" },
  { id: "C", label: "3 hviledage gennem den ægte model", mode: "rest_days", restDays: 3 },
  { id: "C1", label: "1 hviledag (kun natten over)", mode: "rest_days", restDays: 1 },
];

async function loadFatigueWorld() {
  const { data: season } = await supabase
    .from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
  if (!season) throw new Error("ingen aktiv sæson");

  // Sidste løbsdag i sæsonen = de felter der reelt slutter S1 og lægger op til S2.
  const { data: races, error: raceErr } = await supabase
    .from("races")
    .select("id, name, scheduled_for, league_division_id")
    .eq("season_id", season.id)
    .order("scheduled_for", { ascending: false })
    .limit(RACE_LIMIT);
  if (raceErr) throw new Error(`races: ${raceErr.message}`);

  const raceIds = races.map((r) => r.id);
  const profiles = await selectInChunksPaged({
    table: "race_stage_profiles",
    columns: "race_id, stage_number, profile_type, finale_type, demand_vector, distance_km",
    inColumn: "race_id", ids: raceIds, chunkSize: 20,
  });

  const entries = await selectInChunksPaged({
    table: "race_entries", columns: "race_id, rider_id, team_id",
    inColumn: "race_id", ids: raceIds, chunkSize: 5,
  });

  const riderIds = [...new Set(entries.map((e) => e.rider_id))];
  const { data: abilities, error: aErr } = await selectInChunks({
    supabase, table: "rider_derived_abilities",
    columns: `rider_id, ${ABILITY_KEYS.join(", ")}`,
    inColumn: "rider_id", ids: riderIds,
  });
  if (aErr) throw new Error(`abilities: ${aErr.message}`);

  const { data: cond, error: cErr } = await selectInChunks({
    supabase, table: "rider_condition", columns: "rider_id, form, fatigue",
    inColumn: "rider_id", ids: riderIds,
  });
  if (cErr) throw new Error(`condition: ${cErr.message}`);

  const teamIds = [...new Set(entries.map((e) => e.team_id).filter(Boolean))];
  const { data: teams, error: tErr } = await selectInChunks({
    supabase, table: "teams", columns: "id, is_ai", inColumn: "id", ids: teamIds,
  });
  if (tErr) throw new Error(`teams: ${tErr.message}`);

  return { season, races, profiles, entries, abilities, cond, teams };
}

function buildStageJobs(world) {
  const abById = new Map(world.abilities.map((a) => [a.rider_id, a]));
  const condById = new Map(world.cond.map((c) => [c.rider_id, c]));
  const isAiTeam = new Map(world.teams.map((t) => [t.id, t.is_ai === true]));
  const entriesByRace = new Map();
  for (const e of world.entries) {
    if (!entriesByRace.has(e.race_id)) entriesByRace.set(e.race_id, []);
    entriesByRace.get(e.race_id).push(e);
  }

  const jobs = [];
  for (const p of world.profiles) {
    const es = entriesByRace.get(p.race_id) || [];
    const entrants = [];
    for (const e of es) {
      const ab = abById.get(e.rider_id);
      if (!ab) continue; // spejler loadEntrantsForRace's defensive skip
      const c = condById.get(e.rider_id) || {};
      const abilities = {};
      for (const k of ABILITY_KEYS) if (ab[k] != null) abilities[k] = Number(ab[k]);
      entrants.push({
        rider_id: e.rider_id,
        team_id: e.team_id,
        abilities,
        form: c.form ?? null,
        fatigue: c.fatigue ?? 0,
        recovery: Number(ab.recovery ?? 50),
        is_ai: isAiTeam.get(e.team_id) === true,
      });
    }
    if (entrants.length < 20) continue;
    jobs.push({
      stageProfile: {
        profile_type: p.profile_type,
        finale_type: p.finale_type,
        demand_vector: p.demand_vector,
        distance_km: p.distance_km,
      },
      entrants,
      // Stabil, data-afledt etape-seed (samme etape → samme støj i alle optioner).
      seed: (SEED + p.stage_number * 7919 + hash32(p.race_id)) >>> 0,
    });
  }
  return jobs;
}

function hash32(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function applyOption(entrants, opt) {
  return entrants.map((e) => ({
    ...e,
    fatigue: seasonResetFatigue({
      fatigue: e.fatigue,
      recoveryAbility: e.recovery,
      mode: opt.mode,
      restDays: opt.restDays ?? 0,
    }),
  }));
}

function rankedIds(result) {
  // simulateStage returnerer { seed, ranked, incidents } — ranked er allerede
  // sorteret (rank 1 først), inkl. v3's uhelds-omrangering.
  return (result?.ranked ?? []).map((r) => r.rider_id);
}

async function runFatigueSection(v3) {
  line();
  console.log("SEKTION A — #2910 · Sæsonskiftet og resttræthed");
  line();

  const world = await loadFatigueWorld();
  const jobs = buildStageJobs(world);
  console.log(`Datagrundlag: ${jobs.length} ægte etaper fra sæson ${world.season.number}'s sidste løbsdage`);
  console.log(`Feltstørrelse: median ${describe(jobs.map((j) => j.entrants.length)).median} ryttere · v3-scoring: ${v3 ? "ON (som i prod)" : "off"}`);
  console.log("");

  // Referencen: samme etaper, samme støj, men NUL resttræthed for alle. Alt der
  // afviger herfra i en option ER resttrætheds-effekten.
  const reference = jobs.map((j) =>
    rankedIds(simulateStage({ entrants: applyOption(j.entrants, { mode: "full" }), stageProfile: j.stageProfile, seed: j.seed, v3 }))
  );

  const header = ["Option", "gns.", "median", "p90", "vinder", "top-3", "top-10", "rangskift", "rho", "AI i top-10"];
  const rows = [];

  for (const opt of FATIGUE_OPTIONS) {
    let winnerFlips = 0, top3Overlap = 0, top10Overlap = 0, stages = 0;
    let aiTop10 = 0, top10Total = 0, rankShift = 0, rankShiftN = 0;
    const rhos = [];
    const allFatigue = [];

    jobs.forEach((j, i) => {
      const entrants = applyOption(j.entrants, opt);
      for (const e of entrants) allFatigue.push(e.fatigue);
      const order = rankedIds(simulateStage({ entrants, stageProfile: j.stageProfile, seed: j.seed, v3 }));
      const ref = reference[i];

      stages++;
      if (order[0] !== ref[0]) winnerFlips++;
      const r3 = new Set(ref.slice(0, 3)), r10 = new Set(ref.slice(0, 10));
      top3Overlap += order.slice(0, 3).filter((id) => r3.has(id)).length / 3;
      top10Overlap += order.slice(0, 10).filter((id) => r10.has(id)).length / 10;

      // Hvor langt flytter de ryttere sig, der UDEN resttræthed ville køre top-10?
      const posInOption = new Map(order.map((id, k) => [id, k + 1]));
      ref.slice(0, 10).forEach((id, k) => {
        const p = posInOption.get(id);
        if (p == null) return; // udgået (v3-uheld) — tælles ikke med
        rankShift += Math.abs(p - (k + 1));
        rankShiftN++;
      });

      const byId = new Map(entrants.map((e) => [e.rider_id, e]));
      for (const id of order.slice(0, 10)) {
        top10Total++;
        if (byId.get(id)?.is_ai) aiTop10++;
      }
      const pos = order.map((_, k) => k + 1);
      rhos.push(spearman(order.map((id) => byId.get(id).fatigue), pos));
    });

    const d = describe(allFatigue);
    rows.push([
      `${opt.id}. ${opt.label}`,
      num(d.mean), num(d.median, 0), num(d.p90, 0),
      pct(winnerFlips / stages),
      pct(1 - top3Overlap / stages),
      pct(1 - top10Overlap / stages),
      num(rankShift / Math.max(1, rankShiftN), 2),
      num(rhos.reduce((a, b) => a + b, 0) / rhos.length, 3),
      pct(aiTop10 / top10Total),
    ]);
  }

  console.log("Trætheds-niveau ved sæsonstart · og hvor meget resultatet flytter sig");
  console.log("i forhold til et felt HELT uden resttræthed (= ren holdkvalitet):");
  console.log("");
  console.log(header.join(" | "));
  for (const r of rows) console.log(r.join(" | "));
  console.log("");
  console.log("vinder = andel etaper hvor en ANDEN rytter vinder end uden resttræthed");
  console.log("top-3/top-10 = andel af pladserne der er besat af andre ryttere");
  console.log("rangskift = hvor mange pladser en 'ren kvalitet'-top-10-rytter flytter sig i snit");
  console.log("rho = rangkorrelation mellem træthed og placering (0 = træthed betyder intet)");
  console.log("");

  // Menneske vs AI (samme tal, opdelt) — hvem bærer trætheden i dag?
  const human = [], ai = [];
  for (const j of jobs) for (const e of j.entrants) (e.is_ai ? ai : human).push(e.fatigue);
  const dh = describe(human), da = describe(ai);
  console.log(`I dag (option A): menneskehold gns. ${num(dh.mean)} (p10 ${num(dh.p10, 0)} / p90 ${num(dh.p90, 0)}) · AI-hold gns. ${num(da.mean)} (p10 ${num(da.p10, 0)} / p90 ${num(da.p90, 0)})`);
  console.log("");
}

// ── Sektion B: akademi (#2911) ───────────────────────────────────────────────
const INTAKE_OPTIONS = [
  { id: "A", label: "Uændret — kun søndags-drip", seasonIntake: 0 },
  { id: "B", label: "Sæson-optagelse: 3 pr. hold", seasonIntake: 3, mode: "fixed" },
  { id: "C", label: "Sæson-optagelse: top-up til 8 pladser (maks 3)", seasonIntake: 3, mode: "top_up", target: ACADEMY.SLOTS },
  { id: "D", label: "Sæson-optagelse: 5 pr. hold", seasonIntake: 5, mode: "fixed" },
];

// Alderskriterium-varianter (kun MÅLT — ændrer ikke generatoren).
const AGE_RULES = [
  { id: "nuværende", mean: 18, sd: 1.6, maxAge: ACADEMY.MAX_AGE },
  { id: "cap 18", mean: 18, sd: 1.6, maxAge: 18 },
  { id: "cap 17", mean: 17, sd: 1.2, maxAge: 17 },
];

async function loadAcademyWorld() {
  const { data: season } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();

  const { data: teams } = await supabase
    .from("teams").select("id")
    .eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false);

  const { data: academy, error: acErr } = await fetchAllPaged(() =>
    supabase.from("riders").select("id, team_id, birthdate")
      .eq("is_academy", true).eq("is_retired", false).order("id")
  );
  if (acErr) throw new Error(`academy riders: ${acErr.message}`);

  const { data: intake, error: iErr } = await fetchAllPaged(() =>
    supabase.from("academy_intake").select("team_id, status").order("team_id")
  );
  if (iErr) throw new Error(`academy_intake: ${iErr.message}`);

  const { data: ticks } = await supabase
    .from("academy_intake_ticks").select("tick_date").order("tick_date", { ascending: false }).limit(1);

  return { season, teams: teams || [], academy: academy || [], intake: intake || [], lastTick: ticks?.[0]?.tick_date ?? null };
}

// PR. HOLD-fremskrivning. En aggregeret model ville lyve: akademiet har en HÅRD
// 8-plads-cap pr. hold (ACADEMY.SLOTS, håndhævet i finalize_academy_acquisition),
// så tilbud til et fyldt akademi bliver aldrig til bestand.
function projectAcademy({ teamAges, signRate, sundaysPerSeason, dripPerTeam, option, ageRule, seasons, rng }) {
  let teams = teamAges.map((ages) => [...ages]);
  const out = [];

  for (let s = 0; s < seasons; s++) {
    // 1) Udflow: alle der har nået GRADUATE_AGE (22) forlader akademiet.
    let graduated = 0;
    teams = teams.map((ages) => {
      const keep = ages.filter((a) => a < 22);
      graduated += ages.length - keep.length;
      return keep;
    });

    // 2) Sæson-optagelsens plan (den ÆGTE kerne, pr. hold).
    const openOffersPerTeam = dripPerTeam * 2; // typisk uafgjort pipeline ved skiftet
    const seasonPlan = option.seasonIntake > 0
      ? new Map(planSeasonAcademyIntake({
          teams: teams.map((ages, i) => ({
            teamId: String(i), academyCount: ages.length, openOffers: openOffersPerTeam,
          })),
          mode: option.mode ?? "fixed",
          count: option.seasonIntake,
          targetPipeline: option.target ?? 6,
        }).map((p) => [p.teamId, p.count]))
      : new Map();

    let offers = 0, signed = 0;
    teams = teams.map((ages, i) => {
      const teamOffers = dripPerTeam * sundaysPerSeason + (seasonPlan.get(String(i)) || 0);
      offers += teamOffers;
      // Ét Bernoulli-træk PR. TILBUD (ikke en afrundet forventningsværdi) — ellers
      // forsvinder forskellen mellem optionerne i afrundingen ved lave rater.
      const next = [...ages];
      for (let k = 0; k < teamOffers; k++) {
        if (next.length >= ACADEMY.SLOTS) break;
        if (rng() >= signRate) continue;
        signed++;
        next.push(Math.max(
          ACADEMY.MIN_AGE,
          Math.min(ageRule.maxAge, Math.round(gaussian(rng, ageRule.mean, ageRule.sd)))
        ));
      }
      return next;
    });

    const bestand = teams.reduce((a, t) => a + t.length, 0);
    out.push({
      season: s + 1, graduated, offers, signed, bestand,
      empty: teams.filter((t) => t.length === 0).length,
      full: teams.filter((t) => t.length >= ACADEMY.SLOTS).length,
      driftCost: bestand * ACADEMY.DRIFT_PER_SEASON,
    });

    // 3) Ældning til næste sæson.
    teams = teams.map((ages) => ages.map((a) => a + 1));
  }
  return out;
}

async function runAcademySection() {
  line();
  console.log("SEKTION B — #2911 · Akademiets bestand over 5 sæsoner");
  line();

  const w = await loadAcademyWorld();
  const nextSeason = (w.season?.number ?? 1) + 1;
  const LAUNCH_YEAR = 2026;
  const ageCounts = new Map();
  const byTeam = new Map(w.teams.map((t) => [t.id, []]));
  for (const r of w.academy) {
    const age = LAUNCH_YEAR + (nextSeason - 1) - new Date(r.birthdate).getFullYear();
    ageCounts.set(age, (ageCounts.get(age) || 0) + 1);
    if (byTeam.has(r.team_id)) byTeam.get(r.team_id).push(age);
  }
  const teamAges = [...byTeam.values()];

  const resolved = w.intake.filter((r) => r.status !== "offered");
  const signed = resolved.filter((r) => r.status === "signed").length;
  const signRate = resolved.length ? signed / resolved.length : 0.5;

  const teamCount = w.teams.length;
  console.log(`Målt i prod: ${w.academy.length} akademiryttere · ${teamCount} menneskehold`);
  console.log(`Aldersfordeling i S${nextSeason}: ${[...ageCounts].sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}: ${n}`).join(" · ")}`);
  console.log(`Underskrivningsrate (målt): ${pct(signRate)} af ${resolved.length} afgjorte tilbud`);
  console.log(`Søndags-drip: ${2} tilbud/hold/søndag · seneste tick ${w.lastTick ?? "aldrig"}`);
  console.log("");

  const SUNDAYS = Number(argv.get("sundays") ?? 5); // S1 ≈ 5 uger
  console.log(`Antaget sæsonlængde: ${SUNDAYS} søndage (S1 var 22/6-26/7) · hård cap ${ACADEMY.SLOTS} pladser/hold (= ${teamCount * ACADEMY.SLOTS} i alt)`);
  console.log("");
  console.log("Bestand (antal akademiryttere) ved slutningen af hver sæson:");
  console.log("");
  console.log(["Option", ...Array.from({ length: SEASONS_AHEAD }, (_, i) => `S${nextSeason + i}`), "tilbud/sæson", "tomme akademier S" + (nextSeason + SEASONS_AHEAD - 1), "drift/sæson S" + (nextSeason + SEASONS_AHEAD - 1)].join(" | "));

  for (const opt of INTAKE_OPTIONS) {
    const proj = projectAcademy({
      teamAges, signRate, sundaysPerSeason: SUNDAYS, dripPerTeam: 2,
      option: opt, ageRule: AGE_RULES[0], seasons: SEASONS_AHEAD, rng: makeRng(SEED),
    });
    const last = proj[SEASONS_AHEAD - 1];
    console.log([
      `${opt.id}. ${opt.label}`,
      ...proj.map((p) => String(p.bestand)),
      String(proj[0].offers),
      String(last.empty),
      `${Math.round(last.driftCost / 1000)}k`,
    ].join(" | "));
  }

  console.log("");
  console.log(`Graduerede pr. sæson (option A): ${projectAcademy({ teamAges, signRate, sundaysPerSeason: SUNDAYS, dripPerTeam: 2, option: INTAKE_OPTIONS[0], ageRule: AGE_RULES[0], seasons: SEASONS_AHEAD, rng: makeRng(SEED) }).map((p) => p.graduated).join(" · ")}`);
  console.log("");
  console.log("FØLSOMHED — den målte underskrivningsrate (50,5 %) er fra en periode hvor");
  console.log("akademierne var næsten tomme. Fyldes de op, koster hver plads 5.000/sæson i");
  console.log("drift, og raten falder. Bestand ved S" + (nextSeason + SEASONS_AHEAD - 1) + " ved lavere rate:");
  console.log("");
  console.log(["rate", ...INTAKE_OPTIONS.map((o) => o.id)].join(" | "));
  for (const rate of [signRate, 0.25, 0.15, 0.08]) {
    const cells = INTAKE_OPTIONS.map((opt) => {
      const proj = projectAcademy({
        teamAges, signRate: rate, sundaysPerSeason: SUNDAYS, dripPerTeam: 2,
        option: opt, ageRule: AGE_RULES[0], seasons: SEASONS_AHEAD, rng: makeRng(SEED),
      });
      const last = proj[SEASONS_AHEAD - 1];
      return `${last.bestand} (${last.empty} tomme)`;
    });
    console.log([`${pct(rate)}`, ...cells].join(" | "));
  }

  console.log("");
  console.log("Alderskriteriets effekt (option C, bestand ved S" + (nextSeason + SEASONS_AHEAD - 1) + "):");
  for (const rule of AGE_RULES) {
    const proj = projectAcademy({
      teamAges, signRate, sundaysPerSeason: SUNDAYS, dripPerTeam: 2,
      option: INTAKE_OPTIONS[2], ageRule: rule, seasons: SEASONS_AHEAD, rng: makeRng(SEED),
    });
    console.log(`  ${rule.id.padEnd(12)} → ${proj[SEASONS_AHEAD - 1].bestand} ryttere · ${proj[SEASONS_AHEAD - 1].empty} tomme akademier`);
  }

  console.log("");
  console.log("Potentiale-fordeling (geometrisk, decay 0.55 — owner-valgt 19/7, #2064):");
  const decays = [0.55, 0.6, 0.65];
  for (const d of decays) {
    const wts = POTENTIALE_TIERS.map((_, k) => d ** k);
    const sum = wts.reduce((a, b) => a + b, 0);
    const serious = POTENTIALE_TIERS.reduce((acc, t, k) => acc + (t >= 4.5 ? wts[k] / sum : 0), 0);
    const elite = POTENTIALE_TIERS.reduce((acc, t, k) => acc + (t >= 5.5 ? wts[k] / sum : 0), 0);
    console.log(`  decay ${d} → ${pct(serious)} "seriøse" (pot ≥ 4.5) · ${pct(elite)} elite (≥ 5.5)`);
  }
  console.log("");
}

// ── main ─────────────────────────────────────────────────────────────────────
const { data: v3Row } = await supabase.from("app_config").select("value").eq("key", "race_engine_v3_scoring").maybeSingle();
const v3 = v3Row?.value === true || v3Row?.value === "on";

console.log("");
line();
console.log("SÆSONSTART-SCORECARD — #2910 (træthed) + #2911 (akademi-optagelse)");
console.log("READ-ONLY mod prod. Seed " + SEED + ".");
line();
console.log("");

if (SECTION === "all" || SECTION === "fatigue") await runFatigueSection(v3);
if (SECTION === "all" || SECTION === "academy") await runAcademySection();
