# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. Hard rules 24-28 i AGENTS.md (#3661).

## Aktiv styring

> **🎯 Next action:** **Se de fire tynde endagsløb i spillet** (Le Mur de Huy 16 ryttere, Taunus-Klassiker 25, La Classique Bretonne 32, Grand Prix du Saint-Laurent 33, mod 101-128 for alle andre D1-endagsløb på samme afstand). Ejeren vil se dem selv før de fyldes op; forslaget er at rydde auto-udtagelserne på løbsdag 34/39/41/42 og lade generatoren fordele forfra (506 auto ryddes, 58 manuelle bevares). Derefter: **GT-komprimeringen** under #4176, som blokerer #4203 og #4209. **#4174** mangler ét svar: hvor højt de inaktive hold fyldes op. **#4192**-listen afventer din markering.


> **⚖️ Fair play:** #3818 eksekveret 24/8 efter #4154-skabelonen (clawback af funnel-kontoens bruttobeløb + frys + auth-ban + advarsel in-game; #2221 var kun frys). Metode, tal og tekst: `docs/discord/2026-08-24-svarudkast-fairplay-3818.md`. **Ejer 24/8: prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord, har fået ingen forklaring.

> **👥 Collab-gate live 24/8:** `main` kræver nu ejer-review (CODEOWNERS catch-all + `dismiss_stale_reviews`; 24 checks bevaret) + actor-guard på `auto-merge`. PR #4187 · `CONTRIBUTING.md` · `scripts/apply-collab-branch-protection.sh` (idempotent). Rest: **#4188** delt dev-Supabase + invitér hjælpere · **#4189** må collaborators trigge `@claude` på ejerens kvote (anbefaling: nej).

> **💰 Værdier/løn S3-tilstand:** base_value = model(c 0,811 + type-dæmpning k=100); CPV dæmpet; løn = CPV × 0,35 frosset FØR transitionen (S2-alder, ejer-bekræftet rækkefølge). `wage_deduction_mode = season_upfront` (daily-flip = S3→S4). Upkeep S3 = 220k/70k/20k/0.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb/dag. **Pension:** måles på AFSLUTTET sæsons alder. **S3:** første løbsdag TIR 25/8, 27 løbsdatoer 25/8-20/9 (sæsoner slutter altid søndag).
- **Staging:** `scripts/refresh-staging.ps1` + `scripts/with-staging.ps1`; generalprøve FØR enhver destruktiv prod-op. `staging-cutover` slettes mandag (#3839).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation (ejer-mandat 22/8):** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik + svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.


> **📋 SESSION 24/8 AFTEN:** **#4191 live** (1,0 mio. inserts på 135k rækker; diff-rebuild + daglig drift-vagt, verificeret 0/0 mod prod). **#4192** alle 38 træningsbeslutninger listet: 15 bygget, 10 delvist, 8 ikke, 4 overhalet, 3 afvigelser. **#4174** kravet er 22/21/12/12 og 78 % af de AKTIVE hold klarer det; ejeren valgte at fylde inaktive trupper op med rå 49-statister. Nye fund: **#4206** (965 ryttere med identiske stats).

> **📐 AKSEN ER SLOT, IKKE DAG (24/8, afgørende):** D1 har 80 slots over 27 datoer (2,96 pr. dato), D2/D3 2,00, D4 1,07. 95 etapeløb har huller i SLOTS, men kun 9 springer en KALENDERDATO over, og **471 af 471 løb bruger allerede lige så mange løbsdage som de har etaper**. **#4190 skrevet om** til navngivning + invariant; **#4209 i bero** (nul reelle hviledage i S3).

> **⚠️ #4203 KØRT OG RULLET TILBAGE 24/8 22:05** (ejer-GO pr. skridt): monument-byttet bestod sin egen post-verify men brød **#4075** — alle fire flyttede Monumenter delte løbsdag med 1-2 andre løb. Den daglige invariant-audit fangede det. Rullet tilbage; kalenderen er den oprindelige, alle fire invarianter grønne, 0 monumenter deler dag. **Rest-skade:** fire endagsløb står tynde, fordi assistenten nåede at omfordele rytterne mens byttet var aktivt. Målt rodårsag: D1 har kun 6 løbsdage uden for et GT-vindue, og der skal bruges fire. Discord-udkastet er markeret MÅ IKKE POSTES. Postmortem: `.claude/learnings/2026-08-24-migration-bestod-egen-gate-men-brod-en-anden-regel.md`.

> **🤖 Ingen aktiv session** (aften-sessionen 24/8 lukket: #4191 + #4192 merged og live, #4203 kørt og rullet tilbage, aksen afklaret, #4190 omskrevet, #4209 i bero).

_Historik i git-log, issue-tråde + docs/audits/._
