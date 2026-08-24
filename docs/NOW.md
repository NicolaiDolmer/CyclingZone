# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action:** (1) **TÆND RACE-MOTOREN** — `stage_scheduler_enabled` står `off` (slukket af #4172-scriptet, gen-tænding er ejer-only). SKAL være `on` før 25/8 kl. 11. (2) **#4180 race:gate utroværdig** — fejler på 6 af 30 tilfældige seeds; 3 hardcodede seeds giver falsk tryghed. Blokerer #4178 (navne-pools, draft). (3) **#4159** forward-guard + `d4PoolCount`-fix så S3→S4 ikke gentager #4172. (4) Ejeren poster: forum + Fakta-DM + community-linje. Derefter: v4-afvigelser (#4132) · #3512 · kalibrering (#3719/#3720).

> **✅ #4163 LØST + APPLIED 24/8** (ejer-GO, PR #4167): #4155 havde genskabt `no_rider_double_booking` UDEN `deferrable` → sweepen i deterministisk dødvande. Prod verificeret (condeferrable=true, 0 overlap, sweepen skriver igen); Sentry ren. Forward-guard `lint-constraint-form.mjs` (commit-hook+preflight+CI) + runtime-diagnose i sweepen; bagud-tjek rent. Postmortem i `.claude/learnings/`. **#4159 bør tilføje `condeferrable=true` som 3. blokerende tælling.**

> **✅ CUTOVER S2→S3 GENNEMFØRT 23/8** (ejer-GO pr. skridt): 22 faser grønne, S3 aktiv 27 dage. c=0,811 varig (#4135). 7 D1-hold i minus ved start (upfront-model, forklaret). Log: git-log + issue-tråde.

> **⚖️ Fair play:** #3818 eksekveret 24/8 efter #4154-skabelonen (clawback af funnel-kontoens bruttobeløb + frys + auth-ban + advarsel in-game; #2221 var kun frys). Metode, tal og tekst: `docs/discord/2026-08-24-svarudkast-fairplay-3818.md`. **Ejer 24/8: prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord, har fået ingen forklaring.

> **💰 Værdier/løn S3-tilstand:** base_value = model(c 0,811 + type-dæmpning k=100); CPV dæmpet; løn = CPV × 0,35 frosset FØR transitionen (S2-alder, ejer-bekræftet rækkefølge). `wage_deduction_mode = season_upfront` (daily-flip = S3→S4). Upkeep S3 = 220k/70k/20k/0.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdatoer 25/8-20/9 (sæsoner slutter altid søndag).
- **Staging:** `scripts/refresh-staging.ps1` + `scripts/with-staging.ps1`; generalprøve FØR enhver destruktiv prod-op. `staging-cutover` slettes mandag (#3839).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation (ejer-mandat 22/8):** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **🤖 Master-session AKTIV 24/8 ~15:00** (Claude Code, hoved-checkout + worktree): #4173-kæden → akse-reparation → PR #4169 før sæsonstart 25/8 kl. 11. Ejer-godkendt plan: begge prod-skridt i dag. Forrige sessions detaljer: #4172-tråden (D4-reparation udført, 157→1 tomme løb, motor verificeret on; #4170 lukket som dublet; guard-rest samlet i #4159).

_Historik i git-log, issue-tråde + docs/audits/._
