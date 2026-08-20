import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runPhysiologyBackfill, runRiderTypesBackfill, runBaseValueBackfill, deriveForRiderIds } from "./backfillCores.js";
import { STAT_KEYS } from "./fictionalRiderGenerator.js";
import { ABILITY_KEYS, computeRiderTypes } from "./riderTypes.js";
import { selectTypesBaseline } from "./riderTypesBaselineSelect.js";
import { ageForSeason } from "./riderProgressionEngine.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { buildCapsForRider } from "./riderProgression.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Én fleksibel in-memory mock der dækker alle tre kerners læse/skrive-flader:
//   reads:  from(t).select(...).eq?(...).order(...).range(from,to)  (fetchAllRows-kontrakt)
//   writes: from(t).upsert(rows, {onConflict})  |  from(t).update(patch).eq("id", id)
function makeMockSupabase(tables) {
  const writes = { upserts: [], updates: [] };
  function from(table) {
    const api = {
      select() { return api; },
      eq() { return api; },
      in() { return api; },
      order() { return api; },
      range() { return Promise.resolve({ data: tables[table] ?? [], error: null }); },
      // #2594: backfillCores.activeSeasonNumber slår aktiv sæson op via
      // .select("number").eq("status","active").maybeSingle() (deriveForRiderIds
      // + runBaseValueBackfill kalder begge denne). Ingen seeded "seasons"-tabel
      // i disse fixtures → fallback til sæson 1 (uændret eksisterende adfærd).
      maybeSingle() { return Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null }); },
      upsert(rows, opts) { writes.upserts.push({ table, rows, opts }); return Promise.resolve({ error: null }); },
      update(patch) {
        return {
          eq(col, val) {
            writes.updates.push({ table, patch, col, val });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return api;
  }
  return { from, writes };
}

function makeRider(id) {
  const rider = { id, height: 180, weight: 68, birthdate: "2000-01-01", potentiale: 4, primary_type: "climber", uci_points: 100, prize_earnings_bonus: 0 };
  for (const k of STAT_KEYS) rider[k] = 70;
  return rider;
}

function makeAbilities(rider_id) {
  const ab = { rider_id };
  for (const k of ABILITY_KEYS) ab[k] = 60;
  ab.climbing = 80; // gør typen ikke-degenereret
  return ab;
}

test("runPhysiologyBackfill (dryRun) beregner profiler+abilities uden writes", async () => {
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  const res = await runPhysiologyBackfill(supabase, { dryRun: true });
  assert.equal(res.riders, 1);
  assert.equal(res.profiles, 1);
  assert.equal(res.abilities, 1);
  assert.equal(res.written, 0);
  assert.equal(supabase.writes.upserts.length, 0, "dry-run må ikke skrive");
});

test("runPhysiologyBackfill (apply) upserter physiology + abilities", async () => {
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  const res = await runPhysiologyBackfill(supabase, { dryRun: false });
  assert.equal(res.written, 1);
  const tablesWritten = supabase.writes.upserts.map((u) => u.table).sort();
  assert.deepEqual(tablesWritten, ["rider_derived_abilities", "rider_physiology_profiles"]);
});

test("runRiderTypesBackfill (apply) skriver primary_type/secondary_type", async () => {
  const supabase = makeMockSupabase({ rider_derived_abilities: [makeAbilities("r1")] });
  const res = await runRiderTypesBackfill(supabase, { dryRun: false });
  assert.equal(res.riders, 1);
  assert.equal(res.written, 1);
  assert.equal(supabase.writes.updates.length, 1);
  const u = supabase.writes.updates[0];
  assert.equal(u.col, "id");
  assert.equal(u.val, "r1");
  assert.ok(u.patch.primary_type, "primary_type sat");
  assert.ok(u.patch.secondary_type, "secondary_type sat");
});

test("runRiderTypesBackfill (dryRun) skriver intet", async () => {
  const supabase = makeMockSupabase({ rider_derived_abilities: [makeAbilities("r1")] });
  const res = await runRiderTypesBackfill(supabase, { dryRun: true });
  assert.equal(res.written, 0);
  assert.equal(supabase.writes.updates.length, 0);
});

// ── #3570/#3588: den globale type-backfill er det TREDJE sted typen skrives ───
// Den klassificerede fra ability_caps og læste aldrig archetype_draw, så ÉN
// kørsel (scripts/backfillRiderTypes.js eller relaunchOrchestrator) ville have
// nulstillet den frosne identitet for hele peletonen. Målt mod snapshottet
// 10/8 (8.199 ryttere): den gamle sti ville have overskrevet 3 af de 6
// draw-bærende ryttere i dag, og 1.879-6.366 hvis frysningen var kørt.

// Abilities-række med den embeddede riders-join som kernen faktisk selecter.
function makeAbilitiesWithRider(rider_id, { birthdate = "2000-01-01", archetype_draw = null } = {}) {
  return { ...makeAbilities(rider_id), riders: { id: rider_id, birthdate, archetype_draw } };
}

test("runRiderTypesBackfill: et persisteret archetype_draw VINDER over klassifikatoren", async () => {
  // Caps'ene her klassificeres til climber (climbing 80, resten 60). Draw'et
  // siger sprinter/brostensrytter — anlægget er identiteten.
  const row = makeAbilitiesWithRider("r1", {
    archetype_draw: { primary: "sprinter", secondary: "brostensrytter", isHybrid: true },
  });
  const supabase = makeMockSupabase({ rider_derived_abilities: [row] });
  await runRiderTypesBackfill(supabase, { dryRun: false });
  const patch = supabase.writes.updates[0].patch;
  assert.equal(patch.primary_type, "sprinter");
  assert.equal(patch.secondary_type, "brostensrytter");
});

test("runRiderTypesBackfill: et ugyldigt/ukendt draw falder tilbage til klassifikationen", async () => {
  const bogus = makeAbilitiesWithRider("r1", { archetype_draw: { primary: "leadout" } });
  const plain = makeAbilitiesWithRider("r1");
  const a = makeMockSupabase({ rider_derived_abilities: [bogus] });
  const b = makeMockSupabase({ rider_derived_abilities: [plain] });
  await runRiderTypesBackfill(a, { dryRun: false });
  await runRiderTypesBackfill(b, { dryRun: false });
  assert.deepEqual(a.writes.updates[0].patch, b.writes.updates[0].patch);
});

test("runRiderTypesBackfill: uden draw er resultatet bit-identisk med computeRiderTypes", async () => {
  const rows = [
    makeAbilitiesWithRider("young", { birthdate: "2008-01-01" }),   // sæson-alder < 22 → ungdoms-baseline
    makeAbilitiesWithRider("adult", { birthdate: "1995-01-01" }),
    { ...makeAbilities("noEmbed") },                                 // ingen riders-join i rækken
  ];
  const supabase = makeMockSupabase({ rider_derived_abilities: rows, seasons: [{ number: 2 }] });
  await runRiderTypesBackfill(supabase, { dryRun: false });

  const adultBaseline = JSON.parse(readFileSync(join(__dirname, "./riderTypesBaseline.json"), "utf8"));
  const youthBaseline = JSON.parse(readFileSync(join(__dirname, "./riderTypesBaselineYouth.json"), "utf8"));
  for (const u of supabase.writes.updates) {
    const row = rows.find((r) => r.rider_id === u.val);
    const model = selectTypesBaseline(ageForSeason(row.riders?.birthdate, 2), adultBaseline, youthBaseline);
    const { primary, secondary } = computeRiderTypes(row.ability_caps || {}, model);
    assert.equal(u.patch.primary_type, primary.key, `${u.val} primary`);
    assert.equal(u.patch.secondary_type, secondary.key, `${u.val} secondary`);
  }
});

test("runRiderTypesBackfill: archetype_draw ER med i selectet (mock kan ikke bevise DB-kontrakten)", () => {
  const source = readFileSync(join(__dirname, "./backfillCores.js"), "utf8");
  const select = source.match(/from\("rider_derived_abilities"\)\s*\.select\("([^"]+)"\)/);
  assert.ok(select, "select-strengen findes");
  assert.match(select[1], /riders!inner\([^)]*archetype_draw/);
});

test("runBaseValueBackfill (apply) værdisætter kun ryttere med abilities", async () => {
  const supabase = makeMockSupabase({
    riders: [makeRider("r1"), { ...makeRider("r2"), primary_type: "sprinter" }],
    rider_derived_abilities: [makeAbilities("r1")], // kun r1 har abilities
  });
  const res = await runBaseValueBackfill(supabase, { dryRun: false });
  assert.equal(res.valued, 1);
  assert.equal(res.noAbilities, 1);
  assert.equal(supabase.writes.updates.length, 1);
  const u = supabase.writes.updates[0];
  assert.equal(u.val, "r1");
  assert.ok(Number.isInteger(u.patch.base_value), "base_value er heltal");
  assert.ok(u.patch.base_value >= 1);
});

test("runBaseValueBackfill (dryRun) skriver intet men rapporterer valued>0", async () => {
  const supabase = makeMockSupabase({
    riders: [makeRider("r1")],
    rider_derived_abilities: [makeAbilities("r1")],
  });
  const res = await runBaseValueBackfill(supabase, { dryRun: true });
  assert.equal(res.valued, 1);
  assert.equal(res.written, 0);
  assert.equal(supabase.writes.updates.length, 0);
});

// ─── deriveForRiderIds (#1478): scoped afled-pipeline for nye ryttere ──────────

test("deriveForRiderIds (apply) upserter physiology + abilities OG sætter type + base_value", async () => {
  const supabase = makeMockSupabase({ riders: [makeRider("r1"), makeRider("r2")] });
  const res = await deriveForRiderIds(supabase, ["r1", "r2"], { dryRun: false });

  assert.equal(res.riders, 2);
  assert.equal(res.profiles, 2);
  assert.equal(res.abilities, 2);
  assert.equal(res.typed, 2, "begge ryttere får en type");
  assert.equal(res.valued, 2, "begge ryttere får base_value");

  // physiology + abilities upsertes
  const upsertTables = supabase.writes.upserts.map((u) => u.table).sort();
  assert.deepEqual(upsertTables, ["rider_derived_abilities", "rider_physiology_profiles"]);

  // riders opdateres med primary_type/secondary_type + base_value
  assert.equal(supabase.writes.updates.length, 2, "én rider-update pr. rytter");
  for (const u of supabase.writes.updates) {
    assert.equal(u.col, "id");
    assert.ok(u.patch.primary_type, "primary_type sat");
    assert.ok(u.patch.secondary_type, "secondary_type sat");
    assert.ok(Number.isInteger(u.patch.base_value), "base_value er heltal");
    assert.ok(u.patch.base_value >= 1);
  }
});

test("#3345: deriveForRiderIds (apply) sætter valuation_type = primary_type for en HELT NY rytter (intet at fryse imod)", async () => {
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] }); // ingen valuation_type på input
  await deriveForRiderIds(supabase, ["r1"], { dryRun: false });
  const u = supabase.writes.updates.find((x) => x.val === "r1");
  assert.ok(u, "r1 skal opdateres");
  assert.equal(u.patch.valuation_type, u.patch.primary_type, "ny rytter: valuation_type = den friske primary_type");
});

