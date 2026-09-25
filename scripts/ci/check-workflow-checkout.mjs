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
//   2. `persist-credentials` sat til andet end PRÆCIS `false` er kun tilladt for det
//      specifikke `fil:job`-par på ALLOWLIST'en nedenfor — de få jobs der selv
//      pusher/committer/opretter PR'er i samme job og derfor har brug for at
//      git-legitimationen lever videre. Alt andet skal være `false`. Tjekket er
//      "alt der ikke er eksakt false skal være allowlistet", ikke "alt der er eksakt
//      true skal afvises" — en fremtidig `true # begrundelse`, et citeret `'true'`
//      eller et udtryk der evaluerer til true ville ellers snige sig forbi et
//      strengt `=== "true"`-tjek (CodeRabbit-fund #5441, rettet efter CLI-runden).
//      Allowlisten er scoped til `fil:job`, ikke hele filen — en fil på listen
//      betyder IKKE at ethvert nyt job i den fil automatisk må beholde true.
//
// Brug:
//   node scripts/ci/check-workflow-checkout.mjs          # exit 1 ved fund
//   node scripts/ci/check-workflow-checkout.mjs --warn   # rapportér, exit 0

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_DIR = ".github/workflows";

// `fil:job`-par hvor DETTE specifikke job selv pusher/committer/opretter en PR i
// samme job og derfor har brug for at GITHUB_TOKEN'et fra checkout lever videre i
// .git/config. Andre jobs i samme fil er IKKE automatisk dækket.
//   - claude.yml (job "claude"): `permissions: contents: write`, Claude Code-agenten
//     pusher branches og kører `gh pr create` som en del af sin egen instruks.
//   - weekly-steering-report.yml (job "publish"): kører `git commit` + `git push
//     origin HEAD:main` for at lande den ugentlige styringsrapport. Jobbet "report" i
//     samme fil pusher IKKE og skal derfor fortsat være false.
// Nye tilføjelser til denne liste kræver en tilsvarende begrundelse i selve workflowen
// (kommentar ved siden af `persist-credentials: true`).
const ALLOW_TRUE = new Set(["claude.yml:claude", "weekly-steering-report.yml:publish"]);

/**
 * Find alle `actions/checkout`-steps i teksten. For hvert step: hvilket job det står i
 * (nulstillet job-navn hvis det ikke kan bestemmes), om der findes en `with:`-blok, og om
 * den indeholder `persist-credentials` og dens rå værdi (streng, eller null hvis
 * fraværende — værdien er IKKE normaliseret, så en efterfølgende kommentar eller citering
 * bliver en del af strengen med vilje, jf. reglen ovenfor).
 */
export function findCheckoutSteps(text) {
  const lines = text.split(/\r?\n/);
  const steps = [];
  let inJobsBlock = false;
  let currentJob = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();
    const indent = line.length - line.replace(/^ +/, "").length;

    if (stripped !== "") {
      if (indent === 0) {
        inJobsBlock = /^jobs:\s*$/.test(stripped);
        if (!inJobsBlock) currentJob = null;
      } else if (inJobsBlock && indent === 2 && /^[A-Za-z0-9_.-]+:\s*$/.test(stripped)) {
        currentJob = stripped.slice(0, -1);
      }
    }

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

    steps.push({ line: i + 1, job: currentJob, hasWith, persistCredentials });
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
      // Alt der ikke er eksakt "false" skal være allowlistet for netop dette job —
      // ikke kun "true": en kommenteret/citeret/udtryks-værdi tæller også med, så den
      // ikke kan snige sig forbi et snævert strengt "=== true"-tjek.
      if (step.persistCredentials !== "false") {
        const key = `${file}:${step.job ?? ""}`;
        if (!ALLOW_TRUE.has(key)) {
          findings.push({
            file,
            line: step.line,
            rule: "unallowed-persist-credentials-true",
            why: `persist-credentials er sat til "${step.persistCredentials}" i jobbet "${step.job ?? "?"}", men "${key}" står ikke på ALLOW_TRUE i scriptet (${[...ALLOW_TRUE].join(", ")}). Sæt den til false — eller tilføj "${key}" til ALLOW_TRUE med en begrundelse, hvis jobbet reelt skal pushe.`,
          });
        }
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
