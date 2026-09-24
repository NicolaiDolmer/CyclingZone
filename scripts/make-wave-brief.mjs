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
//   "kind": "build",                 // "build" (default) | "investigate" (#5220)
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
// Denne generator er en almindelig Node-modul (i modsaetning til
// .claude/workflows/wave.js, som er en workflow-DSL-fil uden import-adgang og
// derfor maa spejle konstanten manuelt) - saa den importerer INVESTIGATE_TIMEOUT_MINUTES
// direkte fra kilden i stedet for endnu en spejling (#5220).
import { WAVE_FREEZE } from "./wave-freeze.mjs";

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
    // 18/9 (dagboelgen): to workers lagde balance-tal i docs/audits/ og holdnavne +
    // et Discord-brugernavn i en fair-play-rapport/PR-body. Orkestratorens brief
    // bad selv om rapporten i docs/audits/. Postmortem:
    // .claude/learnings/2026-09-18-wave-briefs-og-hard-rule-17.md
    "- REPOET ER OFFENTLIGT (hard rule 17 + anonymisering). I committede filer, PR-body, issue-kommentarer og commit-beskeder maa der ALDRIG staa: praecise balance-tal (vaegte, formler, konstanter, taerskler, maalte fordelinger fra motor/generator), holdnavne, manager-/Discord-brugernavne, user_id/team_id eller e-mails. Skriv kvalitativt + aliaser (Hold A/B) i repoet; den fulde udgave med tal og navne laegges i `balance-internals/` (gitignoreret) og naevnes kun ved filnavn. Beder din opgavetekst om det modsatte, er det en briefing-fejl: foelg DENNE regel og skriv afvigelsen i slutrapporten.",
    "- Start ALDRIG en watcher eller dev-server der overlever dig (`--watch`, `npm run dev`, `vite`, `playwright` i baggrunden). CI-status laeses med enkelte `gh pr checks`-kald, aldrig `--watch`.",
    // 8/9 (bidt 3x): workers der lagde preflight i baggrunden og derefter
    // "ventede paa monitoren" stod reelt stille - der kom aldrig et svar.
    "- INGEN baggrundsjob. Koer ALLE kommandoer i FORGRUNDEN og laes resultatet selv. Skriv aldrig at du \"venter paa monitoren\" eller paa et baggrundsjob - en lane der venter paa noget den ikke selv laeser, er stoppet.",
    "- Arbejd sekventielt. Spawn ALDRIG under-agenter - de ender i idle-vent paa notifikationer du aldrig ser.",
    "- Rebase foer push: `git fetch origin && git rebase origin/main`.",
    // #5143: denne linje staar for ALLE laner, ogsaa ownNodeModules-lanen selv -
    // den advarer mod at installere i ET ANDET worktree (eller hovedcheckoutet),
    // som stadig kan have junction-node_modules, uanset denne lanes egen opsaetning.
    "- Koer ALDRIG npm install i et worktree med junction-node_modules - kun i et worktree hvor node_modules er lanens EGET install (ownNodeModules), aldrig i et delt/junction-worktree.",
  ];
  if (ownNodeModules) {
    lines.push(
      // #5143: lanen skal selv oprette worktreet (scripts/new-worktree.ps1 -OwnNodeModules,
      // eller auto naar branchen starter med chore/deps/dependabot/) og selv koere npm ci -
      // ikke bruge et allerede-junctionet worktree og installere ovenpaa det.
      "- Denne lane har `ownNodeModules: true`: opret dit worktree med `scripts/new-worktree.ps1 -Branch <branch> -OwnNodeModules` (eller lad auto-detect goere det for chore/deps*/dependabot/*-branches) - scriptet koerer selv `npm ci` for hver package.json-mappe (rod/backend/frontend/marketing) i stedet for junction. Er worktreet allerede oprettet UDEN flaget (stadig junction-node_modules): koer ALDRIG npm ci direkte i det - fjern worktreet og genskab det med `-OwnNodeModules` i stedet (`git worktree remove <sti>` foer genskabelsen).",
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

// #5220: undersoegelsesspor (kind: "investigate") bygger intet - kun
// undersoeger og leverer en dom. Fast, ikke-forlaengeligt vindue (orkestreres
// i .claude/workflows/wave.js's runInvestigateTrack), og en TVUNGEN aflevering
// skrevet ordret ind her, saa den ikke kan glemmes eller udvandes til et
// tredje "ved ikke"-svar.
function undersoegelseBlok() {
  return [
    "# Undersoegelsesspor (kind: investigate, #5220)",
    "",
    `Dette er et UNDERSOEGELSESSPOR, ikke et byggespor: fast vindue paa ${WAVE_FREEZE.INVESTIGATE_TIMEOUT_MINUTES} min, IKKE forlaengeligt (ingen frys-probe - der er maaske slet ingen commits at maale paa).`,
    "Din slutrapport SKAL ende med PRAECIS EEN af disse to domme, ordret:",
    "- \"bekraeftet + fix-plan\": problemet er reproduceret/bekraeftet, med en konkret plan for rettelsen (trin, filer, risiko).",
    "- \"afvist + bevis-test\": problemet kunne IKKE bekraeftes, med beviset vedlagt - en test, et logudsnit, eller en konkret reproduktion du proevede og som IKKE fejlede.",
    "Lever ALDRIG et tredje svar (\"ved ikke\", \"maaske\") - vaelg den dom bevisernevet peger paa.",
  ].join("\n");
}

// CodeRabbit (denne PR): et undersoegelsesspor bygger intet - de fulde
// build-regler (commit-guard, livstegn/push-kadence, TIER-verifikation,
// draft-PR + CodeRabbit + gh pr ready) er ALLE meningsloese for et spor der
// kun leverer en dom i sin slutrapport. Denne trimmede regelblok erstatter
// dem for kind: "investigate" i stedet for at faa dem tilfoejet oveni.
function reglerBlokInvestigate(scratchDir) {
  return [
    "# Regler (bindende, undersoegelsesspor)",
    "",
    "- Heredoc er FORBUDT (kendt bug i Bash-tool paa Windows): skal du gemme et bevis (logudsnit, en test du koerte), brug Write/Edit-vaerktoejet, aldrig heredoc.",
    `- Scratch-mappe (kun din): \`${scratchDir}\` - eventuelle midlertidige filer (bevis-logs, test-output) laegges DER.`,
    "- INGEN baggrundsjob. Koer ALLE kommandoer i FORGRUNDEN og laes resultatet selv.",
    "- Arbejd sekventielt. Spawn ALDRIG under-agenter.",
    "- Dette spor bygger INTET: intet commit, ingen push, ingen PR. Din leverance er en dom + bevis i slutrapporten, ikke kode.",
  ].join("\n");
}

function slutrapportBlokInvestigate() {
  return [
    "# Slutrapport (sidste besked, kort, dansk)",
    "",
    "- Hvad du undersoegte og hvordan (kommandoer, filer, logs du kiggede paa).",
    "- Din SIDSTE saetning SKAL vaere PRAECIS en af de to domme ovenfor, ordret - intet tredje svar.",
    "- Ingen PR, intet commit, intet push - dette spor leverer kun en dom, ikke kode.",
  ].join("\n");
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
    "- FOER `gh pr ready`: koer `coderabbit review --base main --committed` i arbejdsmappen PRAECIS EEN gang (maks 1 CodeRabbit CLI-runde pr. spor, #5220 - CLI'en har egen kvote, adskilt fra skyens auto-review paa den endelige inkrementelle omgang). Tager ca. 2,5 min. Ret aegte fund; afvis stoej med en kort begrundelse i slutrapporten. Fandt reviewet noget der skulle rettes: commit + push rettelsen - koer IKKE CLI-reviewet igen, den ene runde er brugt. Noter i slutrapporten hvilke fund der blev rettet uden en ny CLI-bekraeftelse.",
    "- Markér FOERST PR'en klar naar preflight er groen, den ENE CodeRabbit CLI-runde er koert (og eventuelle fund er rettet og pushet) og PR-body er faerdig, som SIDSTE handling: `gh pr ready <N>` (CodeRabbit-attempts, 7/9 - undgaar at hvert wip-push taeller som et review-forsoeg).",
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
  const kind = config.kind === "investigate" ? "investigate" : "build";
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
    // Ikke `mkdir -p <sti>`: i Git Bash er backslash escape-tegn, saa
    // C:\Dev\... bliver til een mappe ved navn "C:DevCyclingZone-worktrees...".
    `SCRATCH-MAPPE (kun din): ${scratchDir} - opret den som allerfoerste handling: \`pwsh -NoProfile -Command "New-Item -ItemType Directory -Force -Path '${scratchDir}'"\`.`,
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

  if (kind === "investigate") {
    // CodeRabbit (denne PR): de fire build-blokke herunder (regler, livstegn,
    // TIER-verifikation, PR-skabelon) kraever ALLE commit/push/PR - modstrider
    // "bygger intet". Erstattes med en trimmet regelblok + egen slutrapport.
    parts.push(undersoegelseBlok(), "");
    parts.push(reglerBlokInvestigate(scratchDir), "");
    parts.push(slutrapportBlokInvestigate());
    return parts.join("\n") + "\n";
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
