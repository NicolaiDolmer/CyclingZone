# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action:** **Næste session: [prompt](sessions/2026-08-25-kalender-og-traening-ssot-session-prompt.md)** — kalenderen først (#4190 sammenhængende løbsdage · #4174 rytterkrav · #4191 churn), derefter træningens SSOT (#4192, første leverance = liste over de ~35 beslutninger). Afventer ejer: **PR #4182** (transition-gate-hul + inEmptyPool-dedup) — eneste åbne PR. Nye fund fra #4180: **#4197** (strukturelt GC-orakel fejler i rute-stien) · #4195 · #4196.

> **✅ KALENDER-KÆDEN LUKKET 24/8** (ejer-GO pr. skridt): binding = dag-MÆNGDE (`race_entry_days`) · aksen repareret (cap-brud 29→0) · **monument = eksklusiv løbsdag** genoprettet i live S3 (107 rækker i D1, akse 75→80 løbsdage, monument-brud 5→0, ingen etape flyttede dato) · `game_day_start` resynket for 334 løb (gårsdagens halve reparation). Alle 4 kalender-invarianter grønne i `verify-invariants`. Reglen er nu gated på 3 niveauer + dagligt CI-job (`calendar-invariant-audit.yml`). PR #4185, patch note 7.184. Regel-SSOT: `docs/CALENDAR_RULES.md`.


> **⚖️ Fair play:** #3818 eksekveret 24/8 efter #4154-skabelonen (clawback af funnel-kontoens bruttobeløb + frys + auth-ban + advarsel in-game; #2221 var kun frys). Metode, tal og tekst: `docs/discord/2026-08-24-svarudkast-fairplay-3818.md`. **Ejer 24/8: prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord, har fået ingen forklaring.

> **👥 Collab-gate live 24/8:** `main` kræver nu ejer-review (CODEOWNERS catch-all + `dismiss_stale_reviews`; 24 checks bevaret) + actor-guard på `auto-merge`. PR #4187 · `CONTRIBUTING.md` · `scripts/apply-collab-branch-protection.sh` (idempotent). Rest: **#4188** delt dev-Supabase + invitér hjælpere · **#4189** må collaborators trigge `@claude` på ejerens kvote (anbefaling: nej).

> **💰 Værdier/løn S3-tilstand:** base_value = model(c 0,811 + type-dæmpning k=100); CPV dæmpet; løn = CPV × 0,35 frosset FØR transitionen (S2-alder, ejer-bekræftet rækkefølge). `wage_deduction_mode = season_upfront` (daily-flip = S3→S4). Upkeep S3 = 220k/70k/20k/0.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdatoer 25/8-20/9 (sæsoner slutter altid søndag).
- **Staging:** `scripts/refresh-staging.ps1` + `scripts/with-staging.ps1`; generalprøve FØR enhver destruktiv prod-op. `staging-cutover` slettes mandag (#3839).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation (ejer-mandat 22/8):** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.


> **✅ #4180 + #4178 + #4183 LUKKET 24/8:** race:gate fejlede 42 % af 400 tilfældige seeds med uændret kode — nu 50 seeds med aggregat-dom (måltal uændrede, falsk alarm 0,04 %, CI 5s→47s). Navne-RNG skilt fra stat-RNG, så navnelister ikke kan flytte stats; #4179 målt til 4.000/4.000 identiske stats og merged. **#4183 rodårsag:** placeringen talte ikke frosne hold med, så to fulde D3-puljer så ledige ud og fik dagens tre tilmeldinger. Prod repareret pr. ejer-go (Plattentuub→D4-B, Landbouwkrediet→D4-C, begge puljer reconciled) — **alle 15 puljer på 24, audit grøn.**

> **🤖 Ingen aktiv session** (24/8 lukket: kalender-kæden + #4075 monument-reglen i prod · #4180/#4178/#4183 landet · #4198 løbskort-datoer · audit grøn). NB: #4191 er i gang i worktree `perf/4191-race-entry-days-diff`.

_Historik i git-log, issue-tråde + docs/audits/._
