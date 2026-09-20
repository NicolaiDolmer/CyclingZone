#!/usr/bin/env node
// #5267 — PROEVEPAKNING af loebsdags-maalet.
//
// Vaerktoejet bag docs/audits/2026-09-19-5267-proevepakning-jaevn.md. Ejeren valgte 20/9
// "maade B" (traeningsdagene fordelt jaevnt, 5 loebsdage pr. kalenderdato), og den er nu
// pakkerens ENESTE vej — saa scriptet har ikke laengere et tilstands-valg. Den afviste
// maade A's tal staar i docs/audits/2026-09-19-5267-proevepakning.md og kan ikke genskabes
// med denne udgave af koden; det er bevidst (ingen to varianter bag en skjult kontakt).
//
// 100 % READ-ONLY og offline: den koerer den rene buildTierMaterializationPlan mod den
// committede prod-katalog-fixture. Ingen database, intet --apply, ingen skrivning til
// prod. Den eneste ting den skriver er JSON-filerne under docs/audits/.
//
//   node backend/scripts/dev/proevepakning5267.mjs                     # kun tabellen
//   node backend/scripts/dev/proevepakning5267.mjs --write=docs/audits/2026-09-19-5267-proevepakning-jaevn
//
// LOEBSNAVNE SKRIVES ALDRIG. Repoet er offentligt (hard rule 17), saa loebene hedder
// A, B, C ... i den raekkefoelge de optraeder paa loebsdags-aksen — praecis som i
// 18/9- og 19/9-rapporterne.
//
// Refs #5267 #4845 #4846 #4270 #3329

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { buildTierMaterializationPlan } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../../lib/calendarStartDate.js";
import { scoreCalendarPlan } from "../../lib/calendarScorecardReport.js";
import { generateRaceStageProfiles } from "../../lib/raceStageProfileGenerator.js";
import { TIER_DENSITY } from "../../lib/calendarTierCaps.js";
import { SEASON_RACE_DAY_TARGET } from "../../lib/calendarRaceDayTargets.js";
import { GRAND_TOUR_MIN_STAGES } from "../../lib/grandTourRestDays.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..");
const FIXTURE = join(__dirname, "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json");

// Faste ankre, som i alle andre offline dry-runs (#4222/#4239): uden dem raadner
// koerslen paa selve datoen og kan ikke sammenlignes med rapporten.
const FIRST_RACE_DAY = "2026-09-28";
const NOW = new Date("2026-09-19T12:00:00Z");
const REAL_DAYS = 28;
const SEASON = 4;
const SEASON_UUID = "00000000-0000-4000-8000-000000000004";

const argv = process.argv.slice(2);
const arg = (navn, fald = null) => {
  const t = argv.find((a) => a.startsWith(`--${navn}=`));
  return t ? t.split("=").slice(1).join("=") : fald;
};
const target = Number(arg("target", SEASON_RACE_DAY_TARGET[SEASON] ?? 140));
const writeDir = arg("write", null);

const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
const quotas = Object.fromEntries(Object.entries(TIER_DENSITY).map(([t, d]) => [t, d * REAL_DAYS]));

function byg(raceDayTarget) {
  return buildTierMaterializationPlan({
    pools, catalog, from, realDays: REAL_DAYS, quotas, baseSeed: 1, raceDayTarget,
  }).tierPlans;
}

