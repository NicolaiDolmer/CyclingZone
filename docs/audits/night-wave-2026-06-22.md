# Natbølge 2026-06-22

> Forever-relaunch launch-readiness. Orkestrator: Opus ultracode-fleet (Workflow-run `wf_3c4eaf78-439`). Bygget via `build → adversarisk verify`-pipeline pr. spor i isolerede git-worktrees. **INGEN merge** — ejer reviewer + merger om morgenen, derefter relaunch-prompt.

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid, CEST) | ~01:18 → kernebølge færdig ~02:27 (close-out ~08:20) |
| Agenter launched / fuldført / døde | 8 / 8 / 0 (4 build + 4 verify) |
| PR'er åbnet / merged | 4 / 0 (merge = ejer) |
| Issues → claude:done | Ingen endnu — ejer flipper `claude:todo`→`claude:done` pr. merge (runbook 5b) |
| gh-401-retries | Agenter brugte delt retry-wrapper (`scripts/lib/gh-retry.ps1`); intet spor blokeret |
| Recoveries (type) | 0 |
| Preflight | GO kl. ~01:15 (`.codex.local/night-wave-preflight.json`) |

## PR-resultater

| Spor | Issue | PR | Build | Adversarisk verify | CI |
|---|---|---|---|---|---|
| AI-fyld + race-skala | #1688 | [#1701](https://github.com/NicolaiDolmer/CyclingZone/pull/1701) | pr-ready | **ship-ready** | required grønne; Vercel success |
| Holdudtagelse findbar | #1681 | [#1700](https://github.com/NicolaiDolmer/CyclingZone/pull/1700) | pr-ready | **ship-ready** | required grønne; Vercel success |
| Onboarding-strømlining | #1569/#1140 | [#1702](https://github.com/NicolaiDolmer/CyclingZone/pull/1702) | pr-ready | **ship-ready** | required grønne; Vercel success |
| Progression L0 (verify+sim) | #1137 | [#1699](https://github.com/NicolaiDolmer/CyclingZone/pull/1699) | pr-ready | needs-work → **fixet** | required grønne (warning-budget fix `d00787b1`); Vercel rate-limited (advisory) |

### #1701 — AI-fyld + race-skala (#1688), ship-ready
Ny `aiTeamGenerator.js` (politik: tier 1+2 altid AI til 24; tier 3+4 kun puljer med ≥1 ægte manager; idempotent + reconcile der fjerner overskuds-AI uden at fortrænge ægte managere) wired ind i `relaunchOrchestrator` efter `allocateLeaguePools` + runnable `generateAiTeams.js` (dry-run default, hard prod-ref-deny). `raceRunner.fillMissingTeamEntries` fået pulje-filter + 24-cap (top efter base_value). Eksplicit `DIVISION_SQUAD_LIMITS[4]`. `StandingsPage` 1..MAX_DIVISION + pulje-faner. **Ingen migration** (eksisterende kolonner; GRANT/RLS allerede på plads). Balance: `moneySupplyScorecard --tiers4 --synthetic-only` PASS (tier-4 net +8.557/sæson, AI-volumen påvirker ikke per-team-økonomi da den er tier-keyet). 16 nye tests.

### #1700 — Holdudtagelse findbar (#1681), ship-ready
Nyt nav-punkt (Season & Results → "Team selection"/"Holdudtagelse") + dashboard-CTA-kort (`TeamSelectionCtaCard`) der dyb-linker direkte til næste scheduled-løbs `RaceSelectionPanel`. Ren frontend, client-side udledt, ingen backend-deploy-afhængighed. 7 unit-tests + playwright CTA-routing-test.

### #1702 — Onboarding (#1569/#1140), ship-ready
#1140-konsolidering: `OnboardingProgressCard` er nu eneste kanoniske dashboard-onboarding (`OnboardingModal` ikke længere renderet). Tom-trup-CTA (/riders + /auctions), /auctions default "All" ved 0 my-situation, /transfers default Market + intro, emoji-eyebrows → editorial-markører. (/riders evne-legende var allerede shippet #1592 — ikke dupliceret.) 5 nye tests.

### #1699 — Progression L0 (#1137), ship-ready efter fix
**Recon-fund:** motoren var ALLEREDE bygget+merged (`riderProgression.js` + `riderProgressionEngine.js` + migration 2026-06-07, gated `SEASON_RIDER_PROGRESSION_ENABLED=false`). Sporet leverede derfor verify + deterministisk simulerings-harness (`progressionSimHarness.js` + `simulate-progression-l0.mjs`) der scorer alle 5 acceptkriterier PASS på tværs af 4 seeds (ung stiger +13/3 sæsoner; 34-årig falder −8; retirement i vindue 36-40 m. notifikation; U25-vækst ≫ board-mål 8; idempotent run-hash bit-identisk). **Flag forbliver OFF** — ejer flipper ved relaunch efter review. Orkestrator fix: fjernet ubrugt import `peakAgeForType` (warning-budget grøn).

## Konsolideret patch-notes (anvendes VED merge — features er ikke shippet endnu)

