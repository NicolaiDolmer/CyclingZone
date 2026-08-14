#!/usr/bin/env node
//
// rytterudviklingScorecard — flow-scorecard + negativ-test for #3709 trin 4 og 5.
//
// ═══ HVORFOR DEN IKKE HAR SIN EGEN VÆKSTFORMEL ═══════════════════════════════
// Trin 0's harness (14/8) blev aldrig committet, så den er bygget om her. Den
// oprindelige selvtestede sig til at være "bit-identisk med applyDailyTick" —
// altså havde den en KOPI af formlen som den så sammenlignede med originalen.
//
// Denne kalder `applyDailyTick` direkte, dag for dag, med præcis de parametre
// `dailyTrainingEngine.js` sender. Bit-identisk er derfor ikke noget der skal
// bevises; det er en egenskab ved konstruktionen. `--selvtest` verificerer at
// kæden er den samme som motorens, ikke at to formler er enige.
//
// ═══ HVAD DER ER REKONSTRUERET, OG HVAD DER IKKE ER ══════════════════════════
// Specens §3bis-tal kan kun efterprøves for de mål der er ENTYDIGT DEFINEREDE:
// rating (`ratingFromAbilities`), bedste evne, evnesum, andel af taget nået.
// To mål er det ikke:
//
//   • ARKETYPE-SKARPHED — specen skriver tal (0,87 / 0,71 / 0,58) men ikke
//     formlen. Her defineret som rytterens rating i SIN EGEN rolle divideret med
//     hans bedste rating i nogen rolle. 1,00 = han er mest sig selv.
//   • FELTETS FORSKELLIGHED — samme problem. Her defineret som gennemsnitlig
//     parvis cosinus-AFSTAND mellem normaliserede evne-vektorer.
//
// Begge definitioner er MINE, ikke specens. Retningen kan sammenlignes med
// specen; de absolutte tal kan ikke. Det står i rapporten hver gang.
//
//   node scripts/rytterudviklingScorecard.js --baseline=../../ref-3709-baseline/backend/lib \
//     [--n=1200] [--seed=2026] [--selvtest] [--json=ud.json]

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...r] = a.replace(/^--/, "").split("=");
  return [k, r.length ? r.join("=") : true];
}));

if (!args.baseline) {
  console.error("brug: --baseline=<sti til backend/lib i en worktree paa origin/main> [--n=1200] [--seed=2026] [--json=ud]");
  console.error("--baseline er PAAKRAEVET: 'i dag'-modellen skal vaere aegte produktionskode, ikke en kopi.");
  process.exit(2);
}

const N = Number(args.n ?? 1200);
const SEED = Number(args.seed ?? 2026);
const START_AGE = 16;
const SLUT_AGE = 30;
const DAGE_PR_SAESON = 28;
const BONUS = args.bonus === "true" || args.bonus === true;

// ── Modul-indlæsning: nyt træ + baseline-træ ────────────────────────────────
const libDir = path.resolve(args.baseline);
const gl = (f) => import(pathToFileURL(path.join(libDir, f)).href);