test("#3345: deriveForRiderIds (apply) BEVARER et allerede-sat valuation_type ved re-derive (heal-sweep-sikker)", async () => {
  // Simulerer en EKSISTERENDE, allerede-frosset rytter der re-deriveres (fx
  // riderDeriveHealSweep) — reklassificeringen giver måske en ANDEN primary_type,
  // men valuation_type skal IKKE overskrives.
  const supabase = makeMockSupabase({ riders: [{ ...makeRider("r1"), valuation_type: "gc" }] });
  await deriveForRiderIds(supabase, ["r1"], { dryRun: false });
  const u = supabase.writes.updates.find((x) => x.val === "r1");
  assert.ok(u, "r1 skal opdateres");
  assert.equal(u.patch.valuation_type, "gc", "eksisterende valuation_type må ALDRIG overskrives af re-derive");
});

test("#3591: deriveForRiderIds aftrapper loftet efter peakAge — samme kaldform som dailyTrainingEngine", async () => {
  // Rod-årsagen: backfill-stien kaldte buildCapsForRider UDEN age, motoren MED.
  // De to skrivestier producerede derfor forskellige lofter for samme rytter med
  // samme type, og ryttere motoren aldrig har tikket (AI-ejede/frie, så længe
  // race_day_engine_enabled='off') fik aldrig deres loft aftrappet.
  //
  // Fixturen er en veteran langt forbi peakAge, så taperen faktisk bider.
  // Trin 7: fixturen får et PERSISTERET archetype_draw, så typerne der former
  // caps er deterministiske. Uden gulvet (#3794) er caps rent formel-bestemte,
  // og så SES det at pipeline-typerne til caps (draw/bootstrap) kan afvige fra
  // den persisterede visnings-type — gulvet maskerede den forskel før, fordi
  // veteranens høje evner vandt over begge formler.
  const veteran = {
    ...makeRider("vet"), birthdate: "1988-01-01", // sæson-alder 38
    archetype_draw: { primary: "climber", secondary: "tt" },
  };
  const supabase = makeMockSupabase({ riders: [veteran] });
  await deriveForRiderIds(supabase, ["vet"], { dryRun: false });

  const abUpsert = supabase.writes.upserts.find((u) => u.table === "rider_derived_abilities");
  assert.ok(abUpsert, "abilities upsertes");
  const row = abUpsert.rows.find((r) => r.rider_id === "vet");
  assert.ok(row?.ability_caps, "ability_caps skrives");

  const abilities = {};
  for (const k of VISIBLE_ABILITIES) if (row[k] != null) abilities[k] = Number(row[k]);

  // Mocken har ingen seeded "seasons"-tabel → activeSeasonNumber falder tilbage til 1.
  const age = ageForSeason(veteran.birthdate, 1);
  assert.ok(age > 30, `fixturen skal være forbi peakAge (var ${age})`);

  // Caps formes af det TRUKNE anlæg (#3570 fase 2) — ikke af den persisterede
  // visnings-type. Kontrakten er pinnet i draw-testen længere nede.
  const p = veteran.archetype_draw.primary;
  const s = veteran.archetype_draw.secondary;

  const medAlder = buildCapsForRider(abilities, { potentiale: veteran.potentiale, age }, p, s);
  // age: null gengiver PRÆCIS den gamle, defekte kaldform (taperedAbsoluteCap
  // behandler null og undefined ens). Efter #3591's kontrakt er udeladelse en
  // TypeError, så fravalget skrives eksplicit — testen måler stadig det samme.
  const udenAlder = buildCapsForRider(abilities, { potentiale: veteran.potentiale, age: null }, p, s);

  // Selve regressionen: de to kaldformer SKAL give forskellige lofter for denne
  // rytter (ellers beviser testen ingenting), og det skrevne loft skal matche
  // produktionens kaldform — den MED alder.
  const forskel = VISIBLE_ABILITIES.filter((a) => Number(medAlder[a]) !== Number(udenAlder[a]));
  assert.ok(forskel.length > 0, "fixturen skal kunne skelne de to kaldformer");
  for (const a of VISIBLE_ABILITIES) {
    assert.equal(Number(row.ability_caps[a]), Number(medAlder[a]), `${a}: loftet skal være aftrappet (kaldform MED alder)`);
  }

  // Spillerbeskyttelse efter #3794 (gulvet fjernet): et loft under evnen er
  // lovligt — motoren kan kun stå stille dér. At intet konfiskeres er pinnet i
  // riderProgression.test.js ("et loft under evnen konfiskerer ALDRIG evne").
});

