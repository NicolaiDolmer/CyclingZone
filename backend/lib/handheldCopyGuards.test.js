// #3681 · Drift-vagt for de håndholdte kopier der LOVER synkronisering i en
// kommentar men ikke havde noget til at håndhæve det.
//
// Baggrund: #3665 fandt at frontendens `RATING_TYPE_WEIGHTS` havde ligget
// drevet fra backend-kilden i ni dage bag kommentaren "Holdes manuelt i sync
// med backend". Postmortemet
// (.claude/learnings/2026-08-13-haandholdt-frontend-kopi-drev-uden-at-noget-fejlede.md)
// skrev selv at backwards-checket manglede. Det er denne fil.
//
// Princippet fra postmortemet: **når to steder skal være ens, skal det ene
// udledes af det andet.** Hvor en generator ikke er prisen værd (en enkelt
// konstant, en enum-liste), er næstbedste at TESTE VÆRDIERNE — ikke formen.
// Hver vagt herunder læser BEGGE sider og sammenligner det der faktisk kan
// drive: tallene og nøglerne. En strukturtest ville have været grøn hele vejen
// gennem #3665's drift.
//
// Hvorfor backend-tests: `backend-tests` er et required check (jf.
// .github/workflows/ci.yml + auto-merge.yml), og en backend-test kan importere
// frontend-moduler direkte — samme repo, samme Node-ESM-loader. Modsat vej
// findes præcedensen allerede i frontend/src/lib/rulesNumbers.test.js.
//
// To teknikker, valgt pr. par:
//   1. IMPORT — når begge moduler er afhængighedslette (rene .js-konstanter).
//      Stærkest: den sammenligner de faktiske runtime-værdier.
//   2. KILDE-SCAN — når import ville trække runtime-afhængigheder ind som
//      ikke hører hjemme i en test (billingCheckout → alunta/sentry,
//      marketValues → intl → i18next, ProUpgradePage → JSX/React). Samme
//      mønster som backend/lib/discordSettingsAdminRoutes.test.js.
//
// Vagter der IKKE står her, fordi kopien allerede er dækket andetsteds:
//   - abilities/displayRecipes  → backend/lib/abilityRegistryGuards.test.js (#3665)
//   - rulesNumbers              → frontend/src/lib/rulesNumbers.test.js
//   - raceClassificationTotals  → frontend/src/lib/raceClassificationTotals.test.js
//   - board-bånd                → backend/lib/boardEvaluation.test.js + boardUtils.test.js
//   - cron-monitor-slugs        → backend/cron.monitorCoverage.test.js
//   - raceReport-variantantal   → frontend/src/lib/raceReport.test.js
//   - staffSeverance            → frontend/src/lib/staffSeverance.parity.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── Backend-kilder ───────────────────────────────────────────────────────────
import { TRAINING_FOCUSES } from "./training.js";
import { BREAKAWAY_BONUS } from "./raceSimulator.js";
import { PROFILE_TYPES, FINALE_TYPES, DEMAND_VECTORS, ABILITY_DIMENSIONS } from "./raceStageProfileGenerator.js";
import { RIDER_TYPE_KEYS as BACKEND_RIDER_TYPE_KEYS } from "./riderTypes.js";
import { SALARY_RATE_PROD as BACKEND_SALARY_RATE_PROD } from "./economyConstants.js";
import { computeIsPro as backendComputeIsPro, SUBSCRIPTION_ACTIVE_STATUSES } from "./entitlement.js";
import * as backendNameSearch from "./riderNameSearch.js";

