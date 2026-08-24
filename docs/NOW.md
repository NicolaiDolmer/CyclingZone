# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action:** **Tre PR'er grønne og klar til dit review:** [#4208](https://github.com/NicolaiDolmer/CyclingZone/pull/4208) (monument-byttet, rebaset så dens to lint-fejl er væk; optælling af de 22 manuelle udtagelser den rydder ligger på PR'en) · [#4205](https://github.com/NicolaiDolmer/CyclingZone/pull/4205) (#4191 diff-rebuild) · [#4207](https://github.com/NicolaiDolmer/CyclingZone/pull/4207) (#4192-listen). Derefter: **GT-komprimeringen** under #4176 (Giroen kører 18 etaper på 6 dage, nul hviledage) og **#4174** (mangler ét svar: hvor højt de inaktive hold fyldes op). Nyt fund: **#4206** (965 ryttere med identiske stats).

> **✅ KALENDER-KÆDEN LUKKET 24/8** (ejer-GO pr. skridt): binding = dag-mængde · aksen repareret (cap-brud 29→0) · monument = eksklusiv løbsdag genoprettet i S3. Alle 4 invarianter grønne, gated på 3 niveauer + dagligt CI-job. Regel-SSOT: `docs/CALENDAR_RULES.md`.


> **⚖️ Fair play:** #3818 eksekveret 24/8 efter #4154-skabelonen (clawback af funnel-kontoens bruttobeløb + frys + auth-ban + advarsel in-game; #2221 var kun frys). Metode, tal og tekst: `docs/discord/2026-08-24-svarudkast-fairplay-3818.md`. **Ejer 24/8: prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord, har fået ingen forklaring.

> **👥 Collab-gate live 24/8:** `main` kræver nu ejer-review (CODEOWNERS catch-all + `dismiss_stale_reviews`; 24 checks bevaret) + actor-guard på `auto-merge`. PR #4187 · `CONTRIBUTING.md` · `scripts/apply-collab-branch-protection.sh` (idempotent). Rest: **#4188** delt dev-Supabase + invitér hjælpere · **#4189** må collaborators trigge `@claude` på ejerens kvote (anbefaling: nej).

> **💰 Værdier/løn S3-tilstand:** base_value = model(c 0,811 + type-dæmpning k=100); CPV dæmpet; løn = CPV × 0,35 frosset FØR transitionen (S2-alder, ejer-bekræftet rækkefølge). `wage_deduction_mode = season_upfront` (daily-flip = S3→S4). Upkeep S3 = 220k/70k/20k/0.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdatoer 25/8-20/9 (sæsoner slutter altid søndag).
- **Staging:** `scripts/refresh-staging.ps1` + `scripts/with-staging.ps1`; generalprøve FØR enhver destruktiv prod-op. `staging-cutover` slettes mandag (#3839).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation (ejer-mandat 22/8):** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.


> **✅ #4180 + #4178 + #4183 LUKKET 24/8:** race:gate kører nu 50 seeds med aggregat-dom (falsk alarm 0,04 %); navne-RNG skilt fra stat-RNG. #4183: placeringen talte ikke frosne hold med. Prod repareret, alle 15 puljer på 24.

> **📋 SESSION 24/8 AFTEN:** **#4190 diagnosen vendt:** pakkerens output har 0 huller i D2/D3/D4, kun bevidste monument-/GT-hviledags-indskud i D1; de 167 uforklarede huller i S3 kommer fra `deriveGameDayAxis`. **#4174 præmis forældet:** kravet er 22/21/12/12 og 78 % af de AKTIVE hold klarer det (issuets 21 % talte 142 inaktive med); ejeren afviste alle tre kalender-veje: hjælp trupperne i stedet. **#4191** 1,0 mio. inserts på 135k rækker; diff-rebuild verificeret på staging + ækvivalens mod prod (0/0). **#4192** alle 38 beslutninger listet i `docs/audits/2026-08-24-4192-traening-beslutningsliste.md`: 15 bygget, 10 delvist, 8 ikke, 4 overhalet, 3 afvigelser.

> **📐 AKSEN ER SLOT, IKKE DAG (24/8, afgørende):** `game_day` er et halvdags-slot. D1 har 80 slots over 27 datoer (2,96 pr. dato), D2/D3 præcis 2,00, D4 1,07. Målt konsekvens: 95 etapeløb har huller i SLOTS, men kun 9 springer en KALENDERDATO over, og **471 af 471 løb bruger allerede lige så mange løbsdage som de har etaper**. **#4190 skrevet om** til navngivning + invariant (ejer-go); sammenhængs-reglen bortfalder. **#4209 sat i bero:** der findes nul reelle hviledage i S3, så der er ingen hviledag at binde på.

> **🤖 Ingen aktiv session** (aften-sessionen 24/8 lukket: aksen afklaret, #4190 omskrevet, #4209 i bero, #4191 fikset, #4192-listen leveret, #4208 rebaset og målt op).

_Historik i git-log, issue-tråde + docs/audits/._
