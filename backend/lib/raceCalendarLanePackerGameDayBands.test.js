// #4236 — en løbsdag hører til PRÆCIS én kalenderdato.
//
// `CALENDAR_RULES.md` §0: "Pakkeren lægger flere hele løbsdage INDEN I hver kalenderdag."
// Det omvendte — en løbsdag der strækker sig over to datoer — er ikke designet nogen steder,
// og ejeren afgjorde 25/8 at det er en fejl.
//
// Konsekvensen i prod: bindingen er pr. løbsdag, så et endagsløb blev låst af et etapeløb
// der var kørt færdig fem dage før. Fire D1-endagsløb stod med 16-33 ryttere mod 101-128 for
// sammenlignelige løb. Feltet var ikke lovligt at fylde — auto-udtagelsen fordelte korrekt.
//
// Testen kører mod den committede prod-katalog-fixture, fordi fejlen kun opstår ved ægte
// katalog-tæthed: den syntetiske div3-fixture i raceCalendarLanePacker.test.js har aldrig
// udløst den, og derfor slap fejlen igennem i to sæsoner.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan } from "./tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "./calendarStartDate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "__fixtures__", "racePoolCatalog.prod.json");

// Fast dato + fast `now` — ellers rådner testen på selve datoen (#4222/#4239).
const FIRST_RACE_DAY = "2026-08-28";
const NOW = new Date("2026-08-25T12:00:00Z");

function planFromFixture() {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
  return buildTierMaterializationPlan({ pools, catalog, from, baseSeed: 1 });
}

// game_day -> Set(kalenderdato) for én pulje.
function datesByGameDay(pool) {
  const m = new Map();
  for (const s of pool.stageRows ?? []) {
    if (!m.has(s.game_day)) m.set(s.game_day, new Set());
    m.get(s.game_day).add(String(s.scheduled_at).slice(0, 10));
  }
  return m;
}

test("#4236: ingen løbsdag spænder over mere end én kalenderdato", () => {
  const { tierPlans } = planFromFixture();
  const brud = [];
  for (const plan of tierPlans) {
    for (const pool of plan.pools ?? []) {
      for (const [game_day, dates] of datesByGameDay(pool)) {
        if (dates.size > 1) {
          brud.push(`tier ${plan.tier} løbsdag ${game_day} → ${[...dates].sort().join(", ")}`);
        }
      }
    }
  }
  assert.deepEqual(brud, [], `${brud.length} løbsdage spænder flere datoer:\n  ${brud.slice(0, 8).join("\n  ")}`);
});