// ── Frontend-kopier (afhængighedslette moduler) ──────────────────────────────
import { TRAINING_FOCUS_ABILITIES } from "../../frontend/src/lib/training.js";
import { BREAKAWAY_STRENGTH, strengthFromBonus } from "../../frontend/src/lib/roleHint.js";
import { TACTICAL_DEMAND } from "../../frontend/src/lib/selectionDrivers.js";
import { SUITABILITY_ABILITY_KEYS } from "../../frontend/src/lib/suitability.js";
import { PROFILE_TYPE_KEYS, FINALE_TYPE_KEYS } from "../../frontend/src/lib/stageProfileConfig.js";
import { RIDER_TYPE_KEYS as FRONTEND_RIDER_TYPE_KEYS } from "../../frontend/src/lib/riderTypeKeys.js";
import { TERMS_VERSION } from "../../frontend/src/lib/termsVersion.js";
import { computeIsPro as frontendComputeIsPro } from "../../frontend/src/lib/proEntitlement.js";
import { MOMENT_TYPES, MOMENT_VARIANT_COUNT } from "../../frontend/src/lib/trainingMoment.js";
import * as frontendNameSearch from "../../frontend/src/lib/riderNameSearch.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relPath) => readFileSync(join(REPO_ROOT, relPath), "utf8");

// Kilde-scan-hjælpere ────────────────────────────────────────────────────────
// Finder ÉN `const NAME = <literal>;`-tildeling og returnerer literalen som
// rå tekst. Kaster hvis navnet mangler, så en omdøbning fejler HØJT i stedet
// for at gøre vagten tavst virkningsløs (samme fælde som en spec der
// hardkoder sin egen kopi af det den skulle bevogte).
function scalarLiteral(relPath, name) {
  const src = read(relPath);
  const match = new RegExp(`(?:export\\s+)?const ${name}\\s*=\\s*([^;\\n]+);`).exec(src);
  assert.ok(match, `${relPath}: fandt ikke 'const ${name} = ...;' — er konstanten omdøbt eller fjernet?`);
  return match[1].trim();
}