test("deriveForRiderIds (apply) skriver ability_caps + ability_progress for ALLE ryttere (#2001)", async () => {
  // makeRider er født 2000-01-01 → voksen (26 ved asOfYear 2026). Tidligere fik voksne
  // NULL caps her (kun akademi-alder fik youth-caps); #2001 wirer fulde caps + nul-progress.
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  await deriveForRiderIds(supabase, ["r1"], { dryRun: false });

  const abUpsert = supabase.writes.upserts.find((u) => u.table === "rider_derived_abilities");
  assert.ok(abUpsert, "abilities upsertes");
  const row = abUpsert.rows[0];

  // ability_caps: et objekt med en cap pr. synlig evne (voksen → buildCaps fra baseline).
  assert.ok(row.ability_caps && typeof row.ability_caps === "object", "ability_caps sat (ikke null)");
  for (const k of ABILITY_KEYS) {
    assert.ok(Number.isFinite(row.ability_caps[k]), `cap for ${k} er et tal`);
    assert.ok(row.ability_caps[k] >= 0 && row.ability_caps[k] <= 99, `cap for ${k} ∈ [0,99]`);
  }

  // ability_progress: nul-initialiseret over alle synlige evner (ikke null).
  assert.ok(row.ability_progress && typeof row.ability_progress === "object", "ability_progress sat (ikke null)");
  for (const k of ABILITY_KEYS) {
    assert.equal(row.ability_progress[k], 0, `progress for ${k} initialiseres til 0`);
  }
});

