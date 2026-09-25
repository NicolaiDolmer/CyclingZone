#!/usr/bin/env node
// check-workflow-checkout.mjs (#5441)
//
// Baggrund: CodeRabbit-CLI flagede 11/9 (spor #5160, PR #5165) at et nyt CI-job manglede
// `persist-credentials: false` på sin `actions/checkout`. Fundet blev afvist som støj i den
// PR, fordi det gjaldt hele repoet og ikke kunne løses med én linje. Målt 20/9: 37
// workflow-filer brugte `actions/checkout`, og kun 11 linjer i alt satte
// `persist-credentials` eksplicit. Uden den bliver `GITHUB_TOKEN` liggende i `.git/config`
// resten af jobbet, så ethvert senere step (også tredjeparts-actions og npm-scripts) kan
// læse den ud af repoet.
//
// Reglen denne guard håndhæver:
//   1. Ethvert `actions/checkout`-step skal have et eksplicit `persist-credentials`
//      (`true` eller `false`) i sin `with:`-blok. Intet default-flag tilladt.
//   2. `persist-credentials: true` er kun tilladt i en workflow-fil på ALLOWLIST'en
//      nedenfor — de få jobs der selv pusher/committer/opretter PR'er i samme job og
//      derfor har brug for at git-legitimationen lever videre. Alt andet skal være
//      `false`. En ny fil der sætter `true` uden at stå på listen fejler CI, så et
//      fremtidigt "det er nemmere at lade den stå på default" ikke kan snige sig ind
//      ubemærket.
//
// Brug:
//   node scripts/ci/check-workflow-checkout.mjs          # exit 1 ved fund
//   node scripts/ci/check-workflow-checkout.mjs --warn   # rapportér, exit 0

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_DIR = ".github/workflows";

// Filer hvor mindst ét job selv pusher/committer/opretter en PR i samme job og derfor har
// brug for at GITHUB_TOKEN'et fra checkout lever videre i .git/config:
//   - claude.yml: `permissions: contents: write`, Claude Code-agenten pusher branches og
//     kører `gh pr create` som en del af sin egen instruks.
//   - weekly-steering-report.yml: `publish`-jobbet kører `git commit` + `git push
//     origin HEAD:main` for at lande den ugentlige styringsrapport.
// Nye tilføjelser til denne liste kræver en tilsvarende begrundelse i selve workflowen
// (kommentar ved siden af `persist-credentials: true`).
const ALLOW_TRUE = new Set(["claude.yml", "weekly-steering-report.yml"]);

/**
 * Find alle `actions/checkout`-steps i teksten. For hvert step: indryknings-niveauet af
 * `-`-markøren, om der findes en `with:`-blok, og om den indeholder `persist-credentials`
 * og dens værdi (streng, "true"/"false", eller null hvis fraværende).
 */
export function findCheckoutSteps(text) {
  const lines = text.split(/\r?\n/);
  const steps = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/uses:\s*actions\/checkout@/.test(line)) continue;

    // Find dash-indrykningen ved at scanne baglæns til nærmeste "- " linje.
    let dashIndent = null;
    for (let k = i; k >= 0; k--) {
      const s = lines[k];
      const stripped = s.replace(/^ +/, "");
      if (stripped.startsWith("- ")) {
        dashIndent = s.length - stripped.length;
        break;
      }
    }
    if (dashIndent === null) {
      const stripped = line.replace(/^ +/, "");
      dashIndent = line.length - stripped.length - 2;
    }
    const withIndent = dashIndent + 2;
    const pcIndent = withIndent + 2;

    let hasWith = false;
    let persistCredentials = null;
    let j = i + 1;
    while (j < lines.length) {
      const nxt = lines[j];
      const stripped = nxt.trim();
      if (stripped === "") {
        j++;
        continue;
      }
      const nxtIndent = nxt.length - nxt.replace(/^ +/, "").length;
      if (nxtIndent < withIndent) break;
      if (nxtIndent === withIndent && stripped.startsWith("with:")) {
        hasWith = true;
        j++;
        continue;
      }
      if (nxtIndent === withIndent && !stripped.startsWith("with:")) break;
      if (hasWith && nxtIndent >= pcIndent) {
        if (stripped.startsWith("persist-credentials:")) {
          persistCredentials = stripped.split(":", 2)[1].trim();
        }
        j++;
        continue;
      }
      break;
    }

    steps.push({ line: i + 1, hasWith, persistCredentials });
  }
  return steps;
}

export function checkWorkflowCheckouts(dir = WORKFLOW_DIR) {
  const findings = [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    const steps = findCheckoutSteps(text);

    for (const step of steps) {
      if (step.persistCredentials === null) {
        findings.push({
          file,
          line: step.line,
          rule: "missing-persist-credentials",
          why: "actions/checkout mangler et eksplicit persist-credentials (true eller false) i sin with:-blok.",
        });
        continue;
      }
      if (step.persistCredentials === "true" && !ALLOW_TRUE.has(file)) {
        findings.push({
          file,
          line: step.line,
          rule: "unallowed-persist-credentials-true",
          why: `persist-credentials: true er kun tilladt for filer på allowlisten i scriptet (${[...ALLOW_TRUE].join(", ")}). ${file} pusher ikke i samme job, så sæt den til false — eller tilføj filen til ALLOW_TRUE med en begrundelse, hvis den reelt skal pushe.`,
        });
      }
    }
  }
  return findings;
}

const isMain = process.argv[1] && process.argv[1].endsWith("check-workflow-checkout.mjs");
if (isMain) {
  const warnOnly = process.argv.includes("--warn");
  const findings = checkWorkflowCheckouts();

  if (findings.length === 0) {
    console.log("workflow-checkout: alle actions/checkout-steps har eksplicit persist-credentials, og alle true-undtagelser er allowlistet");
    process.exit(0);
  }

  console.error(`workflow-checkout: ${findings.length} checkout-step(s) overtræder persist-credentials-reglen\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]`);
    console.error(`    ${f.why}\n`);
  }
  console.error("Ret med en eksplicit with:\n  persist-credentials: false\npå checkout-steppet (eller true + allowlist-begrundelse, hvis jobbet selv pusher).");
  process.exit(warnOnly ? 0 : 1);
}
