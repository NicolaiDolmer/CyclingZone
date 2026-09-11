#!/usr/bin/env node
// scripts/make-wave-brief.mjs
// ============================================================
// Genererer en selvstaendig boelge-worker-brief fra en lille JSON-config (#4918).
//
// FEJLKLASSEN: begge M12-frys 5-6/9 skete efter briefen sagde "laes det store
// workflow-script foerst" i stedet for at vaere selvstaendig, og livstegn-reglen
// (push inden 10 min, derefter hvert 15. min) laa kun i orkestratorens hukommelse
// - ikke skrevet ind i hver enkelt prompt. En haandskrevet brief glemmer let en
// af de faste blokke naar den skrives fra bunden under tidspres. Dette script
// gaar den anden vej: byg briefen fra data (issue, slug, branch, scope,
// ejerskab, verify-kommandoer), og lad de bindende regel-blokke vaere
// hardcoded konstanter der ALTID er med, uanset input.
//
// Brug:
//   node scripts/make-wave-brief.mjs config.json                  # print til stdout
//   node scripts/make-wave-brief.mjs config.json --out brief.md   # skriv til fil
//
// config.json-form (se test-filen for et fuldt eksempel):
// {
//   "issue": 4918,
//   "slug": "chore-4918-wave-ops",
//   "branch": "chore/4918-wave-ops",
//   "model": "sonnet",
//   "title": "[ops] ...",
//   "scopeText": "fri tekst - hvad skal loeses",
//   "ownership": ["scripts/foo.ps1", "docs/BAR.md"],
//   "tier": "TARGETED",              // "TARGETED" | "FULL"
//   "verifyCommands": ["node --test scripts/foo.test.mjs"],
//   "repoWorktreesRoot": "C:\\Dev\\CyclingZone-worktrees", // optional, default vist herunder
//   "scratchRoot": "...",            // optional, default <worktreesRoot>\.wave-scratch
//   "ownNodeModules": false          // optional, true = lanen maa selv installere deps
// }
//
// Selvtest: node --test scripts/make-wave-brief.test.mjs
//
// Refs #4918, #3855. Se docs/PARALLEL_WORKTREE_ORCHESTRATION.md §Sub-agent
// prompt template (samme regelsaet, denne generator haandhaever at det ALDRIG
// mangler i en genereret brief).

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_WORKTREES_ROOT = "C:\\Dev\\CyclingZone-worktrees";

function requireField(config, name) {
  if (config[name] === undefined || config[name] === null || config[name] === "") {
    throw new Error(`make-wave-brief: mangler paakraevet felt "${name}" i config`);
  }
  return config[name];
}