test("deriveForRiderIds (apply) bevarer progress men GENBEREGNER caps ved re-derive", async () => {
  // Heal-sweep kan re-derive en EKSISTERENDE rytter.
  //   progress = akkumuleret træning → må ALDRIG nulstilles (#2001 no-regress).
  //   caps     = afledt af potentiale + anlæg + current → skal genberegnes, ellers
  //              overlever en forkert/stale semantik for evigt. Netop "bevar hvis den
  //              findes" lod to uforenelige loft-semantikker fryse ned i prod (15/7).
  const staleCaps = { climbing: 95, sprint: 30 };
  const existingProgress = { climbing: 0.42 };
  const supabase = makeMockSupabase({
    riders: [makeRider("r1")],
    rider_derived_abilities: [{ rider_id: "r1", ability_caps: staleCaps, ability_progress: existingProgress }],
  });
  await deriveForRiderIds(supabase, ["r1"], { dryRun: false });
  const abUpsert = supabase.writes.upserts.find((u) => u.table === "rider_derived_abilities");
  const row = abUpsert.rows[0];
  assert.deepEqual(row.ability_progress, existingProgress, "akkumuleret progress bevares");
  assert.notDeepEqual(row.ability_caps, staleCaps, "stale caps overlever ikke en re-derive");
  assert.equal(Object.keys(row.ability_caps).length, VISIBLE_ABILITIES.length,
    "genberegnet loft dækker alle 15 synlige evner");
});