test("#4236: hver kalenderdato ejer et sammenhængende bånd af løbsdage", () => {
  // Den model ejeren låste 25/8: dato d ejer [gd_lav..gd_høj], og ingen anden dato
  // rører det interval. Uden det kan Planning Centers sæsonmatrix ikke tegne
  // datokolonner uden at lyve (#1146).
  const { tierPlans } = planFromFixture();
  const brud = [];
  for (const plan of tierPlans) {
    for (const pool of plan.pools ?? []) {
      const spanByDate = new Map();
      for (const s of pool.stageRows ?? []) {
        const d = String(s.scheduled_at).slice(0, 10);
        const cur = spanByDate.get(d) ?? { lo: Infinity, hi: -Infinity };
        cur.lo = Math.min(cur.lo, s.game_day);
        cur.hi = Math.max(cur.hi, s.game_day);
        spanByDate.set(d, cur);
      }
      const sorted = [...spanByDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (let i = 1; i < sorted.length; i++) {
        const [prevDate, prev] = sorted[i - 1];
        const [date, cur] = sorted[i];
        if (cur.lo <= prev.hi) {
          brud.push(`tier ${plan.tier}: ${prevDate} ejer [${prev.lo}..${prev.hi}], ${date} starter på ${cur.lo}`);
        }
      }
    }
  }
  assert.deepEqual(brud, [], `${brud.length} overlappende bånd:\n  ${brud.slice(0, 8).join("\n  ")}`);
});

test("#4236: fixet må ikke bryde overlap-cap'en", () => {
  // Regressionsvagt. `game_day := dato − startdato` blev afvist to gange (#4155, #4158)
  // netop fordi den fladede aksen ud og brød TIER_OVERLAP_CAP i alle fire divisioner.
  // Splitter man i stedet en straddle-løbsdag i to, kan overlappet kun FALDE.
  const { tierPlans } = planFromFixture();
  for (const plan of tierPlans) {
    if (plan.overlapCap == null) continue;
    assert.ok(
      plan.maxOverlap <= plan.overlapCap,
      `tier ${plan.tier}: maxOverlap ${plan.maxOverlap} > cap ${plan.overlapCap}`
    );
  }
});

test("#4236: aksen må ikke flades ud til én løbsdag pr. kalenderdag", () => {
  // Den anden side af samme mønt, og den fejlklasse #4155 ramte. D1 skal stadig have
  // markant flere løbsdage end kalenderdage — ellers kan 5 etaper ikke afvikles på én
  // dag uden at bryde cap'en (CALENDAR_RULES §0).
  const { tierPlans } = planFromFixture();
  const t1 = tierPlans.find((p) => p.tier === 1);
  const pool = (t1.pools ?? [])[0];
  const gameDays = new Set((pool.stageRows ?? []).map((s) => s.game_day));
  const dates = new Set((pool.stageRows ?? []).map((s) => String(s.scheduled_at).slice(0, 10)));
  assert.ok(
    gameDays.size >= dates.size * 2,
    `D1: ${gameDays.size} løbsdage over ${dates.size} kalenderdage — aksen ser kollapset ud`
  );
});

// ── Ejer-regel 25/8: kronologi ────────────────────────────────────────────────
// Ordret: "hvis et løb har fire etaper, skal løbsdagene jo ligge i træk. Ligesom i
// virkeligheden. Løbsdag 4-5-6-7 f.eks. Det er ikke muligt at et løb på 4 dage har
// løbsdagenumrene 3-5-7-12."
//
// Målt mod prod 25/8 er reglen brudt i 8 D1-løb og NUL løb i D2/D3/D4 (200 flerdags-løb).
// Årsagen er monument-indskuddet: et monument fik sin egen eksklusive løbsdag skudt ind
// midt i et igangværende etapeløb, hvilket rev et hul i dets løbsdage. To monumenter
// (løbsdag 12 og 26) ramte fem etapeløb.
//
// Eksklusiviteten er samtidig holdt op med at levere: spænd-bindingen fra #4217 binder
// rytteren hele etapeløbets spænd, ogsaa henover monumentets løbsdag. Målt i prod: 0 af
// 9 monument/etapeløb-kombinationer havde en eneste delt rytter. Gevinsten var væk,
// prisen blev betalt. Ejer-beslutning 25/8: kronologien vinder.

test("#4236: et løbs løbsdage ligger i træk — ingen huller", () => {
  const { tierPlans } = planFromFixture();
  const brud = [];
  for (const plan of tierPlans) {
    for (const pool of plan.pools ?? []) {
      const navn = new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r.name]));
      const byRace = new Map();
      for (const s of pool.stageRows ?? []) {
        if (!byRace.has(s.pool_race_id)) byRace.set(s.pool_race_id, []);
        byRace.get(s.pool_race_id).push(s);
      }
      for (const [id, ss] of byRace) {
        if (ss.length < 2) continue;
        const gd = [...new Set(ss.map((s) => s.game_day))].sort((a, b) => a - b);
        const hul = gd[gd.length - 1] - gd[0] + 1 - gd.length;
        // GT-hviledage (#3470) er lovlige huller: rytteren er bundet henover dem, praecis
        // som i virkeligheden. De identificeres paa etapetal >= spineMinStages (15).
        const erGt = ss.length >= 15;
        if (hul > 0 && !erGt) {
          brud.push(`tier ${plan.tier}: ${navn.get(id)} (${ss.length} etaper) → løbsdag ${gd.join(",")}`);
        }
      }
    }
  }
  assert.deepEqual(brud, [], `${brud.length} løb med hul i løbsdagene:\n  ${brud.slice(0, 8).join("\n  ")}`);
});

test("#4236: et monument deler løbsdag frem for at rive hul i et etapeløb", () => {
  // Konsekvensen af ejer-beslutningen, gjort eksplicit: monumentet har ikke laengere
  // sin egen eksklusive loebsdag. Testen sikrer at fjernelsen faktisk skete - ellers
  // ville kronologi-testen ovenfor kunne blive groen ved at flytte monumenterne ud af
  // saesonen i stedet, hvilket ikke er meningen.
  const { tierPlans } = planFromFixture();
  const t1 = tierPlans.find((p) => p.tier === 1);
  const pool = (t1.pools ?? [])[0];
  const monIds = new Set((pool.raceRows ?? []).filter((r) => r.race_class === "Monuments").map((r) => r.pool_race_id));
  assert.ok(monIds.size > 0, "fixturen skal have monumenter i D1, ellers tester vi ingenting");

  const byGameDay = new Map();
  for (const s of pool.stageRows ?? []) {
    if (!byGameDay.has(s.game_day)) byGameDay.set(s.game_day, new Set());
    byGameDay.get(s.game_day).add(s.pool_race_id);
  }
  const alene = [...monIds].filter((id) => {
    const gd = (pool.stageRows ?? []).find((s) => s.pool_race_id === id)?.game_day;
    return byGameDay.get(gd)?.size === 1;
  });
  assert.ok(
    alene.length < monIds.size,
    `alle ${monIds.size} monumenter har stadig loebsdagen for sig selv - eksklusiviteten er ikke fjernet`
  );
});