// De faste blokke - ALDRIG betinget af input. Nye regler tilfoejes her, ikke
// i orkestratorens hukommelse, saa de ikke kan glemmes fra brief til brief.
function reglerBlok(wd, branch, scratchDir, msgFile, ownNodeModules) {
  const lines = [
    "# Regler (bindende)",
    "",
    "- Heredoc er FORBUDT (kendt bug i Bash-tool paa Windows, F3-boelgen 21/8: en worker froes PERMANENT i `<<'EOF'`): filer via Write/Edit-vaerktoejet, commit-beskeder via fil + `git commit -F`. Aldrig PowerShell heredoc (`@'...'@`).",
    `- Commit KUN bag guarden: \`bash "${wd}/scripts/guard-commit-branch.sh" ${branch} "${wd}" && git -C "${wd}" commit -F "${msgFile}"\`. Blokerer guarden: STOP og rapporter, gentag ALDRIG uden den.`,
    // 11/9 (#5142): to workers delte scratchpad-sti, og den ene fik sin
    // commit-besked overskrevet af den anden mellem Write og git commit.
    // Derfor: egen mappe pr. lane, og branch-slug i selve filnavnet.
    `- Din scratch-mappe er \`${scratchDir}\` - ALLE midlertidige filer laegges DER, aldrig i en delt temp-mappe og aldrig i worktreet. Commit-besked-filen er \`${msgFile}\` (uden for worktreet, med branch-slug i navnet, saa en anden lane ikke kan overskrive den).`,
    "- `git add <konkrete filer>`, ALDRIG `git add -A` (lint-staged-pitfall sweeper untracked ind).",
    "- Ingen patch note i denne PR - boelger samler patch notes ved close-out (undgaar merge-konflikter i patchNotes.js). Aflever patch note-tekst (EN foerst, DA under) i din slutrapport i stedet.",
    "- Start ALDRIG en watcher eller dev-server der overlever dig (`--watch`, `npm run dev`, `vite`, `playwright` i baggrunden). CI-status laeses med enkelte `gh pr checks`-kald, aldrig `--watch`.",
    // 8/9 (bidt 3x): workers der lagde preflight i baggrunden og derefter
    // "ventede paa monitoren" stod reelt stille - der kom aldrig et svar.
    "- INGEN baggrundsjob. Koer ALLE kommandoer i FORGRUNDEN og laes resultatet selv. Skriv aldrig at du \"venter paa monitoren\" eller paa et baggrundsjob - en lane der venter paa noget den ikke selv laeser, er stoppet.",
    "- Arbejd sekventielt. Spawn ALDRIG under-agenter - de ender i idle-vent paa notifikationer du aldrig ser.",
    "- Rebase foer push: `git fetch origin && git rebase origin/main`.",
  ];
  if (ownNodeModules) {
    lines.push(
      "- Denne lane har `ownNodeModules: true`: du MAA installere dependencies i dit eget worktree. Wrap installationen i verifikations-semaforen (se verifikations-blokken).",
    );
  } else {
    lines.push(
      // Hard rule 14: worktrees junctioner til en delt, lockfile-hashet cache.
      // `npm ci` gennem en junction toemte hoved-checkoutets install midt i en boelge.
      "- `npm install`/`npm ci` er FORBUDT i dette worktree: node_modules er en junction til en delt cache, og en install gennem den toemmer de andre laners installation (hard rule 14). Mangler en dependency: STOP og rapporter det i stedet for at installere.",
    );
  }
  return lines.join("\n");
}

function livstegnBlok(branch) {
  return [
    "# Livstegn (TIER WAVE, ejer-krav 6/9)",
    "",
    "- Inden 10 min: foerste push (tom commit ok: `wip: lane start`), `git push -u origin " + branch + "`, og opret PR'en som DRAFT med det samme (se PR-skabelon) - saa alle efterfoelgende wip-pushes ikke taeller som CodeRabbit-review-forsoeg.",
    "- Draft-PR'en SKAL eksistere senest 30 min efter lane-start. Er du ikke faerdig med at forstaa opgaven endnu, opret den alligevel med en kort WIP-body: en lane uden PR er usynlig for orkestratoren.",
    "- Derefter push MINDST hvert 15. minut, ogsaa ufaerdigt arbejde. En `wip(...)`-commit slaar altid ingen commit.",
    "- Commit + push FOER du koerer tests, ikke efter.",
    "- Tavshed >45 min = orkestratoren stopper dig og genopretter i SAMME worktree.",
  ].join("\n");
}

