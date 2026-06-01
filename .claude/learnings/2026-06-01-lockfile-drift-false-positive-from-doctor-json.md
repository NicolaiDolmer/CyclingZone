# Postmortem · 2026-06-01 · Lockfile-drift-check gatede på et afledt, skrøbeligt signal

## Hvad skete der?
`lockfile-drift-check.yml` oprettede et **priority:high `type:bug`-issue på næsten hver main-commit** (#835/#848/#863/#871/#875) og holdt main-CI rød — selvom der ingen reel lockfile-drift var (`npm ci` grøn i alle tre workspaces, `git diff` på lockfilerne tom). Fanget i sundhedsauditen.

## Root cause
Workflow'en udledte `driftDetected` af tre signaler: `npm ci` fejlede, `git diff` ikke-tom, **eller** `install-parity` fra `agent-doctor.ps1 -Json` var ≠ OK. Det tredje var en fælde: i en frisk CI installerer `npm ci` pr. definition præcis lockfilen, så install-parity er altid trivielt OK — men når agent-doctorens JSON ikke kunne parses i CI-miljøet, satte github-script-fallbacken `install-parity = WARN` → tolket som drift. Et **JSON-parse-robusthedsproblem i et hjælpe-script** blev altså til "lockfile drift".

## Fix
`.github/workflows/lockfile-drift-check.yml` (PR #876): fjernede `installParityDrift` fra `driftDetected`. De reelle drift-signaler bevares: `npm ci`-fejl ELLER ikke-tom lockfile-`git diff`. install-parity vises stadig i issue-tabellen som info, men gater ikke. Lukkede de 5 false-positive-issues.

## Forhindret-fremover
Gate kun på **autoritative, direkte** signaler. Et afledt/sekundært tjek (her: install-parity, der allerede er dækket af `npm ci` + `git diff` i fresh CI) skal aldrig kunne fælde en gate når det selv fejler af urelaterede årsager (JSON-parse, banner-output, exit-noise). Hvis et hjælpe-scripts output indgår i en gate: enten parse defensivt og fail-open på parse-fejl, eller lad være med at bruge det.

## Læring
"Fail-closed på et skrøbeligt afledt signal" er et anti-mønster: det forveksler *signalets sundhed* med *tilstanden det måler*. Spørg altid: hvis dette delsignal fejler af en grund der intet har med fejltilstanden at gøre — hvad sker der så? Her: dagligt high-prio-bug-spam + rød main. Samme tankegang ramte AI-review-gaten samme dag (se `2026-06-01-ai-review-fail-closed-gate.md`).
