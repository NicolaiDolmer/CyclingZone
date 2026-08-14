#!/usr/bin/env node
//
// byggRacePopulationer3709 — bygger to population-snapshots til race-balance-målingen
// for #3709 trin 4 (følge af beslutning 14: spidsen går fra 36 til 45).
//
// HVORFOR TO POPULATIONER OG IKKE ÉN SKALERET. Den nemme løsning er at gange
// evnerne på et eksisterende snapshot op til en top på 45 og køre race-motoren på
// det. Det måler en transformation vi har fundet på. I stedet modnes det SAMME
// friske kuld gennem hver sin motor — dagens og kandidatens — så forskellen mellem
// de to populationer er præcis modellen og intet andet.
//
// HVORFOR FELTET ER BLANDET. Under dagens model er det stort set ligegyldigt hvad
// manageren gør (agens-spænd 1 point), så feltet er ensartet uanset hvad. Under
// kandidaten spreder det sig (spænd 7). Det er netop SPREDNINGEN der kan vælte
// dominans-båndene, så et felt hvor alle spilles optimalt ville måle den mildeste
// version af risikoen. Strategierne fordeles derfor deterministisk:
//   25 % spids · 25 % rotation · 35 % standard · 15 % forkert
// Samme fordeling og samme ryttere i BEGGE populationer.
//
//   node scripts/byggRacePopulationer3709.mjs --baseline=../../ref-3709-baseline/backend/lib \
//     [--n=1200] [--seed=2026] --ud=<mappe>

import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...r] = a.replace(/^--/, "").split("=");
  return [k, r.length ? r.join("=") : true];
}));
if (!args.baseline || !args.ud) {
  console.error("brug: --baseline=<sti til backend/lib paa origin/main> --ud=<mappe> [--n=1200] [--seed=2026]");
  process.exit(2);
}

const N = Number(args.n ?? 1200);
const SEED = Number(args.seed ?? 2026);
const HOLDSTOERRELSE = 8;

const libDir = path.resolve(args.baseline);
const gl = (f) => import(pathToFileURL(path.join(libDir, f)).href);

const NY = {
  p: await import("../lib/riderProgression.js"),
  d: await import("../lib/dailyTraining.js"),
  t: await import("../lib/training.js"),
};
const GAMMEL = {
  p: await gl("riderProgression.js"),
  d: await gl("dailyTraining.js"),
  t: await gl("training.js"),
  a: await gl("academyFlag.js"),
};
if (GAMMEL.p.ROLE_CLASS_RATE) {
  console.error("STOP: --baseline har allerede rolleklasser. Det er ikke en baseline.");
  process.exit(2);
}

const { VISIBLE_ABILITIES, deriveAbilities } = await import("../lib/abilityDerivation.js");
const { seedPhysiologyFromLegacy } = await import("../lib/physiologySeeding.js");
const { generateAcademyCandidates } = await import("../lib/academyGenerator.js");
const { resolveRiderTypes } = await import("../lib/riderTypes.js");
const { conditionMultiplier } = await import("../lib/riderCondition.js");

function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ── Kuldet (samme sti som rytterudviklingScorecard) ─────────────────────────
const rng = makeRng(SEED);
const navne = new Set();
const kuld = [];
while (kuld.length < N) {
  for (const c of generateAcademyCandidates({ rng, referenceYear: 2026, existingNames: navne, countOverride: 50 })) {
    const rr = c.rider;
    const ab = deriveAbilities(seedPhysiologyFromLegacy(rr), rr);
    const rene = Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, Number(ab?.[k] ?? 0)]));
    const t = resolveRiderTypes(c.archetypeDraw, rene);
    kuld.push({
      id: `sim-3709-${String(kuld.length).padStart(5, "0")}`,
      name: `${rr.firstname} ${rr.lastname}`,
      potentiale: rr.potentiale,
      primary_type: t.primary?.key ?? c.archetypeDraw.primary,
      secondary_type: t.secondary?.key ?? c.archetypeDraw.secondary,
      abilities: rene,
    });
    if (kuld.length >= N) break;
  }
}

// Deterministisk strategi-fordeling: samme rytter faar samme strategi i BEGGE
// populationer, saa forskellen mellem dem er modellen alene.
const STRATEGI_FORDELING = [
  ...Array(25).fill("spids"), ...Array(25).fill("rotation"),
  ...Array(35).fill("standard"), ...Array(15).fill("forkert"),
];
const strategiFor = (i) => STRATEGI_FORDELING[i % STRATEGI_FORDELING.length];