test("deriveForRiderIds (dryRun) skriver intet men rapporterer beregningerne", async () => {
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  const res = await deriveForRiderIds(supabase, ["r1"], { dryRun: true });
  assert.equal(res.dryRun, true);
  assert.equal(res.profiles, 1);
  assert.equal(res.abilities, 1);
  assert.equal(supabase.writes.upserts.length, 0);
  assert.equal(supabase.writes.updates.length, 0);
});

test("deriveForRiderIds (tom liste) er no-op", async () => {
  const supabase = makeMockSupabase({ riders: [] });
  const res = await deriveForRiderIds(supabase, [], { dryRun: false });
  assert.equal(res.riders, 0);
  assert.equal(supabase.writes.upserts.length, 0);
  assert.equal(supabase.writes.updates.length, 0);
});

// ─── Kilde-guard (#1673): partiel derive må kaste, ikke strande tavst ──────────

test("deriveForRiderIds (apply) KASTER hvis en rytter ikke fik base_value (partiel derive)", async () => {
  // En brudt valuationModel (a=NaN) → predictBaseValue returnerer null for ALLE
  // ryttere → riderUpdates har ingen base_value. Det er præcis #1673's tavse
  // strandings-tilstand; guarden skal nu gøre den til en hård fejl ved kilden.
  const supabase = makeMockSupabase({ riders: [makeRider("r1"), makeRider("r2")] });
  await assert.rejects(
    () => deriveForRiderIds(supabase, ["r1", "r2"], {
      dryRun: false,
      valuationModel: { a: NaN, b: 1, offset: {} },
    }),
    /partielt derive.*uden base_value/,
    "guard skal kaste når base_value mangler for de inserterede id'er",
  );
});