// Profilerne genereres ad SAMME seed-vej som skrive-stien (#3347/#4104), saa ogsaa de
// profil-afhaengige gates (§5 terraen, §6/§6b komposition, §7/§7b etaperaekkefoelge og
// finale) bliver VURDERET og ikke bare staar tomme.
function score(tierPlans) {
  const externalIdByPoolRace = new Map(catalog.map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map(catalog.map((c) => [c.id, c.terrain_archetype ?? null]));
  const profilesByTier = new Map();
  for (const plan of tierPlans) {
    const pool = (plan.pools ?? [])[0] ?? { raceRows: [] };
    const byRace = new Map();
    for (const r of pool.raceRows ?? []) {
      byRace.set(r.pool_race_id, generateRaceStageProfiles({
        id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
        external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null,
        terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
        race_class: r.race_class ?? null,
        season_id: SEASON_UUID, season_variant: 0,
      }));
    }
    profilesByTier.set(plan.tier, byRace);
  }
  return scoreCalendarPlan({
    tierPlans, profilesByTier, archetypeByPoolRace,
    firstRaceDay: FIRST_RACE_DAY, realDays: REAL_DAYS, kollisioner: [],
  });
}

// ── Aksen som raekker: een pr. loebsdag, i raekkefoelge ──────────────────────────────
//
// AKSE-FAELDEN (CALENDAR_RULES §0): en TOM loebsdag har ingen raekke i stageRows, saa dens
// kalenderdato kan ALDRIG udledes af naboernes `scheduled_at`. Den kommer fra pakkeren
// selv (`trainingGameDayRealDays`), som er den eneste kilde der kender baandet.
function aksen(plan) {
  const pool = (plan.pools ?? [])[0] ?? { raceRows: [], stageRows: [] };
  const meta = new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r]));
  const G = plan.raceDayAxisLength ?? plan.timelineLength ?? 0;

  const prLoebsdag = new Map();
  for (const s of pool.stageRows ?? []) {
    if (!prLoebsdag.has(s.game_day)) prLoebsdag.set(s.game_day, []);
    prLoebsdag.get(s.game_day).push(s);
  }

  // Anonymisering: A, B, C ... i den raekkefoelge loebene foerste gang optraeder.
  const alias = new Map();
  const navngiv = (id) => {
    if (!alias.has(id)) {
      const n = alias.size;
      alias.set(id, n < 26 ? String.fromCharCode(65 + n) : `R${n + 1}`);
    }
    return alias.get(id);
  };
  for (let g = 0; g < G; g++) {
    for (const s of (prLoebsdag.get(g) ?? []).slice().sort((a, b) => a.stage_number - b.stage_number)) navngiv(s.pool_race_id);
  }

  // Spaendene maales paa den FAERDIGE akse (efter padding), for det er dér spoergsmaalet
  // "ligger denne traeningsdag inde i et loebs spaend" giver mening.
  const spaend = new Map();
  for (const s of pool.stageRows ?? []) {
    const nu = spaend.get(s.pool_race_id) ?? [Infinity, -Infinity];
    spaend.set(s.pool_race_id, [Math.min(nu[0], s.game_day), Math.max(nu[1], s.game_day)]);
  }

  const datoAf = new Map();
  for (const [g, ss] of prLoebsdag) datoAf.set(g, String(ss[0].scheduled_at).slice(0, 10));
  const traeningsdage = plan.trainingGameDays ?? [];
  const traeningsdatoer = plan.trainingGameDayRealDays ?? [];
  traeningsdage.forEach((g, i) => datoAf.set(g, datoIso(traeningsdatoer[i])));

  const typeAf = (id) => {
    const r = meta.get(id);
    const n = r?.stages ?? 1;
    if (n >= GRAND_TOUR_MIN_STAGES) return "grand_tour";
    return n > 1 ? "etapeloeb" : "endagsloeb";
  };

  const traeningsSaet = new Set(traeningsdage);
  const raekker = [];
  for (let g = 0; g < G; g++) {
    const ss = (prLoebsdag.get(g) ?? []).slice().sort((a, b) => a.stage_number - b.stage_number);
    const indeI = [...spaend.entries()]
      .filter(([, [lo, hi]]) => g > lo && g < hi)
      .map(([id]) => navngiv(id))
      .sort();
    if (ss.length) {
      raekker.push({
        loebsdag: g, dato: datoAf.get(g) ?? null, type: "loebsdag",
        loeb: ss.map((s) => ({
          loeb: navngiv(s.pool_race_id), etape: s.stage_number,
          af: meta.get(s.pool_race_id)?.stages ?? 1, type: typeAf(s.pool_race_id),
        })),
      });
      continue;
    }
    raekker.push({
      loebsdag: g, dato: datoAf.get(g) ?? null,
      // En tom loebsdag pakkeren IKKE lagde er en Grand Tours hviledag (#3470) — den er
      // ikke en traeningsdag, for rytteren er bundet henover.
      type: traeningsSaet.has(g) ? "traeningsdag" : "gt_hviledag",
      loeb: [],
      indeISpaend: indeI.length > 0,
      spaendLoeb: indeI,
    });
  }
  return { raekker, alias };
}

