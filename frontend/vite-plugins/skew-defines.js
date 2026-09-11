// Beregner de to `define`-værdier Vercel Skew Protection har brug for —
// deployment-id og build-tidspunkt (#5170, rod-årsag H1 i chunk-rotations-
// auditten, epic #5162).
//
// HVORFOR DEN HER FIL FINDES
//
// `vite.config.js` gatede tidligere KUN på Vercels env:
//
//     const skewProtectionEnabled =
//       process.env.VERCEL_SKEW_PROTECTION_ENABLED === "1" && process.env.VERCEL_ENV === "production";
//     const skewBuildTime = skewDeploymentId ? Date.now() : 0;
//
// Vercels dashboard-toggle for Skew Protection står stadig TIL (docs/DEPLOYMENT.md),
// så env'en er sat på hvert eneste production-build — men KODE-flaget
// `SKEW_PROTECTION_ENABLED` i `src/lib/skewProtection.js` har været `false` siden
// hotfixet 4/9, så `installSkewProtection()` aldrig kaldes. Resultatet var det
// værste af to verdener: `Date.now()` og deployment-id'et blev bagt ind i
// modulindholdet ved HVERT deploy, Rollup hashede chunkene FØR dead-code-
// elimineringen kunne nå at fjerne den ubrugte kode, og 77 af 200 JS-chunks
// skiftede filnavn pr. deploy uden en eneste linje frontend-diff. Åbne faner
// ramte 404 på chunks (CYCLINGZONE-56).
//
// Målt lokalt med `scripts/compare-build-manifests.mjs` (11/9):
//   uden skew-env: 677 identiske / 0 udskiftet
//   med skew-env:  523 identiske / 154 udskiftet
//
// LØSNINGEN: de deploy-unikke værdier må kun være deploy-unikke når koden
// faktisk BRUGER dem. Derfor gates de nu på BÅDE kode-flaget og env'en. Er
// kode-flaget `false`, er buildet bit-for-bit uafhængigt af deployment-id og
// build-tidspunkt — præcis som et lokalt build.
//
// Funktionen er ren og tager env + flag som argumenter, så den kan unit-testes
// uden at bygge (se `skew-defines.test.js`).

/**
 * @typedef {object} SkewDefines
 * @property {string} deploymentId  Værdien bag `__CZ_SKEW_DEPLOYMENT_ID__` ("" = slået fra)
 * @property {number} buildTime     Værdien bag `__CZ_SKEW_BUILD_TIME__` (0 = slået fra)
 */

/**
 * @param {object} opts
 * @param {Record<string, string|undefined>} [opts.env]  Typisk `process.env`.
 * @param {boolean} [opts.codeFlag]  `SKEW_PROTECTION_ENABLED` fra src/lib/skewProtection.js.
 * @param {() => number} [opts.now]  Injicérbar klokke (test).
 * @returns {SkewDefines}
 */
export function computeSkewDefines({ env = {}, codeFlag = false, now = Date.now } = {}) {
  // `=== true` og ikke bare truthy: flaget er SSOT, og en utilsigtet streng
  // ("false", "0") må aldrig kunne tænde deploy-unikke bytes igen.
  const codeEnabled = codeFlag === true;

  // KUN PRODUCTION. Preview-deploys må ALDRIG pinnes: ejeren tester rettelser på
  // samme branch-alias, og en pinnet klient ville hænge fast på det gamle
  // preview-build. Værre: previews fjernes rutinemæssigt af retention, og en
  // cookie der peger på et slettet deployment giver en HÅRD 404 uden selvheling.
  // Derfor kræves både Vercels toggle OG `VERCEL_ENV === "production"`.
  const envEnabled =
    env.VERCEL_SKEW_PROTECTION_ENABLED === "1" && env.VERCEL_ENV === "production";

  const deploymentId = codeEnabled && envEnabled ? env.VERCEL_DEPLOYMENT_ID || "" : "";
  // Build-tidspunktet er kun meningsfuldt sammen med et id (cookiens Max-Age
  // regnes fra det). Uden id ville det være en ren deploy-unik byte uden nytte.
  const buildTime = deploymentId ? now() : 0;

  return { deploymentId, buildTime };
}
