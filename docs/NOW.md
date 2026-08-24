# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action:** Næste session = **monument-eksklusivitet (byg, ejer-GO 24/8) + #4159 guard-rest + #4162/#4164 hjælpetekster** — færdig prompt i master-sessionens sidste svar 24/8. Derefter: **#4180** race:gate (blokerer #4178/PR #4179, navne-dubletter meldt i Discord igen 24/8) · #4183-rest (systemisk placering) · v4-afvigelser (#4132) · #3512 · kalibrering (#3719/#3720). Efterprøv: smukkethomsens løbsdags-mærke-melding (16:21) + at Carolus (D4-A) fik entries af sweepen.

> **✅ KALENDER/BINDING-KÆDEN KØRT 24/8 ~16:05** (PR #4169 merged + #4173-migration + akse-reparation, ejer-GO pr. skridt): binding = dag-MÆNGDE (`race_entry_days`, 124.898 rækker, 0 konflikter) — Émirats-mønstret væk; aksen repareret (943 rækker, cap-brud 29→0, dubletter 163→0, D1 27→75 løbsdage); motor verificeret `on`. Patch note 7.183. Detaljer: #4173/#4161-tråde. #4163 løst tidligere samme dag (PR #4167, condeferrable-guard).

> **✅ CUTOVER S2→S3 GENNEMFØRT 23/8** (ejer-GO pr. skridt): 22 faser grønne, S3 aktiv 27 dage. c=0,811 varig (#4135). 7 D1-hold i minus ved start (upfront-model, forklaret). Log: git-log + issue-tråde.

> **⚖️ Fair play:** #3818 eksekveret 24/8 efter #4154-skabelonen (clawback af funnel-kontoens bruttobeløb + frys + auth-ban + advarsel in-game; #2221 var kun frys). Metode, tal og tekst: `docs/discord/2026-08-24-svarudkast-fairplay-3818.md`. **Ejer 24/8: prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord, har fået ingen forklaring.

> **💰 Værdier/løn S3-tilstand:** base_value = model(c 0,811 + type-dæmpning k=100); CPV dæmpet; løn = CPV × 0,35 frosset FØR transitionen (S2-alder, ejer-bekræftet rækkefølge). `wage_deduction_mode = season_upfront` (daily-flip = S3→S4). Upkeep S3 = 220k/70k/20k/0.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdatoer 25/8-20/9 (sæsoner slutter altid søndag).
- **Staging:** `scripts/refresh-staging.ps1` + `scripts/with-staging.ps1`; generalprøve FØR enhver destruktiv prod-op. `staging-cutover` slettes mandag (#3839).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation (ejer-mandat 22/8):** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **🤖 Ingen aktiv session** (master-sessionen 24/8 lukket ~18:00: kæden + #4183-swap kørt, PR #4182 merged, audit grøn, Discord-sweep krydset mod fixes — 3 kalender-spor tilbage, se Next action). Forrige sessions detaljer: #4172-tråden (D4-reparation udført, 157→1 tomme løb, motor verificeret on; #4170 lukket som dublet; guard-rest samlet i #4159).

_Historik i git-log, issue-tråde + docs/audits/._