function datoIso(dagIndeks) {
  const d = new Date(`${FIRST_RACE_DAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(dagIndeks || 0));
  return d.toISOString().slice(0, 10);
}

// ── Maalingerne pr. division ────────────────────────────────────────────────────────
function maal(plan, rapportTier, raekker) {
  const pool = (plan.pools ?? [])[0] ?? { stageRows: [] };
  const etaperPrDato = new Map();
  for (const s of pool.stageRows ?? []) {
    const d = String(s.scheduled_at).slice(0, 10);
    etaperPrDato.set(d, (etaperPrDato.get(d) ?? 0) + 1);
  }
  const prDato = plan.raceDaysPerDate ?? [];
  const traening = raekker.filter((r) => r.type === "traeningsdag");
  const indeI = traening.filter((r) => r.indeISpaend).length;
  const medLoebPrDato = new Array(REAL_DAYS).fill(0);
  for (const r of raekker) if (r.type === "loebsdag") medLoebPrDato[dagIndeksAf(r.dato)] += 1;

  return {
    division: plan.tier,
    loebsdageIAlt: plan.raceDayAxisLength ?? 0,
    loebsdageMedLoeb: new Set((pool.stageRows ?? []).map((s) => s.game_day)).size,
    traeningsdage: traening.length,
    gtHviledage: raekker.filter((r) => r.type === "gt_hviledag").length,
    loebsdagePrDatoMin: prDato.length ? Math.min(...prDato) : 0,
    loebsdagePrDatoMax: prDato.length ? Math.max(...prDato) : 0,
    traeningsdageIndeISpaend: indeI,
    traeningsdageIndeISpaendPct: traening.length ? Math.round((indeI / traening.length) * 1000) / 10 : 0,
    datoerMedFuldNaturligKvote: medLoebPrDato.filter((n) => n >= 5).length,
    datoerOverKvote: (plan.raceDayPerDateDeviations ?? []).length,
    overlapAndelPct: Math.round((rapportTier.gameDayOverlap?.multiRaceShare ?? 0) * 1000) / 10,
    overlapGulvPct: Math.round((rapportTier.multiRaceShareMin ?? 0) * 1000) / 10,
    etaperPrKalenderdatoMin: Math.min(...etaperPrDato.values()),
    etaperPrKalenderdatoMax: Math.max(...etaperPrDato.values()),
    laengsteStimeUdenTraeningsdag: plan.longestDateStreakWithoutTraining ?? null,
    friePositionerPaaAksen: plan.freeAxisPositions ?? 0,
  };
}

const dagIndeksAf = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${FIRST_RACE_DAY}T00:00:00Z`)) / 86_400_000);

// ── Koerslen ────────────────────────────────────────────────────────────────────────
const planer = byg(target);
const rapport = score(planer);

