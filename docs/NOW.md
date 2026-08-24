# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action:** (1) **#4170 tomme løb** — **157 af 471 S3-løb (33 %) har nul entries**, 27 puljer provisioneret til 8 instanser hvor ~2 bruges. Strukturelt, ikke #4163-efterslæb (målt efter rent tick). 12 af dem starter i morgen 25/8 kl. 11 som tomme 4-etapeløb → beslut FØR da: slet tomme instanser nu, eller ret sizingen. (2) **#4159** forward-guard (DB-trigger + lane-packer-fix + transition-gate; fjerde vagt: assertér constraint-FORM, ikke eksistens) — FØR næste kalender-generering. (3) Ejeren poster: forum-indlæg + Fakta-DM (sidste advarsel) + community-linje (udkast leveret 24/8-natten). PR #4158 MERGED (kalender-reparation + patch note 7.182; #4155 lukket). Derefter/parallelt: v4-afvigelser (gate RØD, #4132; tirsdag kører v3) · **#3512** først i rytter-pakken (rebase+verify) · #4098/#4128 · kalibrering (#3719 præmier pr. division, **#3720 upkeep-kurven** — S3 kørte HALVERET 220k/70k/20k/0, ejer 23/8; S4-satser sættes i #3720 — #3987, #3732, #4059) · #3121 matview-sæsonfilter · MAN-ugenote (#428) + svar (skader nulstilles IKKE; form decay 25 %; cybersimon #4044; D1-upkeep #4125 + forecast-dobbelttælling #3986; egomadsens 0/8→0/12-bestyrelsesmål + bonustilbuds-spørgsmål) · /pro (#4074) · forecast-verify · slet staging `staging-cutover` (#3839) · worktree-hygiejne · friktion: auto-mode-classifier blokerede endSeason/transition-dry-run 23/8 aften (løst m. detached Start-Process), remeasureGate3459 validerer ikke sæsonargument.

> **✅ #4163 LØST + APPLIED 24/8 10:11-10:20** (ejer-GO): PR #4167 merged, migration kørt af auto-migrate. #4155-reparationen havde genskabt `no_rider_double_booking` UDEN `deferrable` → batch-RPC'en (#3934) afvist med 42809 → sweepen i deterministisk dødvande (56→169 enheder/tick, CYCLINGZONE-32/-2D/-4P). Prod nu: `condeferrable=true`, `convalidated=true`, 0 overlappende par, RPC-probe grøn. Forward-guard `lint-constraint-form.mjs` (commit-hook+preflight+CI) + runtime-diagnose i sweepen. Bagud-tjek rent (ingen andre constraints/triggere/RLS ramt). **#4159 bør tilføje `condeferrable=true` som 3. blokerende tælling.**

> **✅ CUTOVER S2→S3 GENNEMFØRT 23/8** (ejer-GO pr. skridt): 22 faser grønne, S3 aktiv 27 dage. c=0,811 varig (#4135). 7 D1-hold i minus ved start (upfront-model, forklaret). Log: git-log + issue-tråde.

> **⚖️ Fair play:** #3818 eksekveret 24/8 efter #4154-skabelonen (clawback af funnel-kontoens bruttobeløb + frys + auth-ban + advarsel in-game; #2221 var kun frys). Metode, tal og tekst: `docs/discord/2026-08-24-svarudkast-fairplay-3818.md`. **Ejer 24/8: prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord, har fået ingen forklaring.

> **💰 Værdier/løn S3-tilstand:** base_value = model(c 0,811 + type-dæmpning k=100); CPV dæmpet; løn = CPV × 0,35 frosset FØR transitionen (S2-alder, ejer-bekræftet rækkefølge). `wage_deduction_mode = season_upfront` (daily-flip = S3→S4). Upkeep S3 = 220k/70k/20k/0.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdatoer 25/8-20/9 (sæsoner slutter altid søndag).
- **Staging:** `scripts/refresh-staging.ps1` + `scripts/with-staging.ps1`; generalprøve FØR enhver destruktiv prod-op. `staging-cutover` slettes mandag (#3839).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation (ejer-mandat 22/8):** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **🤖 Ingen aktiv session** (Sentry/Clarity-triage-sessionen 24/8 lukket ~10:30: #3960 lukket som opslugt af #4163, #4160 LCP oprettet, #2254 opdateret, fjerde vagt lagt på #4159, #4163 uafhængigt verificeret — se issue-tråden for det udestående. Ugescan-sessionen 10:30: #3818-sanktion eksekveret + verificeret. Tidligere nat-session ~01:30: #4155-reparation PROD+merged, #4154-sanktion eksekveret; ejer-GO pr. prod-skridt hele vejen. **Delt checkout skiftede branch uden varsel 24/8** — verificér ALTID branch før commit. Bemærk: `staging-cutover` BEHOLDES til #4159-guard-test — #3839-sletningen venter).

_Historik i git-log, issue-tråde + docs/audits/._
