# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action:** (1) **#4183 ejer-beslutning** — ny spiller blev hold nr. 25 i D3-A; ALLE puljer er 24/24 fulde, nye tilmeldinger har ingen plads. **S3's første løbsdag er TIR 25/8.** (2) **#4197** — strukturelt GC-orakel fejler på 2 af 50 seeds i rute-stien (GC-vinderen har ikke feltets laveste tid); `race:gate:routes` er permanent rød og har skjult det. (3) **#4159-rest:** DB-trigger-laget (relationel, ikke dato-formel — se #4159-tråden). Derefter: v4-afvigelser (#4132) · #3512 · kalibrering (#3719/#3720) · #4195/#4196.

> **✅ KALENDER-KÆDEN LUKKET 24/8** (ejer-GO pr. skridt): binding = dag-MÆNGDE (`race_entry_days`) · aksen repareret (cap-brud 29→0) · **monument = eksklusiv løbsdag** genoprettet i live S3 (107 rækker i D1, akse 75→80 løbsdage, monument-brud 5→0, ingen etape flyttede dato) · `game_day_start` resynket for 334 løb (gårsdagens halve reparation). Alle 4 kalender-invarianter grønne i `verify-invariants`. Reglen er nu gated på 3 niveauer + dagligt CI-job (`calendar-invariant-audit.yml`). PR #4185, patch note 7.184. Regel-SSOT: `docs/CALENDAR_RULES.md`.

> **✅ CUTOVER S2→S3 GENNEMFØRT 23/8** (ejer-GO pr. skridt): 22 faser grønne, S3 aktiv 27 dage. c=0,811 varig (#4135). 7 D1-hold i minus ved start (upfront-model, forklaret). Log: git-log + issue-tråde.

> **⚖️ Fair play:** #3818 eksekveret 24/8 efter #4154-skabelonen (clawback af funnel-kontoens bruttobeløb + frys + auth-ban + advarsel in-game; #2221 var kun frys). Metode, tal og tekst: `docs/discord/2026-08-24-svarudkast-fairplay-3818.md`. **Ejer 24/8: prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord, har fået ingen forklaring.

> **💰 Værdier/løn S3-tilstand:** base_value = model(c 0,811 + type-dæmpning k=100); CPV dæmpet; løn = CPV × 0,35 frosset FØR transitionen (S2-alder, ejer-bekræftet rækkefølge). `wage_deduction_mode = season_upfront` (daily-flip = S3→S4). Upkeep S3 = 220k/70k/20k/0.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdatoer 25/8-20/9 (sæsoner slutter altid søndag).
- **Staging:** `scripts/refresh-staging.ps1` + `scripts/with-staging.ps1`; generalprøve FØR enhver destruktiv prod-op. `staging-cutover` slettes mandag (#3839).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation (ejer-mandat 22/8):** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **✅ RACE:GATE GJORT TROVÆRDIG 24/8** (#4180, PR #4194 afventer ejer-merge): gaten fejlede 42 % af 400 tilfældige seeds med uændret kode. Nu 50 seeds med aggregat-dom, måltal uændrede, falsk alarm 0,04 %, CI 5s→47s. Navne-RNG skilt fra stat-RNG → #4179 er målt til 4.000/4.000 identiske stats og kan merges efter #4194. Tre pre-eksisterende fund udskilt: #4195 (værdimodellens top-hældning) · #4196 (balance-baseline rådnet bag advisory-check) · #4197 (rute-stiens GC-orakel).

> **🤖 Ingen aktiv session** (master-sessionen 24/8 lukket ~18:00: kæden + #4183-swap kørt, PR #4182 merged, audit grøn, Discord-sweep krydset mod fixes — 3 kalender-spor tilbage, se Next action). Forrige sessions detaljer: #4172-tråden (D4-reparation udført, 157→1 tomme løb, motor verificeret on; #4170 lukket som dublet; guard-rest samlet i #4159).

_Historik i git-log, issue-tråde + docs/audits/._