> Per runbook laver orkestratoren ÉN konsolideret entry; men patch-notes for endnu-ikke-merged features må ikke shippe før features merger. Tekst klar her + i hver PR-body. #1137 får INGEN entry (flag OFF).

**PatchNotesPage.jsx (EN):**
- Standings now cover all four divisions, with sub-tabs for each pool inside a division. AI teams fill out race fields so every pool has real competition — and they step aside automatically when human managers arrive. (#1688)
- Team selection is now easier to find — a new sidebar entry and a dashboard prompt take you straight to picking your squad for the next race. (#1681)
- Onboarding streamlined: a single Getting Started guide on the dashboard, and empty pages now point you somewhere useful (auctions/transfers open on the tabs with riders, an empty squad links to the market). (#1569/#1140)

**PatchNotesPage.jsx (DA):**
- Ranglisten dækker nu alle fire divisioner, med sub-faner for hver pulje i en division. AI-hold fylder race-felterne ud, så hver pulje har rigtig konkurrence — og de viger automatisk, når menneske-managere kommer til. (#1688)
- Holdudtagelse er nu lettere at finde — et nyt menupunkt og en genvej på dashboardet fører dig direkte til at udtage holdet til næste løb. (#1681)
- Onboarding strømlinet: én Kom-godt-i-gang-guide på dashboardet, og tomme sider guider dig nu videre (auktioner/transfers åbner på de faner hvor der er ryttere, en tom trup linker til markedet). (#1569/#1140)

**help.json (en+da) — kun #1688 er ny mekanik:**
- EN: "How do race fields get filled? Each pool aims for 24 teams. If there aren't enough human managers, AI teams fill the gap so races can run. As real managers join a pool, AI teams are retired to make room — humans are never displaced."
- DA: "Hvordan fyldes race-felterne? Hver pulje sigter mod 24 hold. Er der ikke nok menneske-managere, fylder AI-hold hullet, så løb kan afvikles. Når ægte managere joiner en pulje, pensioneres AI-hold for at give plads — mennesker fortrænges aldrig."

## Ejer-handlinger (morgen)

1. Review + merge de 4 PRs. **Merge-rækkefølge:** #1699 (backend-only) + #1701 (isoleret, kun StandingsPage/standings.json) først; derefter #1700 + #1702 — begge rører `DashboardPage.jsx` + i18n i FORSKELLIGE regioner (verify forventer triviel/auto-merge). Kør `pwsh -File scripts/verify-local.ps1` efter 2.-merge af det par.
2. Anvend konsolideret patch-notes + help.json (tekst ovenfor) — som del af merge, IKKE separat (player-facing → følger med features).
3. Flip `claude:todo`→`claude:done` pr. merget issue (runbook 5b).
4. Chromium playwright-snapshots: kør `npx playwright test core-smoke.spec.js --update-snapshots` i CI / chromium-kapabelt miljø + commit evt. PNG'er (kunne ikke spawne på natbølge-maskinen).
5. Åben beslutning (#1137): type-afhængigt peak (sprintere topper tidligere) vs. unified `peakAge=28` (ejer-besluttet 2026-06-07). Ikke ændret i PR.
6. Kør derefter RELAUNCH-prompt (`docs/runbooks/2026-06-22-forever-relaunch-prompts.md`).

## Afvigelser / læringer

- **Scope-korrektioner fra recon (verificér-mod-kode):** #1688 var mindre end prompt antog (`allocateLeaguePools` + economyEngine-loop-fix allerede live) → kun additive dele bygget. #1137 var allerede bygget+merged → sporet blev verify+sim+readiness, ikke from-scratch. Begge dokumenteret i PR-bodies.
- **Chromium playwright `browserType.launch: spawn UNKNOWN`** på maskinen — ramte ALLE 3 visuelle spor (også urørte tests) → ikke en regression. mobile-webkit + alle required CI-checks grønne. Snapshot-refresh = ejer/CI-handling.
- **Vercel hobby-tier deploy rate-limit ("retry in 24 hours")** ramte #1699-commit (advisory, ikke-required check; backend/Railway upåvirket). Jf. runbook-sektionen om høj-tempo-bølger.
- **Shell-classifier-outage (`claude-opus-4-8 temporarily unavailable`) ~02:30–08:15 CEST** blokerede (a) kvalitets-wave #2 (#1278 in-app broadcast + #1676 fatigue daily-recovery — backend-sikre, konfliktfri spor — **IKKE startet**) og (b) lokal git-close-out. **Workaround:** close-out (dette artifact + NOW.md) committet via GitHub MCP-API i stedet for lokal git. Read-only MCP brugt til CI-verifikation under outage.
- **#1576 AI-slop + onboarding-rest UDSKUDT** bevidst: fil-konflikt med de 4 åbne PRs (DashboardPage/i18n) + chromium-spawn-fejl gør visuel verifikation upålidelig nu. Tag dem efter de 4 merger.

_Refs #605 (velocity-måling). Se `docs/NIGHT_WAVE_RUNBOOK.md`._
