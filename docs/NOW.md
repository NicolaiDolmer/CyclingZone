# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action: MANDAG 24/8 (løbsfri).** v4-afvigelser (gate RØD, #4132; tirsdag kører v3) · **#3512** først i rytter-pakken (rebase+verify) · #4098/#4128 · kalibrering (#3719 præmier pr. division, **#3720 upkeep-kurven** — S3 kørte HALVERET 220k/70k/20k/0, ejer 23/8; S4-satser sættes i #3720 — #3987, #3732, #4059) · #3121 matview-sæsonfilter · MAN-ugenote (#428) + svar (skader nulstilles IKKE; form decay 25 %; cybersimon #4044; D1-upkeep #4125 + forecast-dobbelttælling #3986) · /pro (#4074) · forecast-verify · slet staging `staging-cutover` (#3839) · worktree-hygiejne · friktion: auto-mode-classifier blokerede endSeason/transition-dry-run 23/8 aften (løst m. detached Start-Process), remeasureGate3459 validerer ikke sæsonargument.

> **✅ CUTOVER S2→S3 GENNEMFØRT 23/8 19:12-20:45** (ejer-GO pr. skridt, fuld log i aftenens session + issue-tråde): Afslut sæson (214 notif, board-dom, ingen genkørsel) · D1-komprimering 214/214 verificeret (top 24 → D1; AI-oprydning krævede 33 FK-indekser + chunkede deletes, PR #4151) · **c = 0,811 applied** (3.933 receipts, 0 mismatch) og gjort VARIG i modellen (`level_correction`, PR #4135 merged) · dæmpning flippet · værdi-refresh (6.530, Riva 3.742.067 præcis; sæson-anker-bug fundet+fixet) · løn-genberegnet FØR skiftet (3.969, medianhold ×2,27, post-verify grøn) · transition 22 faser grønne, S3 aktiv 27 dage · 33.082 entries (0 aktive puljer uden felt) · mandat-migration 217/217/2.059 (kill-switch off) · achievements komplette. Kontrakt-residual 12 (som generalprøven). 7 D1-hold i minus ved start (upfront-model + delvis sponsor-garanti; forklaret, præmier ~22k/dag fra tirsdag). Sentry 0 nye. **Udestår i aften:** 22:00-tick-verify (første race-day-engine-tick + søndags-refresh ≈ no-op forventet) · merge PR #4151 (CI) · ejer poster besked 2 (værdier, 0,81-udgaven).

> **💰 Værdier/løn S3-tilstand:** base_value = model(c 0,811 + type-dæmpning k=100); CPV dæmpet; løn = CPV × 0,35 frosset FØR transitionen (S2-alder, ejer-bekræftet rækkefølge). `wage_deduction_mode = season_upfront` (daily-flip = S3→S4). Upkeep S3 = 220k/70k/20k/0.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdatoer 25/8-20/9 (sæsoner slutter altid søndag).
- **Staging:** `scripts/refresh-staging.ps1` + `scripts/with-staging.ps1`; generalprøve FØR enhver destruktiv prod-op. `staging-cutover` slettes mandag (#3839).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation (ejer-mandat 22/8):** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **🤖 Aktiv session:** cutover-sessionen (23/8 aften) er i close-out — 22:00-tick-verify udestår. Derefter: Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