// Semafor-wrappingen (#5142) staar FOER selve kommandolisten, fordi den er en
// betingelse for hvordan kommandoerne koeres - ikke en fodnote. Maalt 11/9:
// 9 samtidige workers uden semafor = 100 % CPU i timevis paa DOLMERPC.
function verifikationsBlok(tier, verifyCommands, wd) {
  const lock = `pwsh -File "${wd}\\scripts\\verify-lock.ps1" -Max 2 -Timeout 1800 --`;
  const lines = [`# Verifikation, niveau TIER WAVE (${tier})`, ""];
  lines.push(
    `- **Semafor (bindende):** ENHVER tung koersel wrappes: \`${lock} <kommando>\`. Tung = frontend/backend build, backend-suite, Playwright, \`tsc\` over hele repoet, \`preflight-pr.ps1\`, \`verify-affected.mjs\`, npm-install. Maks 2 saadanne koerer ad gangen paa HELE maskinen; wrapperen venter selv paa en ledig slot. Exit 75 = koe-timeout, ikke en testfejl - proev igen og rapporter det.`,
  );
  lines.push(
    "- Lette kommandoer (enkelt `node --test <fil>`, `git`, `gh`, `eslint` paa faa filer) koeres UDEN semafor - ellers bliver koen selv flaskehalsen.",
  );
  if (tier === "FULL") {
    lines.push("- KUN én worker i boelgen maa have FULL - bekraeft det med orkestratoren foer du starter.");
    lines.push("- Fuld lokal suite (jf. scripts/verify-local.ps1-omfanget) + nedenstaaende.");
  } else {
    lines.push(`- TARGETED: \`${lock} node scripts/verify-affected.mjs\` + \`npm run lint\` + frontend \`node --test\`.`);
    lines.push(
      "- FORBUDT paa TARGETED: fuld e2e-suite (`npm run test:e2e`) og `scripts/verify-local.ps1`. Begge er orkestratorens, ikke lanens - CI er den fulde gate (TIER WAVE, ejer 6/9).",
    );
  }
  lines.push("- ALDRIG fuld e2e-suite paa egen haand - orkestratoren ejer e2e-slottet (hard rule 24).");
  if (verifyCommands && verifyCommands.length > 0) {
    lines.push("- Derudover, specifikt for denne opgave:");
    for (const cmd of verifyCommands) lines.push(`  - \`${cmd}\``);
  }
  lines.push(`- \`${lock} pwsh -File scripts/preflight-pr.ps1\` foer push.`);
  return lines.join("\n");
}

// PR'en oprettes som DRAFT og markeres ready foerst som SIDSTE handling.
// Begrundelse (CodeRabbit-attempts, malt 7/9): CodeRabbit (plan Essentials)
// taeller HVERT push til en ikke-draft PR som et review-forsoeg. Boelge-workers
// pusher wip-commits hvert 15. minut (livstegn-reglen) - 200 PR'er over 7 dage
// gav 108 review-forsoeg og CodeRabbits allowance faldt til 1 review/time. En
// draft-PR faar ingen auto-review foer den er klar, saa CodeRabbit ser kun ét
// forsoeg pr. PR (efter `gh pr ready`), uanset hvor mange wip-pushes der gik forud.
function prSkabelonBlok(issue, wd, branch) {
  return [
    "# PR-skabelon",
    "",
    `- PR-body-fil: \`${wd}/.tmp-${issue}-pr.md\`.`,
    "- Skal indeholde `## Brugerverifikation` med mindst ét `- [x]`, ELLER label `docs-only`/`backend-only`.",
    `- Foerste push: opret PR'en som DRAFT: \`gh pr create --draft --base main --head ${branch} --title "..." --body-file "${wd}/.tmp-${issue}-pr.md" --label docs-only\` (skift label efter omfang).`,
    "- Push wip-commits mod draften som normalt (livstegn-reglen gaelder uaendret).",
    "- FOER `gh pr ready`: koer `coderabbit review --base main --committed` i arbejdsmappen (CLI, egen kvote - adskilt fra skyens auto-review paa den endelige inkrementelle omgang). Tager ca. 2,5 min. Ret aegte fund; afvis stoej med en kort begrundelse i slutrapporten. Fandt reviewet noget der skulle rettes: commit + push rettelsen, og koer CLI-reviewet igen paa den endelige committed diff. PR'en maa IKKE markeres klar foer et rent (eller kun-stoej) CLI-review paa den endelige diff foreligger.",
    "- Markér FOERST PR'en klar naar preflight er groen, det endelige CLI-review er koert (uden uafklarede fund) og PR-body er faerdig, som SIDSTE handling: `gh pr ready <N>` (CodeRabbit-attempts, 7/9 - undgaar at hvert wip-push taeller som et review-forsoeg).",
    `- Refs #${issue} i PR-body, ikke "Closes" - projektets close-protokol er "Refs #N", brugeren lukker selv.`,
  ].join("\n");
}