test("deriveForRiderIds (apply) KASTER ikke når alle id'er fik fuld derive", async () => {
  // Sund model (default) → alle ryttere får abilities + base_value → ingen throw.
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  const res = await deriveForRiderIds(supabase, ["r1"], { dryRun: false });
  assert.equal(res.valued, 1, "sund derive fuldfører uden at kaste");
});

// computeYouthCapsForRider er fjernet (ejer 15/7): loftet er ikke længere alders-gatet,
// så en separat "kun for akademi-alder"-helper gav to semantikker at vælge imellem.
// buildCapsForRider dækker nu alle aldre — dens kontrakt testes i riderProgression.test.js.

// ─── #3570 fase 2: archetype_draw former caps DIREKTE (ikke bootstrap) ─────────

test("#3570: deriveForRiderIds (apply) BRUGER archetype_draw's primary/secondary til ability_caps, IKKE bootstrap-gættet", async () => {
  // makeRider har uniform stat=70 for alle STAT_KEYS (flad profil) → bootstrap
  // (klassificeret mod NEUTRAL_BASELINE) gætter typisk noget helt andet end "gc" på
  // en flad profil. Sætter et EKSPLICIT gc/climber-draw og verificerer at caps
  // faktisk afspejler DET trukne anlæg (buildCapsForRider med draw.primary/secondary)
  // — ikke bootstrap-typen.
  const rider = { ...makeRider("r1"), archetype_draw: { primary: "gc", secondary: "climber", isHybrid: true } };
  const supabase = makeMockSupabase({ riders: [rider] });
  await deriveForRiderIds(supabase, ["r1"], { dryRun: false });

  const abUpsert = supabase.writes.upserts.find((u) => u.table === "rider_derived_abilities");
  const row = abUpsert.rows[0];

  // Direkte reference-beregning: samme baseline + potentiale + alder som
  // deriveForRiderIds selv bruger, men eksplicit mod draw.primary/secondary.
  const { deriveAbilities, VISIBLE_ABILITIES: VA } = await import("./abilityDerivation.js");
  const { seedPhysiologyFromLegacy } = await import("./physiologySeeding.js");
  const { buildCapsForRider: buildCaps } = await import("./riderProgression.js");
  const physiology = seedPhysiologyFromLegacy(rider);
  const abilities = deriveAbilities(physiology, rider);
  const baseline = {};
  for (const k of VA) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
  // #3591: alderen SKAL med — kommentaren ovenfor har altid sagt "samme … alder",
  // men kaldet udelod den. Mocken har ingen seeded "seasons"-tabel, så
  // activeSeasonNumber falder tilbage til 1 (samme antagelse som veteran-testen).
  const expectedCaps = buildCaps(baseline, { potentiale: rider.potentiale, age: ageForSeason(rider.birthdate, 1) }, "gc", "climber");

  assert.deepEqual(row.ability_caps, expectedCaps, "caps skal matche buildCapsForRider(..., draw.primary, draw.secondary), IKKE bootstrap-typen");
});

