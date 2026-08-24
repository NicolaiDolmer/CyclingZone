# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action:** (1) **#4159** forward-guard (DB-trigger + lane-packer-fix + transition-gate) — FØR næste kalender-generering. (2) Ejeren poster: forum-indlæg + Fakta-DM (sidste advarsel) + community-linje (udkast leveret 24/8-natten). PR #4158 MERGED (kalender-reparation + patch note 7.182; #4155 lukket). **Udført i nat:** #4155 kalender-reparation PROD (1.855 dobbeltbookinger → 0; D1 5-6 etaper/dag; felter genopbygget) · #4154 sanktion EKSEKVERET (Johans drenge lukket permanent + auth-ban, clawback 748.154 fra Team Fakta, flags actioned) · minus-hold afklaret (by design + egne valg). Derefter/parallelt: v4-afvigelser (gate RØD, #4132; tirsdag kører v3) · **#3512** først i rytter-pakken (rebase+verify) · #4098/#4128 · kalibrering (#3719 præmier pr. division, **#3720 upkeep-kurven** — S3 kørte HALVERET 220k/70k/20k/0, ejer 23/8; S4-satser sættes i #3720 — #3987, #3732, #4059) · #3121 matview-sæsonfilter · MAN-ugenote (#428) + svar (skader nulstilles IKKE; form decay 25 %; cybersimon #4044; D1-upkeep #4125 + forecast-dobbelttælling #3986; egomadsens 0/8→0/12-bestyrelsesmål + bonustilbuds-spørgsmål) · /pro (#4074) · forecast-verify · slet staging `staging-cutover` (#3839) · worktree-hygiejne · friktion: auto-mode-classifier blokerede endSeason/transition-dry-run 23/8 aften (løst m. detached Start-Process), remeasureGate3459 validerer ikke sæsonargument.

> **✅ #4163 LØST + APPLIED 24/8 10:11-10:20** (ejer-GO): PR #4167 merged, migration kørt af auto-migrate. #4155-reparationen havde genskabt `no_rider_double_booking` UDEN `deferrable` → batch-RPC'en (#3934) afvist med 42809 → sweepen i deterministisk dødvande (56→169 enheder/tick, CYCLINGZONE-32/-2D/-4P). Prod nu: `condeferrable=true`, `convalidated=true`, 0 overlappende par, RPC-probe grøn. Forward-guard `lint-constraint-form.mjs` (commit-hook+preflight+CI) + runtime-diagnose i sweepen. Bagud-tjek rent (ingen andre constraints/triggere/RLS ramt). **#4159 bør tilføje `condeferrable=true` som 3. blokerende tælling.**

> **✅ CUTOVER S2→S3 GENNEMFØRT 23/8** (ejer-GO pr. skridt): 22 faser grønne, S3 aktiv 27 dage, 33.082 entries, D1 214/214. c=0,811 varig (#4135); løn genberegnet FØR skiftet. 7 D1-hold i minus ved start (upfront-model, forklaret). Fuld log: git-log + issue-tråde.

> **⚖️ Fair play — sanktions-præcedens:** **#4154** og **#3818** (eksekveret 24/8) behandlet ENS: clawback af funnel-kontoens bruttobeløb, køber beholder rytterne, funnel frosset + auth-banned (`banned_until` 2126-01-01), sidste advarsel til modtageren in-game. #2221 var kun frysning. Skabelon + tal: `docs/discord/2026-08-24-svarudkast-fairplay-3818.md` + issue-tråde. **Ejer 24/8: `transfer_price_cap_multiple` sættes IKKE** → mønsteret kan gentages, #3138 er eneste værn (rangerede #3818 som nr. 13/23). Løs ende: Wheelbarrels er banned uden Discord, har fået **ingen** forklaring (ejer: ingen e-mail nu).

> **💰 Værdier/løn S3-tilstand:** base_value = model(c 0,811 + type-dæmpning k=100); CPV dæmpet; løn = CPV × 0,35 frosset FØR transitionen (S2-alder, ejer-bekræftet rækkefølge). `wage_deduction_mode = season_upfront` (daily-flip = S3→S4). Upkeep S3 = 220k/70k/20k/0.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdatoer 25/8-20/9 (sæsoner slutter altid søndag).
- **Staging:** `scripts/refresh-staging.ps1` + `scripts/with-staging.ps1`; generalprøve FØR enhver destruktiv prod-op. `staging-cutover` slettes mandag (#3839).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation (ejer-mandat 22/8):** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **🤖 Ingen aktiv session** (nat-sessionen lukket ~01:30; #4163-sessionen 10:20; ugescan-sessionen 10:30 med #3818-sanktionen. Ejer-GO pr. prod-skridt hele vejen. **Delt checkout skiftede branch uden varsel 24/8** — verificér ALTID branch før commit, brug worktree; bed 4. gang. Bemærk: `staging-cutover` BEHOLDES til #4159-guard-test — #3839-sletningen venter).

_Historik i git-log, issue-tråde + docs/audits/._