function slutrapportBlok() {
  return [
    "# Slutrapport (sidste besked, kort, dansk)",
    "",
    "- Branch, PR-URL, commit-SHA.",
    "- Hovedaendringer + status paa verifikation.",
    "- Patch note-tekst (EN+DA) hvis brugerrettet.",
    "- Hvad verifikationen IKKE daekker.",
    "- Eventuelle out-of-scope-fund som forslag - opret IKKE selv issues.",
  ].join("\n");
}

export function generateBrief(config) {
  const issue = requireField(config, "issue");
  const slug = requireField(config, "slug");
  const branch = requireField(config, "branch");
  const title = requireField(config, "title");
  const scopeText = config.scopeText || "";
  const ownership = config.ownership || [];
  const tier = config.tier === "FULL" ? "FULL" : "TARGETED";
  const verifyCommands = config.verifyCommands || [];
  const model = config.model || "sonnet";
  const worktreesRoot = config.repoWorktreesRoot || DEFAULT_WORKTREES_ROOT;
  const wd = `${worktreesRoot}\\${slug}`;
  const ownNodeModules = config.ownNodeModules === true;
  // Scratch-roden ligger SIDE OM SIDE med worktrees, ikke inde i et af dem:
  // saa er commit-besked-filer uden for worktreet (de maa aldrig kunne blive
  // committet ved et uheld) og samtidig i en mappe pr. lane.
  const scratchRoot = config.scratchRoot || `${worktreesRoot}\\.wave-scratch`;
  const scratchDir = `${scratchRoot}\\${slug}`;
  const msgFile = `${scratchDir}\\msg-${slug}.txt`;

  const parts = [
    "Du er en autonom subagent uden kontekst fra mor-samtalen. Laes HELE briefen foer du starter. Arbejd sekventielt, ingen under-agenter.",
    "",
    "# Mission",
    `Pick op GitHub issue #${issue} (repo: NicolaiDolmer/CyclingZone): "${title}"`,
    "",
    "# Arbejdsmappe + branch",
    `ABSOLUT WORKING DIR: ${wd}`,
    `BRANCH: ${branch} (allerede oprettet, tracker origin/main)`,
    `Brug \`git -C "${wd}"\` til ALLE git-kald - shell-cwd nulstilles mellem kald. Arbejd ALDRIG i hoved-checkoutet.`,
    `SCRATCH-MAPPE (kun din): ${scratchDir} - opret den som allerfoerste handling (\`mkdir -p\`).`,
    `Model: ${model}.`,
    "",
    "# Scope",
    scopeText || "(se issue-body for fuldt scope)",
    "",
  ];

  if (ownership.length > 0) {
    parts.push("# Ejerskab - filer/omraader denne lane ejer");
    for (const item of ownership) parts.push(`- ${item}`);
    parts.push("");
  }

  parts.push(reglerBlok(wd, branch, scratchDir, msgFile, ownNodeModules), "");
  parts.push(livstegnBlok(branch), "");
  parts.push(verifikationsBlok(tier, verifyCommands, wd), "");
  parts.push(prSkabelonBlok(issue, wd, branch), "");
  parts.push(slutrapportBlok());

  return parts.join("\n") + "\n";
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0].startsWith("--")) {
    console.error("Brug: node scripts/make-wave-brief.mjs <config.json> [--out <fil>]");
    process.exit(1);
  }
  const configPath = args[0];
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const brief = generateBrief(config);

  if (outPath) {
    writeFileSync(outPath, brief, "utf8");
    console.log(`Skrevet: ${outPath}`);
  } else {
    process.stdout.write(brief);
  }
}

// Koer kun main() naar scriptet koeres direkte (ikke ved import i testen).
// pathToFileURL (ikke en manuel "file://"-streng) for korrekt Windows-sti-encoding.
function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}
if (isMain()) {
  main();
}