test("#3570: deriveForRiderIds (apply) er BIT-IDENTISK uændret for en rytter UDEN archetype_draw (bootstrap-fallback)", async () => {
  // makeRider sætter INTET archetype_draw-felt → bagudkompatibel fallback til
  // bootstrap-typen (samme kodesti/formel som FØR #3570 fase 2).
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  const res = await deriveForRiderIds(supabase, ["r1"], { dryRun: false });
  assert.equal(res.typed, 1);
  const u = supabase.writes.updates.find((x) => x.val === "r1");
  assert.ok(u.patch.primary_type, "primary_type sat via bootstrap-fallback som før");
  const abUpsert = supabase.writes.upserts.find((u2) => u2.table === "rider_derived_abilities");
  const row = abUpsert.rows[0];
  for (const k of ABILITY_KEYS) {
    assert.ok(Number.isFinite(row.ability_caps[k]) && row.ability_caps[k] >= 0 && row.ability_caps[k] <= 99,
      `cap for ${k} er stadig et gyldigt tal uden draw`);
  }
});

test("#3570: deriveForRiderIds (apply) falder tilbage til bootstrap ved archetype_draw uden primary (null/tomt draw)", async () => {
  // archetype_draw kan være NULL i DB — draw.primary skal eksplicit tjekkes
  // (draw && draw.primary), ikke bare draw (et tomt objekt må ikke crashe).
  const rider = { ...makeRider("r1"), archetype_draw: null };
  const supabase = makeMockSupabase({ riders: [rider] });
  const res = await deriveForRiderIds(supabase, ["r1"], { dryRun: false });
  assert.equal(res.typed, 1, "et NULL archetype_draw crasher ikke og typer stadig rytteren");
});

// ─── #3615: `.in(ids)` må ikke sprænge URL-længden ────────────────────────────
// PostgREST sender IN-filteret i query-strengen. Over ~600 UUID'er afviser
// Supabase requestet med et bart "Bad Request" uden at nævne længden. Ramte i
// prod 10/8: kompensations-kuldet (#3576) indsatte 762 kandidater, hvorefter
// deriveForRiderIds fejlede på sin FØRSTE select — 762 ryttere stod uden
// physiology, evner, type og base_value. Søndags-drippet slap kun forbi fordi
// 192 hold × 2 = 384 id'er lå under grænsen.

function makeBatchSpyingSupabase(riders, abilities) {
  const inCallSizes = [];
  function from(table) {
    const api = {
      select() { return api; },
      eq() { return api; },
      in(_col, ids) { inCallSizes.push(ids.length); return api; },
      order() { return api; },
      range() { return Promise.resolve({ data: table === "riders" ? riders : (table === "rider_derived_abilities" ? abilities : []), error: null }); },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      upsert() { return Promise.resolve({ error: null }); },
      update() { return { eq() { return Promise.resolve({ error: null }); } }; },
    };
    return api;
  }
  return { from, inCallSizes };
}

test("#3615: deriveForRiderIds portionerer id-listen i alle IN-opslag", async () => {
  const ids = Array.from({ length: 762 }, (_, i) => `r${i}`);
  const riders = ids.map((id) => makeRider(id));
  const supabase = makeBatchSpyingSupabase(riders, []);

  await deriveForRiderIds(supabase, ids, { dryRun: true });

  assert.ok(supabase.inCallSizes.length > 0, "der blev lavet mindst ét IN-opslag");
  const værst = Math.max(...supabase.inCallSizes);
  assert.ok(
    værst <= 200,
    `største IN-opslag havde ${værst} id'er — over grænsen. En enkelt query med ` +
    `alle ${ids.length} sprænger URL-længden og fejler med "Bad Request" (#3615).`
  );
});
