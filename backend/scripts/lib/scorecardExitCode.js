// #3009 — fælles hjælper der garanterer at et scorecard/harness' HEADLINE-
// verdikt rent faktisk styrer processens exit-kode.
//
// Root cause (#3009): moneySupplyScorecard.js og inflationScorecard.js printede
// "HEADLINE: ... ❌ FAIL" men exitede altid 0 (kommentaren i filhovedet sagde
// eksplicit "Report-pattern (ingen exit(1))" — en bevidst pre-relaunch-beslutning
// der aldrig blev revideret efter launch). Et grønt npm-run/CI-tjek betød derfor
// ingenting: al balance-måling der stoler på $?/exit-koder blev usynligt løjet for.
//
// Denne fil er den ENE plads der afgør "hvad betyder allPass for exit-koden" —
// alle scorecards der bruger den er per konstruktion immune over for at
// FAIL-uden-exit-1-bugget genopstår (se scorecardExitCode.test.js).
//
// Brug:
//   process.exitCode = gateExitCode(allPass);
//   process.exitCode = gateExitCode(allPass, { advisory });  // --advisory-flag
export function gateExitCode(pass, { advisory = false } = {}) {
  return pass || advisory ? 0 : 1;
}