// Finder `const NAME = { ... };` og parser objekt-literalen som JSON. Kun
// beregnet til rene data-literaler (tal/strenge/nestede objekter) uden
// kommentarer — præcis den slags håndholdte tabeller vagten findes for.
function objectLiteral(relPath, name) {
  const src = read(relPath);
  const start = src.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${relPath}: fandt ikke 'const ${name} = {' — er tabellen omdøbt eller fjernet?`);
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { end = i + 1; break; }
  }
  assert.notEqual(end, -1, `${relPath}: ubalancerede tuborgklammer i ${name}`);
  const json = src.slice(open, end)
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*|\d+)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, "$1"); // JS tillader trailing comma, JSON gør ikke
  return JSON.parse(json);
}

// ── 1) Træningsfokus → evner ────────────────────────────────────────────────
// frontend/src/lib/training.js:9 lover "matcher backend TRAINING_FOCUSES".
// Kopien driver hvilke evner spilleren FÅR AT VIDE et fokus træner; backend-
// tabellen driver hvilke evner der faktisk skubbes mod loft. Drift her ville
// være #3665 igen, bare i træningsfladen i stedet for rating-fladen.
test("#3681 · TRAINING_FOCUS_ABILITIES (frontend) matcher TRAINING_FOCUSES (backend)", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(TRAINING_FOCUS_ABILITIES)),
    JSON.parse(JSON.stringify(TRAINING_FOCUSES)),
    "frontend/src/lib/training.js TRAINING_FOCUS_ABILITIES skal være identisk med backend/lib/training.js TRAINING_FOCUSES",
  );
});

// ── 2) Udbruds-styrke ───────────────────────────────────────────────────────
// frontend/src/lib/roleHint.js:39 lover "Spejl af raceSimulator.BREAKAWAY_BONUS,
// men hvert tal forud-mappet til sit styrke-bånd". Vagten UDLEDER båndene fra
// backend-tallene med frontendens egen strengthFromBonus og sammenligner —
// så både et nyt terræn, en ny finale-type og en re-kalibreret bonus fanges.
test("#3681 · BREAKAWAY_STRENGTH (frontend) er båndene udledt af BREAKAWAY_BONUS (backend)", () => {
  const derived = {};
  for (const [profile, finales] of Object.entries(BREAKAWAY_BONUS)) {
    derived[profile] = {};
    for (const [finale, bonus] of Object.entries(finales)) {
      derived[profile][finale] = strengthFromBonus(bonus);
    }
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(BREAKAWAY_STRENGTH)),
    derived,
    "frontend/src/lib/roleHint.js BREAKAWAY_STRENGTH skal være strengthFromBonus() anvendt på hver værdi i backend/lib/raceSimulator.js BREAKAWAY_BONUS",
  );
});

// ── 3) Taktik-efterspørgsel ─────────────────────────────────────────────────
// frontend/src/lib/selectionDrivers.js:47 lover "SPEJL af raceStageProfileGenerator.js
// DEMAND_VECTORS' tactics-vægt pr. profil (kopieret, IKKE importeret)" med
// båndene none / light (0,02-0,06) / high (0,18). Vagten udleder båndet af
// backend-vektoren, så en re-vægtning af tactics ikke kan stå og lyve i UI'et.
test("#3681 · TACTICAL_DEMAND (frontend) er båndene udledt af DEMAND_VECTORS' tactics-vægt", () => {
  const band = (weight) => {
    if (!Number.isFinite(weight) || weight <= 0) return "none";
    return weight >= 0.18 ? "high" : "light";
  };
  const derived = {};
  for (const [profile, vector] of Object.entries(DEMAND_VECTORS)) {
    derived[profile] = band(Number(vector.tactics));
  }
  assert.deepEqual(
    { ...TACTICAL_DEMAND },
    derived,
    "frontend/src/lib/selectionDrivers.js TACTICAL_DEMAND skal matche tactics-vægten i backend/lib/raceStageProfileGenerator.js DEMAND_VECTORS",
  );
});

// ── 4) Egnetheds-evner ──────────────────────────────────────────────────────
// frontend/src/lib/suitability.js:8 lover "Holdes i sync med backend" for
// terrainScore-evnerne. Rækkefølgen indgår i tooltip'ets bidrags-liste, så
// den sammenlignes også (deepEqual på arrays, ikke sæt).
test("#3681 · SUITABILITY_ABILITY_KEYS (frontend) matcher ABILITY_DIMENSIONS (backend)", () => {
  assert.deepEqual(
    [...SUITABILITY_ABILITY_KEYS],
    [...ABILITY_DIMENSIONS],
    "frontend/src/lib/suitability.js SUITABILITY_ABILITY_KEYS skal matche backend/lib/raceStageProfileGenerator.js ABILITY_DIMENSIONS",
  );
});

// ── 5) Terræn- og finale-enums ──────────────────────────────────────────────
// frontend/src/lib/stageProfileConfig.js:15 lover sync mod PROFILE_TYPES/
// FINALE_TYPES. Den eksisterende stageProfileConfig.test.js pinner mod en
// TREDJE håndholdt kopi (DB_PROFILE_TYPES inde i testen), så en ændring i
// backend-listen ville lade begge stå grønne. Her sammenlignes mod kilden.
test("#3681 · PROFILE_TYPE_KEYS/FINALE_TYPE_KEYS (frontend) matcher backend-enums", () => {
  assert.deepEqual(
    [...PROFILE_TYPE_KEYS],
    [...PROFILE_TYPES],
    "frontend/src/lib/stageProfileConfig.js PROFILE_TYPE_KEYS skal matche backend/lib/raceStageProfileGenerator.js PROFILE_TYPES",
  );
  assert.deepEqual(
    [...FINALE_TYPE_KEYS],
    [...FINALE_TYPES],
    "frontend/src/lib/stageProfileConfig.js FINALE_TYPE_KEYS skal matche backend/lib/raceStageProfileGenerator.js FINALE_TYPES",
  );
});

// ── 6) Ryttertype-nøgler ────────────────────────────────────────────────────
// frontend/src/lib/riderTypeKeys.js:1 kalder sig selv "frontend-spejl af
// RIDER_TYPE_KEYS i backend/lib/riderTypes.js". Rækkefølgen er dropdown-orden
// og backendens tie-break-prioritet — begge dele skal følges ad.
test("#3681 · RIDER_TYPE_KEYS er identiske i frontend og backend (inkl. rækkefølge)", () => {
  assert.deepEqual(
    [...FRONTEND_RIDER_TYPE_KEYS],
    [...BACKEND_RIDER_TYPE_KEYS],
    "frontend/src/lib/riderTypeKeys.js skal matche backend/lib/riderTypes.js RIDER_TYPE_KEYS",
  );
});

// ── 7) Løn-satser (kilde-scan) ──────────────────────────────────────────────
// frontend/src/lib/marketValues.js:16 skriver "SKAL holdes i sync" om
// SALARY_RATE_PROD. Modulet importerer ./intl.js → i18next, som ikke findes i
// backendens node_modules, så tabellen læses som kilde i stedet for at
// importeres. Tallene prissætter den løn spilleren SER før en signering.
test("#3681 · marketValues.SALARY_RATE_PROD (frontend) matcher economyConstants (backend)", () => {
  const frontend = objectLiteral("frontend/src/lib/marketValues.js", "SALARY_RATE_PROD");
  assert.deepEqual(
    frontend,
    JSON.parse(JSON.stringify(BACKEND_SALARY_RATE_PROD)),
    "frontend/src/lib/marketValues.js SALARY_RATE_PROD skal matche backend/lib/economyConstants.js SALARY_RATE_PROD",
  );
});

// ── 8) Pro-entitlement ──────────────────────────────────────────────────────
// backend/lib/entitlement.js:3 lover "Holdt bevidst i sync med
// frontend/src/lib/useSubscription.js (computeIsPro)" — den rene logik bor nu
// i proEntitlement.js. Vagten sammenligner ADFÆRD over hele status-matricen,
// ikke bare status-sættet: uenighed her betyder at én side viser Pro-flader
// mens den anden afviser Pro-endpoints.
test("#3681 · computeIsPro er identisk i frontend og backend over hele status-matricen", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const statuses = [...SUBSCRIPTION_ACTIVE_STATUSES, "incomplete", "unpaid", "expired", "trialing", null];

  const cases = [null, undefined, {}, { status: "active" }];
  for (const status of statuses) {
    cases.push({ status, current_period_end: future });
    cases.push({ status, current_period_end: past });
    cases.push({ status, current_period_end: null });
  }

  for (const sub of cases) {
    assert.equal(
      frontendComputeIsPro(sub),
      backendComputeIsPro(sub),
      `computeIsPro er uenig for ${JSON.stringify(sub)} — frontend/src/lib/proEntitlement.js mod backend/lib/entitlement.js`,
    );
  }
});

// ── 9) Handelsbetingelser + checkout-pause (kilde-scan) ─────────────────────
// backend/lib/billingCheckout.js:19 lover "Skal matche TERMS_VERSION i
// frontend/src/lib/termsVersion.js — mismatch afvises med 400". Et mismatch
// låser altså checkout helt. billingCheckout importerer alunta/sentry, så
// værdien læses som kilde.
test("#3681 · TERMS_VERSION (frontend) matcher CURRENT_TERMS_VERSION (backend)", () => {
  const backendVersion = scalarLiteral("backend/lib/billingCheckout.js", "CURRENT_TERMS_VERSION");
  assert.equal(
    JSON.stringify(TERMS_VERSION),
    backendVersion.replace(/'/g, '"'),
    "frontend/src/lib/termsVersion.js TERMS_VERSION skal matche backend/lib/billingCheckout.js CURRENT_TERMS_VERSION — ellers afvises alle checkouts med 400",
  );
});

// backend/lib/billingCheckout.js:15 og frontend/src/pages/ProUpgradePage.jsx:32
// lover hinanden gensidigt. Driver de fra hinanden får spilleren enten en
// købsknap der fejler med 503, eller en levende betalingsvej på en side der
// tror den er pauset.
test("#3681 · CHECKOUT_PAUSED er ens i backend og ProUpgradePage", () => {
  assert.equal(
    scalarLiteral("frontend/src/pages/ProUpgradePage.jsx", "CHECKOUT_PAUSED"),
    scalarLiteral("backend/lib/billingCheckout.js", "CHECKOUT_PAUSED"),
    "CHECKOUT_PAUSED skal være ens i frontend/src/pages/ProUpgradePage.jsx og backend/lib/billingCheckout.js",
  );
});

// ── 10) Trænings-moment-varianter mod locale-filerne ────────────────────────
// frontend/src/lib/trainingMoment.js:41 lover "keep in sync with the locale
// files". variantIndex vælger modulo MOMENT_VARIANT_COUNT, så ét manglende
// _3-suffiks i én locale giver spilleren en RÅ i18n-nøgle i træningsfeeden.
// Nøglen bygges som `moment${capitalize(type)}_${variant}` i
// frontend/src/components/training/TrainingMoment.jsx.
test("#3681 · MOMENT_VARIANT_COUNT matcher antallet af skabeloner i alle locales", () => {
  for (const locale of ["en", "da"]) {
    const messages = JSON.parse(read(`frontend/public/locales/${locale}/training.json`));
    for (const type of Object.values(MOMENT_TYPES)) {
      const prefix = `moment${type[0].toUpperCase()}${type.slice(1)}_`;
      const variants = Object.keys(messages).filter((k) => k.startsWith(prefix));
      assert.equal(
        variants.length,
        MOMENT_VARIANT_COUNT,
        `${locale}/training.json har ${variants.length} '${prefix}*'-skabeloner, men MOMENT_VARIANT_COUNT er ${MOMENT_VARIANT_COUNT} — variantIndex ville ramme en manglende nøgle`,
      );
      for (let i = 0; i < MOMENT_VARIANT_COUNT; i++) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(messages, `${prefix}${i}`),
          `${locale}/training.json mangler nøglen ${prefix}${i}`,
        );
      }
    }
  }
});

// ── 11) Navnesøgning ────────────────────────────────────────────────────────
// backend/lib/riderNameSearch.js:2 lover "Spejler frontend/src/lib/
// riderNameSearch.js — to runtimes, samme kontrakt". Tokeniseringen er også
// injektions-værnet (#1338): en side der sanitizer svagere end den anden er
// ikke en kosmetisk uenighed.
test("#3681 · riderNameSearch tokeniserer og saniterer ens i frontend og backend", () => {
  const inputs = [
    "Tadej Pog", "  dobbelt   mellemrum ", "", null, undefined,
    "%wild_card%", "a,b(c)", "back\\slash", "star*", "Ø Æ å",
  ];
  for (const q of inputs) {
    assert.deepEqual(
      frontendNameSearch.nameSearchTokens(q),
      backendNameSearch.nameSearchTokens(q),
      `nameSearchTokens er uenig for ${JSON.stringify(q)}`,
    );
    assert.equal(
      frontendNameSearch.sanitizeNameToken(q),
      backendNameSearch.sanitizeNameToken(q),
      `sanitizeNameToken er uenig for ${JSON.stringify(q)}`,
    );
  }
});

// ── 12) Onboarding-ruter ────────────────────────────────────────────────────
// frontend/tests/e2e/onboarding-tour-coverage.spec.js:44 skriver "Ruten skal
// matche STEP_TARGETS i OnboardingProgressCard.jsx" — men spec'en bar sin egen
// kopi og læste aldrig tabellen, så løftet håndhævede intet. Målt 14/8 var de
// to uenige: STEP_TARGETS sendte first_squad_selected til "/races" (opløst i
// #3102 → redirect til /resultater), mens spec'en brugte "/planning", hvor
// tourens anker faktisk bor. Vagten læser nu BEGGE sider.
test("#3681 · STEP_TARGETS matcher ruterne i onboarding-tour-spec'en", () => {
  const stepTargets = objectLiteral("frontend/src/components/OnboardingProgressCard.jsx", "STEP_TARGETS");
  const specSrc = read("frontend/tests/e2e/onboarding-tour-coverage.spec.js");

  const specRoutes = {};
  const ROUTE_RE = /(\w+):\s*\{\s*route:\s*"([^"]+)"/g;
  let match;
  while ((match = ROUTE_RE.exec(specSrc))) specRoutes[match[1]] = match[2];

  assert.ok(
    Object.keys(specRoutes).length > 0,
    "onboarding-tour-coverage.spec.js: fandt ingen { route: \"...\" }-entries — er STEP_ROUTE_AND_FIRST_ANCHOR omskrevet?",
  );
  assert.deepEqual(
    stepTargets,
    specRoutes,
    "frontend/src/components/OnboardingProgressCard.jsx STEP_TARGETS skal matche STEP_ROUTE_AND_FIRST_ANCHOR-ruterne i frontend/tests/e2e/onboarding-tour-coverage.spec.js",
  );
});

// ── #3762 · dagstype-modellen findes to steder og skal ikke kunne drive ──────
// Fladen bygger trin 2 af sin egen kopi, og serveren validerer imod sin. Hvis
// de to lister divergerer, kan panelet tilbyde en session serveren afviser —
// præcis den klasse fejl #3681-familien findes for at fange.
import * as beDayTypes from "./trainingDayTypes.js";
import * as feDayTypes from "../../frontend/src/lib/trainingDayTypes.js";

test("#3762 · dagstyper, sessioner og deres intensiteter er identiske i frontend og backend", () => {
  assert.deepEqual([...feDayTypes.DAY_TYPES], [...beDayTypes.DAY_TYPES], "DAY_TYPES");
  assert.deepEqual([...feDayTypes.SKILL_SESSIONS], [...beDayTypes.SKILL_SESSIONS], "SKILL_SESSIONS");
  assert.deepEqual(
    JSON.parse(JSON.stringify(feDayTypes.TRAINING_SESSIONS_BY_LEVEL)),
    JSON.parse(JSON.stringify(beDayTypes.TRAINING_SESSIONS_BY_LEVEL)),
    "TRAINING_SESSIONS_BY_LEVEL",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(feDayTypes.SESSION_INTENSITY)),
    JSON.parse(JSON.stringify(beDayTypes.SESSION_INTENSITY)),
    "SESSION_INTENSITY",
  );
  assert.equal(feDayTypes.RECOVERY_FOCUS, beDayTypes.RECOVERY_FOCUS);
  assert.equal(feDayTypes.RECOVERY_INTENSITY, beDayTypes.RECOVERY_INTENSITY);
});

test("#3762 · de to dayTypeForProgram-implementeringer er enige om ALLE par", () => {
  const focuses = [...Object.keys(beDayTypes.SESSION_INTENSITY), beDayTypes.RECOVERY_FOCUS, "opfundet"];
  const intensities = ["easy", "normal", "hard", "rest", "recovery"];
  for (const focus of focuses) {
    for (const intensity of intensities) {
      const program = { focus, intensity };
      assert.equal(
        feDayTypes.dayTypeForProgram(program),
        beDayTypes.dayTypeForProgram(program),
        `${focus} + ${intensity}`,
      );
      assert.equal(
        feDayTypes.sessionForProgram(program),
        beDayTypes.sessionForProgram(program),
        `${focus} + ${intensity} (session)`,
      );
    }
  }
});