function planFor(mod, r, strategi, saeson) {
  const FK = Object.keys(mod.t.TRAINING_FOCUSES);
  const score = (f) => (mod.t.TRAINING_FOCUSES[f] ?? [])
    .reduce((s, ab) => s + mod.p.youthRoleFactor(r.primary_type, r.secondary_type, ab), 0);
  const rang = [...FK].sort((a, b) => score(b) - score(a));
  switch (strategi) {
    case "spids": return { focus: rang[0], intensity: "hard" };
    case "rotation": return { focus: rang[saeson % Math.min(3, rang.length)], intensity: "hard" };
    case "standard": return { focus: mod.t.smartDefaultFocus(r.primary_type), intensity: "normal" };
    default: return { focus: rang[rang.length - 1], intensity: "normal" };
  }
}

function modn(mod, akademi, r, strategi) {
  let ab = { ...r.abilities };
  let pr = {};
  const cm = conditionMultiplier({ form: 50, fatigue: 0 });
  for (let alder = 16; alder <= 30; alder++) {
    const saeson = alder - 16;
    const program = planFor(mod, r, strategi, saeson);
    const iAkademi = alder <= 21;
    for (let d = 0; d < 28; d++) {
      const caps = mod.p.buildCapsForRider(ab, { potentiale: r.potentiale, age: alder }, r.primary_type, r.secondary_type);
      const res = mod.d.applyDailyTick({
        riderId: r.id, dateStr: `s${saeson}d${d}`, age: alder,
        abilities: ab, caps, progress: pr, program,
        conditionMult: cm, bonus: false, potentiale: r.potentiale,
        hardDailyCap: akademi && iAkademi ? GAMMEL.a.ACADEMY.HARD_DAILY_CAP : undefined,
        academyRateMult: akademi && iAkademi ? GAMMEL.a.ACADEMY.INTERIM_RATE_MULT : 1.0,
        staff: null, facilityTier: null, riderLevel: null,
        primaryType: r.primary_type, secondaryType: r.secondary_type,
      });
      ab = res.abilities; pr = res.progress;
    }
  }
  return ab;
}

// Hold: 8 ryttere hver, samme inddeling i begge populationer.
const antalHold = Math.ceil(kuld.length / HOLDSTOERRELSE);
const teams = Array.from({ length: antalHold }, (_, i) => ({
  id: `sim-team-${String(i).padStart(4, "0")}`,
  tier: (i % 4) + 1,
  league_division_id: (i % 4) + 1,
  is_ai: i % 3 === 0,
}));

function byggSnapshot(navn, mod, akademi) {
  const riders = kuld.map((r, i) => {
    const ab = modn(mod, akademi, r, strategiFor(i));
    return {
      id: r.id, name: r.name,
      team_id: teams[Math.floor(i / HOLDSTOERRELSE)].id,
      is_u25: false,
      // Deterministisk form/fatigue-spredning; IDENTISK i begge populationer, saa
      // den ikke kan forklare en forskel mellem dem.
      form: 40 + ((i * 37) % 41),
      fatigue: (i * 53) % 60,
      abilities: Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, Number(ab[k]) || 0])),
    };
  });
  const bedste = riders.map((r) => Math.max(...Object.values(r.abilities)));
  bedste.sort((a, b) => a - b);
  return {
    snapshot: {
      schema_version: 1,
      exported_at: "2026-08-15T00:00:00.000Z",
      source: `#3709 syntetisk (${navn}) — friskt kuld modnet 16→30 gennem produktionens applyDailyTick`,
      filters: { strategier: "25% spids / 25% rotation / 35% standard / 15% forkert", seed: SEED },
      counts: { teams: teams.length, riders: riders.length, dropped_no_abilities: 0, dropped_loan_outside: 0 },
      teams, riders,
    },
    medianBedsteEvne: bedste[Math.floor((bedste.length - 1) / 2)],
    maxBedsteEvne: bedste[bedste.length - 1],
  };
}

const udMappe = path.resolve(args.ud);
for (const [navn, mod, akademi] of [["idag", GAMMEL, true], ["kandidat", NY, false]]) {
  const { snapshot, medianBedsteEvne, maxBedsteEvne } = byggSnapshot(navn, mod, akademi);
  const fil = path.join(udMappe, `population-3709-${navn}.json`);
  writeFileSync(fil, JSON.stringify(snapshot));
  console.log(`${navn.padEnd(9)} → ${fil}`);
  console.log(`  ${snapshot.riders.length} ryttere paa ${teams.length} hold · bedste evne: median ${medianBedsteEvne}, hoejeste i feltet ${maxBedsteEvne}`);
}