const ud = [];
ud.push(`#5267 proevepakning — maal ${target} loebsdage, S4 (${REAL_DAYS} datoer fra ${FIRST_RACE_DAY})`);
ud.push("READ-ONLY dry-run mod den committede prod-katalog-fixture. Intet er skrevet til prod.");
ud.push("");
ud.push("Div | loebsdage | m. loeb | traening | heraf i spaend | loebsdage/dato | etaper/dato | overlap | gulv | stime");
for (const plan of planer) {
  const t = rapport.tiers.find((x) => x.tier === plan.tier);
  const { raekker } = aksen(plan);
  const m = maal(plan, t, raekker);
  ud.push(
    ` D${m.division} | ${String(m.loebsdageIAlt).padStart(9)} | ${String(m.loebsdageMedLoeb).padStart(7)} | `
    + `${String(m.traeningsdage).padStart(8)} | ${String(`${m.traeningsdageIndeISpaend} (${m.traeningsdageIndeISpaendPct} %)`).padStart(14)} | `
    + `${String(`${m.loebsdagePrDatoMin}-${m.loebsdagePrDatoMax}`).padStart(14)} | `
    + `${String(`${m.etaperPrKalenderdatoMin}-${m.etaperPrKalenderdatoMax}`).padStart(11)} | `
    + `${String(`${m.overlapAndelPct} %`).padStart(7)} | ${String(`${m.overlapGulvPct} %`).padStart(4)} | ${m.laengsteStimeUdenTraeningsdag}`,
  );
}
ud.push("");
ud.push("NATURLIGE LOEBSDAGE PR. KALENDERDATO (histogram) — hvor mange ekstra dage hver dato skal have");
for (const plan of planer) {
  const { raekker } = aksen(plan);
  const medLoeb = new Array(REAL_DAYS).fill(0);
  for (const r of raekker) if (r.type === "loebsdag") medLoeb[dagIndeksAf(r.dato)] += 1;
  const hist = new Map();
  for (const n of medLoeb) hist.set(n, (hist.get(n) ?? 0) + 1);
  const linje = [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([n, k]) => `${n} loebsdage: ${k} dato(er)`).join(" · ");
  ud.push(` D${plan.tier}: ${linje} | maks ${Math.max(...medLoeb)} | datoer der allerede har 5: ${medLoeb.filter((n) => n >= 5).length} | datoer med MERE end 5: ${medLoeb.filter((n) => n > 5).length}`);
}
ud.push("");
ud.push("GATES (roede brud; tom = groen)");
for (const t of rapport.tiers) {
  const grupper = [
    ["§1b kvote", t.quotaViol], ["§1 mindste-overlap", t.minOverlapViol],
    ["§4 monument-i-GT", t.monumentGtViol], ["§5 rolling-baand", t.terrainBandViol],
    ["§3 plan-invarianter", t.planViolations], ["§5 daekning", t.coverageViol],
    ["§6 komposition", t.compositionViol], ["§7 etaperaekkefoelge", t.orderViol],
    ["§7b finale", t.finaleViol], ["§6b uniform", t.uniformViol],
  ];
  const roede = grupper.filter(([, v]) => (v ?? []).length);
  ud.push(` D${t.tier}: ${roede.length ? roede.map(([n, v]) => `${n} (${v.length})`).join(" · ") : "alle groenne"}`);
}
ud.push(` §1d loebsdage ens: ${rapport.raceDayEqualityViol.length ? rapport.raceDayEqualityViol.join(" · ") : "groen"}`);
ud.push(` §1e traeningsrytme: ${rapport.trainingStreakViol.length ? rapport.trainingStreakViol.join(" · ") : "groen"}`);
ud.push(` §2 loeb hver kalenderdag: ${rapport.dækning.ok ? "groen" : rapport.dækning.violations.join(" · ")}`);
ud.push(` §7b saeson-finale: ${rapport.sæsonFinaleViol.length ? rapport.sæsonFinaleViol.join(" · ") : "groen"}`);
console.log(ud.join("\n"));

if (writeDir) {
  const maalMappe = resolve(REPO, writeDir);
  mkdirSync(maalMappe, { recursive: true });
  for (const plan of planer) {
    const t = rapport.tiers.find((x) => x.tier === plan.tier);
    const { raekker } = aksen(plan);
    const fil = join(maalMappe, `d${plan.tier}.json`);
    writeFileSync(fil, `${JSON.stringify({
      _om: "S4-proevepakning, #5267. READ-ONLY dry-run. Loebsnavne er anonymiseret til bogstaver (repoet er offentligt).",
      noegletal: {
        saeson: SEASON, foersteLoebsdato: FIRST_RACE_DAY, kalenderdatoer: REAL_DAYS,
        maal: target, naturligeLoebsdage: plan.naturalRaceDays ?? null,
        ...maal(plan, t, raekker),
      },
      loebsdage: raekker,
    }, null, 1)}\n`, "utf8");
    console.log(`skrev ${fil}`);
  }
}
