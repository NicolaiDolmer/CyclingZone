# Stale dev-server på delt port forfalsker e2e-verifikation på tværs af worktrees

**Dato:** 2026-05-31
**Issue:** #792 (SetupWizard-hæng) — opdaget under verifikation, ikke selve bugfixet

## Symptom

Skrev en ny Playwright-test der skulle bevise mit fix (try/catch i `SetupWizardModal`).
Testen fejlede: modal'en viste stadig "Gemmer…" og hang — præcis den GAMLE adfærd,
selvom min fix var committet, bygget og verificeret til at være i `dist`-bundlen
(`grep connectionFailed dist/assets/*.js` → hit).

Endnu værre: min FØRSTE `core-smoke`-kørsel (15 pass) og den nye spec ramte begge
den gamle kode — så et "grønt" resultat beviste intet.

## Rod-årsag

`frontend/playwright.config.js` kører `webServer.command = npm run dev ... --port 4173`
med `reuseExistingServer: !process.env.CI`. Lokalt (ingen CI) genbruger Playwright
**enhver** server der allerede lytter på port 4173 — uden at tjekke hvilken worktree
den serverer fra.

En Vite dev-server fra en ANDEN, stale worktree (`elastic-kare-e68899`, merged &
deleted) holdt stadig port 4173. Mine tests forbandt til DEN → gammel kode.

```
netstat -ano | grep :4173        → PID 30960 LISTENING
Get-CimInstance Win32_Process -Filter 'ProcessId=30960'
  → vite.js fra ...\worktrees\elastic-kare-e68899\frontend  (IKKE min worktree)
```

## Fix

`Stop-Process -Id 30960 -Force` → port fri → Playwright startede sin egen dev-server
fra MIN worktree → testen passerede på alle 3 projekter, og fixet var bevist.

## Forebyggelse / tjekliste

- **Før du stoler på et lokalt e2e-resultat i en worktree:** verificér hvem der ejer
  testporten. `netstat -ano | grep :4173` → slå PID's CommandLine op → bekræft stien
  peger på DIN worktree. Hvis ikke, dræb processen.
- En grøn e2e-kørsel beviser kun noget hvis serveren kører din kode. "Importing a
  module script failed"-logs ved cold-start er harmløse (webkit-race mod frisk
  Vite-server), men en server fra en ANDEN sti er en falsk grøn.
- Cluster: dette hører sammen med worktree-disciplinen ([[feedback_worktree_before_parallel_commits]])
  — delt main-dir/port mellem parallelle sessioner er fælden, både for commits og
  for verifikation.

## Opdatering 2026-06-10

Fælden bed igen under multiagent-bølge 2 (suite 18/18 grøn mod anden worktrees server).
Tjekliste-disciplinen skalerede ikke til parallelle agenter → strukturelt fix:
per-worktree-port + identity-guard, se [2026-06-10-shared-playwright-port-false-green-worktrees.md](2026-06-10-shared-playwright-port-false-green-worktrees.md).