// ── BASELINEN SKAL VÆRE SYNLIG I RAPPORTEN (postmortem 14/8) ────────────────
// "i dag"-modellen er et ARGUMENT, ikke en del af repoet. Den kan blive gammel uden
// at noget fejler, og outputtet ser lige så autoritativt ud uanset hvad den peger på.
// Det kostede #3741 to beslutninger på tal der ikke holdt: baseline-worktreen manglede
// trin 3, som var merget imens, så "i dag" var målt lavere end den faktisk var.
// Se .claude/learnings/2026-08-14-gaten-blev-maalt-mod-en-baseline-der-ikke-fandtes-mere.md
const baselineHead = (() => {
  try {
    return execFileSync("git", ["-C", libDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch { return null; }
})();
const baselineErMain = (() => {
  if (!baselineHead) return null;
  try {
    execFileSync("git", ["-C", libDir, "merge-base", "--is-ancestor", "origin/main", baselineHead], { stdio: "ignore" });
    return true;
  } catch { return false; }
})();
console.error(`baseline: ${libDir}${baselineHead ? ` @ ${baselineHead.slice(0, 8)}` : " (ukendt commit)"}`);
if (baselineErMain === false) {
  console.error("⚠ ADVARSEL: baselinen indeholder IKKE hele origin/main. Gaten afgør om noget maa "
    + "merges til main, saa den skal maale MOD main — ellers sammenligner du med en verden der ikke findes.");
}

const NY = {
  progression: await import("../lib/riderProgression.js"),
  daily: await import("../lib/dailyTraining.js"),
  training: await import("../lib/training.js"),
  academy: await import("../lib/academyFlag.js"),
};
const GAMMEL = {
  progression: await gl("riderProgression.js"),
  daily: await gl("dailyTraining.js"),
  training: await gl("training.js"),
  academy: await gl("academyFlag.js"),
};
if (GAMMEL.progression.ROLE_CLASS_RATE) {
  console.error("STOP: --baseline peger paa et traee der ALLEREDE har rolleklasser. Det er ikke en baseline.");
  process.exit(2);
}

const { VISIBLE_ABILITIES } = await import("../lib/abilityDerivation.js");
const { deriveAbilities } = await import("../lib/abilityDerivation.js");
const { seedPhysiologyFromLegacy } = await import("../lib/physiologySeeding.js");
const { generateAcademyCandidates } = await import("../lib/academyGenerator.js");
const { resolveRiderTypes } = await import("../lib/riderTypes.js");
const { ratingFromAbilities } = await import("../lib/scoutingReport.js");
const { ratingForRole, DISPLAY_RECIPE_KEYS } = await import("../lib/weights/displayRecipes.js");
const { conditionMultiplier } = await import("../lib/riderCondition.js");
const { predictBaseValue } = await import("../lib/riderValuation.js");

// ── Vaerdimodellen (hul 6) ──────────────────────────────────────────────────
// Trin 4 flytter IKKE markedsvaerdier ved deploy: valuationWeights laeser
// `abilities`, og abilities er urortt. Det den flytter er hvor evnerne LANDER
// over en karriere — og det er inputtet til predictBaseValue. Kaeden er
// abilities -> outputScore -> predictBaseValue -> market_value -> loennen (#3393).
// Ingen havde maalt hvad der kommer ud i den anden ende.
let VAERDI_MODEL = null;
for (const kandidat of ["../lib/riderValuationModelV4.json", "../lib/riderValuationModel.json"]) {
  try { VAERDI_MODEL = JSON.parse(readFileSync(new URL(kandidat, import.meta.url), "utf8")); break; } catch { /* naeste */ }
}

// ── Kuldet: produktionens EGEN intake-sti ───────────────────────────────────
// generateAcademyCandidates -> seedPhysiologyFromLegacy -> deriveAbilities,
// praecis som academyIntake.js goer det. Ingen syntetiske ryttere.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function byggKuld(n, seed) {
  const rng = makeRng(seed);
  const existingNames = new Set();
  const ud = [];
  while (ud.length < n) {
    const batch = generateAcademyCandidates({
      rng, referenceYear: 2026, existingNames, countOverride: Math.min(50, n - ud.length),
    });
    for (const c of batch) {
      // generateAcademyCandidates returnerer { is_serious, archetypeDraw, rider } —
      // selve rytter-raekken ligger INDLEJRET. Sendes indpakningen videre til
      // seedPhysiologyFromLegacy, faar man et degenereret evne-saet (alt paa 1) der
      // er IDENTISK for hver eneste kandidat. Det saa ud som et resultat foerste
      // gang: arketype-skarphed 1,00 og feltets forskellighed 0,00 for alle fire
      // modeller. Det var ikke et resultat, det var denne fejl.
      const rytterRow = c.rider;
      const physiology = seedPhysiologyFromLegacy(rytterRow);
      const abilities = deriveAbilities(physiology, rytterRow);
      const rene = {};
      for (const k of VISIBLE_ABILITIES) rene[k] = Number(abilities?.[k] ?? 0);
      const typer = resolveRiderTypes(c.archetypeDraw, rene);
      ud.push({
        id: `sim-${ud.length}`,
        potentiale: rytterRow.potentiale,
        primary_type: typer.primary?.key ?? c.archetypeDraw?.primary ?? "rouleur",
        secondary_type: typer.secondary?.key ?? c.archetypeDraw?.secondary ?? null,
        abilities: rene,
      });
      if (ud.length >= n) break;
    }
  }
  return ud;
}

// ── Strategier ──────────────────────────────────────────────────────────────
// Specen navngiver fire ("spids", "rotation", "standard", "forkert") men
// definerer dem ikke. Definitionerne herunder er MINE og staar i rapporten.
const FOKUS_KEYS = Object.keys(NY.training.TRAINING_FOCUSES);

function signaturFokus(mod, rytter) {
  // De fokus hvis evner rammer mindst én signatur- eller sekundaer-evne, bedst foerst.
  const score = (f) => (mod.training.TRAINING_FOCUSES[f] ?? [])
    .reduce((sum, ab) => sum + (mod.progression.youthRoleFactor(rytter.primary_type, rytter.secondary_type, ab)), 0);
  return [...FOKUS_KEYS].sort((a, b) => score(b) - score(a));
}

function planForStrategi(mod, rytter, strategi, saeson) {
  const rangeret = signaturFokus(mod, rytter);
  switch (strategi) {
    case "spids":    return { focus: rangeret[0], intensity: "hard" };
    case "rotation": return { focus: rangeret[saeson % Math.min(3, rangeret.length)], intensity: "hard" };
    case "standard": return { focus: mod.training.smartDefaultFocus(rytter.primary_type), intensity: "normal" };
    case "forkert":  return { focus: rangeret[rangeret.length - 1], intensity: "normal" };
    default: throw new Error(`ukendt strategi ${strategi}`);
  }
}

// ── Én karriere, dag for dag, gennem produktionens egen tick ────────────────
function simulerKarriere(mod, rytter, strategi, { akademi, trainingCfg }) {
  let abilities = { ...rytter.abilities };
  let progress = {};
  const condMult = mod.daily.__condMult ?? conditionMultiplier({ form: 50, fatigue: 0 });

  for (let alder = START_AGE; alder <= SLUT_AGE; alder++) {
    const saeson = alder - START_AGE;
    const program = planForStrategi(mod, rytter, strategi, saeson);
    const iAkademi = alder >= 16 && alder <= 21;
    for (let dag = 0; dag < DAGE_PR_SAESON; dag++) {
      const caps = mod.progression.buildCapsForRider(
        abilities, { potentiale: rytter.potentiale, age: alder }, rytter.primary_type, rytter.secondary_type,
      );
      const r = mod.daily.applyDailyTick({
        riderId: rytter.id,
        dateStr: `s${saeson}-d${dag}`,
        age: alder,
        abilities, caps, progress, program,
        conditionMult: condMult,
        bonus: BONUS,
        potentiale: rytter.potentiale,
        // Akademi-knapperne findes KUN i "i dag"-modellen (trin 5 fjerner dem).
        hardDailyCap: akademi && iAkademi ? akademi.hardDailyCap : undefined,
        academyRateMult: akademi && iAkademi ? akademi.rateMult : 1.0,
        staff: null, facilityTier: null, riderLevel: null,
        // Kun kandidat-modellen kender anlaegget (rolle-raten); baseline ignorerer det.
        primaryType: rytter.primary_type, secondaryType: rytter.secondary_type,
        ...(trainingCfg ? { trainingCfg } : {}),
      });
      abilities = r.abilities;
      progress = r.progress;
    }
  }
  const slutCaps = mod.progression.buildCapsForRider(
    abilities, { potentiale: rytter.potentiale, age: SLUT_AGE }, rytter.primary_type, rytter.secondary_type,
  );
  return { abilities, caps: slutCaps };
}

// ── Maal ────────────────────────────────────────────────────────────────────
const median = (v) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

function arketypeSkarphed(abilities, egenRolle) {
  const egen = ratingForRole(abilities, egenRolle);
  const bedste = Math.max(...DISPLAY_RECIPE_KEYS.map((r) => ratingForRole(abilities, r) ?? 0));
  return bedste > 0 && egen != null ? egen / bedste : null;
}

function feltetsForskellighed(alle) {
  // Gennemsnitlig parvis cosinus-AFSTAND. O(n^2) er for dyrt ved 1.200 x 4
  // strategier, saa der samples et fast, deterministisk udsnit af par.
  const vek = alle.map((a) => {
    const v = VISIBLE_ABILITIES.map((k) => Number(a[k]) || 0);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  });
  let sum = 0, n = 0;
  for (let i = 0; i < vek.length; i++) {
    for (let j = i + 1; j < vek.length; j += 7) {
      sum += 1 - vek[i].reduce((s, x, k) => s + x * vek[j][k], 0);
      n++;
    }
  }
  return n ? sum / n : 0;
}

function maal(resultater, kuld, mod) {
  const ratings = [], bedste = [], summer = [], skarphed = [], andelAfTag = [], vaerdier = [];
  let gulvVundne = 0;
  for (let i = 0; i < resultater.length; i++) {
    const { abilities, caps } = resultater[i];
    const rytter = kuld[i];
    ratings.push(ratingFromAbilities(abilities, rytter.primary_type));
    const vals = VISIBLE_ABILITIES.map((k) => Number(abilities[k]) || 0);
    bedste.push(Math.max(...vals));
    summer.push(vals.reduce((a, b) => a + b, 0));
    const s = arketypeSkarphed(abilities, rytter.primary_type);
    if (s != null) skarphed.push(s);
    // ── HUL 4, MAALE-REGLEN (ejer-godkendt 15/8) ─────────────────────────────
    // buildCapsForRider returnerer max(tapered, current). Ligger rytterens
    // nuvaerende evne OVER det tapered absolutte loft, vinder GULVET, og cap
    // bliver lig current. Forholdet er saa 1,00 per konstruktion — ikke fordi
    // rytteren naaede noget, men fordi der ikke var noget at naa.
    //
    // Saadan en evne har ikke et tag rytteren naermer sig; den har et FROSSET
    // tal. Den udelades derfor af "andel af taget naaet". Gulvet selv er URORTT
    // (ejer-beslutning 15/7: ingen rytter mister evne han ejer) — det er
    // maalingen der rettes, ikke modellen.
    //
    // Maalt paa snapshottet rammer det 0,58 evne pr. rytter i vaekstalder efter
    // trin 4, og 53 % af alle gulv-vundne pladser sidder hos ryttere over 30,
    // hvor cap === current er DESIGNET (#2472's taper faar med vilje gulvet til
    // at vinde saa vaeksten stopper og declinen dominerer alene).
    const absolut = mod.progression.buildYouthCaps(rytter.potentiale, rytter.primary_type, rytter.secondary_type);
    const peakAge = mod.progression.peakAgeForType(rytter.primary_type);
    const forhold = VISIBLE_ABILITIES.map((k) => {
      if (!(caps[k] > 0)) return null;
      const tapered = mod.progression.taperedAbsoluteCap(absolut[k] ?? 0, SLUT_AGE, peakAge);
      if ((Number(abilities[k]) || 0) > tapered) return null; // gulvet vandt
      return (Number(abilities[k]) || 0) / caps[k];
    }).filter((x) => x != null);
    andelAfTag.push(forhold.length ? median(forhold) : null);
    gulvVundne += VISIBLE_ABILITIES.length - forhold.length;
    if (VAERDI_MODEL) {
      const v = predictBaseValue(
        { primary_type: rytter.primary_type, valuation_type: rytter.primary_type, age: SLUT_AGE, potentiale: rytter.potentiale },
        abilities, VAERDI_MODEL,
      );
      if (Number.isFinite(v)) vaerdier.push(v);
    }
  }
  return {
    ratingPrRytter: ratings,
    rating: median(ratings),
    bedsteEvne: median(bedste),
    evnesum: median(summer),
    skarphed: +mean(skarphed).toFixed(2),
    andelAfTagNaaet: +median(andelAfTag.filter((x) => x != null)).toFixed(2),
    gulvVundnePladser: gulvVundne,
    forskellighed: +feltetsForskellighed(resultater.map((r) => r.abilities)).toFixed(2),
    markedsvaerdiMedian: median(vaerdier),
    markedsvaerdiSum: vaerdier.reduce((a, b) => a + b, 0),
  };
}

// ── Modellerne der maales ───────────────────────────────────────────────────
// #3709 trin 5 FJERNER disse to fra ACADEMY. De laeses derfor fra BASELINE-modulet,
// saa "i dag"- og attributions-modellerne stadig kan koere dem.
const AKADEMI_KNAPPER = Object.freeze({
  hardDailyCap: GAMMEL.academy.ACADEMY.HARD_DAILY_CAP,
  rateMult: GAMMEL.academy.ACADEMY.INTERIM_RATE_MULT,
});
if (!Number.isFinite(AKADEMI_KNAPPER.rateMult)) {
  console.error("STOP: baseline-modulet har ikke ACADEMY.INTERIM_RATE_MULT — 'i dag'-modellen kan ikke bygges.");
  process.exit(2);
}

const MODELLER = [
  { navn: "i dag", mod: GAMMEL, akademi: AKADEMI_KNAPPER, trainingCfg: null },
  { navn: "kandidat", mod: NY, akademi: null, trainingCfg: null },
  // Attributionen: beviser at trin 5 er BAERENDE, ikke oprydning. Knapperne findes
  // ikke laengere i NY.academy, saa vaerdierne laeses fra BASELINE-modulet.
  { navn: "kandidat + akademiets 1/3", mod: NY, akademi: AKADEMI_KNAPPER, trainingCfg: null },
  {
    navn: "negativ-test (offFocusMult 0,97)",
    mod: NY, akademi: null,
    trainingCfg: { ...NY.training.TRAINING_CONFIG, offFocusMult: 0.97 },
  },
];
const STRATEGIER = ["spids", "rotation", "standard", "forkert"];

const kuld = byggKuld(N, SEED);
const startRating = median(kuld.map((r) => ratingFromAbilities(r.abilities, r.primary_type)));
const startBedste = median(kuld.map((r) => Math.max(...VISIBLE_ABILITIES.map((k) => r.abilities[k]))));

const tabel = {};
for (const m of MODELLER) {
  tabel[m.navn] = {};
  for (const strategi of STRATEGIER) {
    const res = kuld.map((r) => simulerKarriere(m.mod, r, strategi, {
      akademi: m.akademi, trainingCfg: m.trainingCfg,
    }));
    tabel[m.navn][strategi] = maal(res, kuld, m.mod);
  }
  // BEDSTE OPNAAELIGE pr. rytter, paa tvaers af strategier.
  //
  // Den foerste udgave af G2 sammenlignede "spids mod spids" og maalte derfor det
  // forkerte: `spids` er IKKE altid det bedste spil. Maalt paa en aegte rytter
  // (Tommaso Valli, tt + baroudeur) SKADER spidsning ham — hans enkeltstart falder
  // fra 77 til 71, fordi fokusset skubber ham mod baroudeur-siden, mens rotation
  // giver ham 85. En rytter med anlaeg der peger hver sin vej skal spilles bredt.
  //
  // "Hvad kan en dygtig manager opnaa" er derfor et maksimum pr. RYTTER, ikke en
  // fast strategi paalagt hele feltet. At vaelge den rigtige strategi til den
  // rytter man har, ER spillet.
  {
    const pr = STRATEGIER.map((st) => tabel[m.navn][st].ratingPrRytter);
    const bedste = kuld.map((_, i) => Math.max(...pr.map((v) => v[i] ?? -Infinity)));
    tabel[m.navn].bedsteOpnaaelige = median(bedste);
  }
}

// ── Rapport ─────────────────────────────────────────────────────────────────
const L = [];
const p = (s) => { L.push(s); console.log(s); };
const spaend = (r, felt) => (r.spids[felt] - r.forkert[felt]);

p("# Flow-scorecard — #3709 trin 4 + 5");
p("");
p(`Kuld: ${N} ryttere genereret gennem produktionens EGEN intake-sti`);
p("(`generateAcademyCandidates` → `seedPhysiologyFromLegacy` → `deriveAbilities`),");
p(`simuleret dag for dag fra ${START_AGE} til ${SLUT_AGE} aar gennem \`applyDailyTick\`. Seed ${SEED}.`);
p(`Start ved ${START_AGE} aar: rating-median ${startRating}, bedste evne ${startBedste}.`);
p("");
p("**Harnessen har ingen egen vaekstformel.** Den kalder produktionens `applyDailyTick`");
p("direkte med de parametre `dailyTrainingEngine.js` sender. \"Bit-identisk\" er derfor");
p("en egenskab ved konstruktionen, ikke noget der skal bevises.");
p("");
p("## Rating ved 30 aar (median, `ratingFromAbilities`)");
p("");
p("| Model | spids | rotation | standard | forkert | spaend | bedste opnaaelige |");
p("|---|---:|---:|---:|---:|---:|---:|");
for (const m of MODELLER) {
  const r = tabel[m.navn];
  p(`| ${m.navn} | ${r.spids.rating} | ${r.rotation.rating} | ${r.standard.rating} | ${r.forkert.rating} | **${spaend(r, "rating")}** | **${r.bedsteOpnaaelige}** |`);
}
p("");
p("`bedste opnaaelige` er maksimum pr. RYTTER paa tvaers af strategier, ikke den bedste");
p("kolonne. En rytter med anlaeg der peger hver sin vej skal spilles bredt, en med anlaeg");
p("der traekker samme vej skal spidses — at vaelge rigtigt til den rytter man har, ER spillet.");
p("");
p("## Bedste evne ved 30 aar (median)");
p("");
p("| Model | spids | rotation | standard | forkert |");
p("|---|---:|---:|---:|---:|");
for (const m of MODELLER) {
  const r = tabel[m.navn];
  p(`| ${m.navn} | ${r.spids.bedsteEvne} | ${r.rotation.bedsteEvne} | ${r.standard.bedsteEvne} | ${r.forkert.bedsteEvne} |`);
}
p("");
p("## Andel af taget naaet (median) — beslutning 6");
p("");
p("Evner hvor GULVET vandt (`max(tapered, current)` giver `cap === current`) er UDELADT,");
p("ejer-godkendt 15/8. De har ikke et tag rytteren naermer sig, men et frosset tal, og");
p("ville taelle som 1,00 per konstruktion. Gulvet selv er urortt. Se");
p("`docs/audits/2026-08-15-3709-hul4-arvede-ryttere-over-formel-loftet.md`.");
p("");
p("| Model | spids | rotation | standard | forkert |");
p("|---|---:|---:|---:|---:|");
for (const m of MODELLER) {
  const r = tabel[m.navn];
  p(`| ${m.navn} | ${r.spids.andelAfTagNaaet} | ${r.rotation.andelAfTagNaaet} | ${r.standard.andelAfTagNaaet} | ${r.forkert.andelAfTagNaaet} |`);
}
p("");
p("## Evnesum ved 30 aar (median)");
p("");
p("| Model | spids | rotation | standard | forkert |");
p("|---|---:|---:|---:|---:|");
for (const m of MODELLER) {
  const r = tabel[m.navn];
  p(`| ${m.navn} | ${r.spids.evnesum} | ${r.rotation.evnesum} | ${r.standard.evnesum} | ${r.forkert.evnesum} |`);
}
p("");
p("## Markedsvaerdi ved 30 aar (hul 6) — `predictBaseValue` paa de simulerede evner");
p("");
p("Trin 4 flytter INGEN markedsvaerdier ved deploy: modellen laeser `abilities`, og de er");
p("urortt. Tabellen her er den LANGE effekt — hvor evnerne lander efter en hel karriere.");
p("");
p("| Model | spids | rotation | standard | forkert |");
p("|---|---:|---:|---:|---:|");
for (const m of MODELLER) {
  const r = tabel[m.navn];
  p(`| ${m.navn} | ${r.spids.markedsvaerdiMedian} | ${r.rotation.markedsvaerdiMedian} | ${r.standard.markedsvaerdiMedian} | ${r.forkert.markedsvaerdiMedian} |`);
}
{
  const i = tabel["i dag"].spids.markedsvaerdiMedian, k = tabel["kandidat"].spids.markedsvaerdiMedian;
  if (Number.isFinite(i) && Number.isFinite(k) && i > 0) {
    p("");
    p(`**Delta ved bedste spil: ${(((k - i) / i) * 100).toFixed(1)} %** (median, ${i} → ${k}).`);
    const iS = tabel["i dag"].standard.markedsvaerdiMedian, kS = tabel["kandidat"].standard.markedsvaerdiMedian;
    p(`**Delta ved standard-spil: ${(((kS - iS) / iS) * 100).toFixed(1)} %** (median, ${iS} → ${kS}) — det er tallet oekonomien reelt vil se.`);
  }
}
p("");
p("## ⚠ Mål med REKONSTRUEREDE definitioner");
p("");
p("Specen opgiver tal for de to nedenfor, men ikke formlerne — trin 0's harness blev");
p("aldrig committet. Definitionerne her er MINE. **Retningen** kan sammenlignes med");
p("specen; de **absolutte tal** kan ikke.");
p("");
p("- *Arketype-skarphed*: rytterens rating i SIN EGEN rolle / hans bedste rating i nogen rolle.");
p("- *Feltets forskellighed*: gennemsnitlig parvis cosinus-afstand mellem normaliserede evne-vektorer.");
p("");
p("| Model | skarphed spids | skarphed rotation | skarphed forkert | skarphed-spaend | forskellighed (bedste) |");
p("|---|---:|---:|---:|---:|---:|");
for (const m of MODELLER) {
  const r = tabel[m.navn];
  const bedsteForsk = Math.max(...STRATEGIER.map((s) => r[s].forskellighed));
  p(`| ${m.navn} | ${r.spids.skarphed} | ${r.rotation.skarphed} | ${r.forkert.skarphed} | **${(r.spids.skarphed - r.forkert.skarphed).toFixed(2)}** | ${bedsteForsk} |`);
}

// ── Gates ───────────────────────────────────────────────────────────────────
const kandidat = tabel["kandidat"];
const negativ = tabel["negativ-test (offFocusMult 0,97)"];
const idag = tabel["i dag"];
const gates = [
  {
    navn: "G1 agens-spaend paa rating stiger markant",
    ok: spaend(kandidat, "rating") >= 2 * Math.max(1, spaend(idag, "rating")),
    detalje: `i dag ${spaend(idag, "rating")} → kandidat ${spaend(kandidat, "rating")}`,
  },
  {
    navn: "G2 ankeret holder: bedste OPNAAELIGE pr. rytter >= dagens",
    ok: kandidat.bedsteOpnaaelige >= idag.bedsteOpnaaelige,
    detalje: `i dag ${idag.bedsteOpnaaelige} → kandidat ${kandidat.bedsteOpnaaelige} `
      + `(pr. rytter, bedste af ${STRATEGIER.join("/")} — IKKE spids mod spids)`,
  },
  {
    navn: "G3 ryttere naar IKKE deres lofter (beslutning 6)",
    ok: kandidat.spids.andelAfTagNaaet < 1.0,
    detalje: `i dag ${idag.spids.andelAfTagNaaet} → kandidat ${kandidat.spids.andelAfTagNaaet}`,
  },
  {
    navn: "G4 NEGATIV-TEST: kun offFocusMult uaendret SKAL give markant mindre agens",
    ok: spaend(negativ, "rating") < spaend(kandidat, "rating"),
    detalje: `kandidat ${spaend(kandidat, "rating")} → negativ-test ${spaend(negativ, "rating")}`,
  },
  {
    navn: "G5 ATTRIBUTION: akademiets 1/3 beholdt SKAL koste rating (trin 5 er baerende)",
    ok: tabel["kandidat + akademiets 1/3"].spids.rating < kandidat.spids.rating,
    detalje: `kandidat ${kandidat.spids.rating} → med 1/3 ${tabel["kandidat + akademiets 1/3"].spids.rating}`,
  },
];

p("");
p("## Gates");
p("");
p("| # | Gate | Resultat |");
p("|---|---|---|");
for (const g of gates) p(`| ${g.navn.split(" ")[0]} | ${g.navn.replace(/^\S+ /, "")} | ${g.ok ? "✅" : "❌"} ${g.detalje} |`);

if (args.json) writeFileSync(path.resolve(args.json), JSON.stringify({ n: N, seed: SEED, startRating, startBedste, tabel, gates }, null, 2));

const fejlede = gates.filter((g) => !g.ok);
if (fejlede.length) {
  console.error(`\n❌ ${fejlede.length} gate(s) fejlede — intet maa muteres.`);
  process.exit(1);
}
void readFileSync;
