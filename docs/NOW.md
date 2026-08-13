# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (omskrevet 13/8 efter #3662) · **Arbejdsform:** arkitekt-model i hovedtråden, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Næste session:** **[#3666](https://github.com/NicolaiDolmer/CyclingZone/issues/3666) skalaen + alle visningsflader — SAMMEN med [#2454](https://github.com/NicolaiDolmer/CyclingZone/issues/2454)** (de kan ikke skilles: potentiel rating *er* opskriften på lofterne). Afblokeret 13/8. Kræver #3670 merged først. **Ny gate: loft-båndets halvbredder [12,8,5,3] skal måles på ny** — de er kalibreret til en skala hvor lofterne masede mod 99. Derefter transparens-sessionen ([`prompt`](sessions/2026-08-13-transparens-session-prompt.md), ejer-krav 13/8).

> **⭐ ALTOVERSKYGGENDE — spor B, designet LÅST 13/8:** 8 ejer-beslutninger i [#3664](https://github.com/NicolaiDolmer/CyclingZone/issues/3664)-tråden (læs den før #3666). Kæde: ~~#3665~~ → **#3666+#2454 sammen** → #3592 (skåret ned til capsShaping) → #3643/#3649 → #3667. **Tre landinger:** (1) "tallene er lagt om" før 23/8, nul rytterdata flytter sig · (2) capsShaping efter cutover, ENESTE del der ændrer ryttere, ejer-gated · (3) #3643 løbende. **`classifierWeights` FROSSET** — målt: alle 8.731 ryttere har `archetype_draw`, `primary_type` matcher 100 %, så den klassificerer nul. **#3668 → #3512 = ét spor lige efter cutover.**

> **📅 23/8 cutover (10 dage) — dato-bundet, viger ikke:** #3449 sweep **kører 14.-15/8** (løftet holdes ordret) → #3393 løn re-kalibreret mod post-sweep-fordeling → #3459 race-day-flip (flag verificeret `off` i prod) → #3514 mandat, **hård frist: merget + dry-run-godkendt 19/8 ellers ud**. **#3645 rollback = backup-tabel + genberegnings-script for BÅDE løn og mandat** (ejer-valg 13/8) — løn og mandat er de eneste uden kill-switch.

> **🧬 Progressionskæden ([#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564), spec §11-12 = SSOT).** **Blok 1 (identiteten) er LUKKET 13/8** — #3593 + #3591 pkt. 2 kørt og verificeret. **16/8→23/8, kun flow:** #3631 → **#3634 er presserende, ikke kosmetisk**: voksen-generatoren fødte 48 ryttere uden bitype 12/8, hullet fylder op ~24/døgn; invarianten `riders_identity_anchored` tæller det nu.

> **✅ Afklaret 13/8, kræver ingen handling:** auto-accept-floor 15/8 bliver stående (fair-window #3584 er i main → 20/8 rammer kun inaktive hold, aktive først 25/8). Penge-sporet (#2853 → #2813 → #3104) er **betinget** — gaten er spor B leveret.

> **📋 Sessionsplan 13.-23/8:** [`docs/sessions/2026-08-13-sessionsplan-3662.md`](sessions/2026-08-13-sessionsplan-3662.md) — 8 sessioner med model-anbefaling pr. stk.

> **👤 Dine klik:** [#3486](https://github.com/NicolaiDolmer/CyclingZone/issues/3486) `VERCEL_TOKEN` (låser #1784) · #3393 kurve/eksponent/sats før merge · #3425 mobilbundbar A/B (5 min, venter siden 7/8) · **POST kommunikationspakken** (`docs/discord/2026-08-10-*.md`) + **[patch notes v7.112-7.117](discord/2026-08-12-patch-notes-catchup.md)** — klar til copy-paste, ikke postet.

> **📌 Opfølgninger:** #3620 kontraktår (regression af lukkede #2881, åben siden 24/7) · #3541 · #3669 (ny 13/8) · #3586 · #3172 CI-flake · #3640 · #3633. Gæld: **546 åbne, done-pukkel 23** (talt 13/8 — de gamle tal 524/19 var forkerte). 23 done-men-åbne kan lukkes; #3094 er duplikat af #2883.

> **🤖 Working agent:** Ingen aktiv session. Sidst: rytter-pakkens designsession 13/8 — designet låst + **fase 1 MERGED** ([PR #3670](https://github.com/NicolaiDolmer/CyclingZone/pull/3670) → `38f8ab8a`; 5.919 backend-tests, 1.863 frontend-tests, e2e 404/3 projekter, vagter re-verificeret på main efter merge). Merged samme dag: #3641 (CI-boardet) + #3663 (v7.118 close-out). **Transparens-sessionen er startet for tidligt** (kører rettelig efter landing 1) — den er orienteret og laver auditten i mellemtiden. **To fund værd at huske:** frontend-vægtkopien var allerede drevet (cobblestone 5 mod 6, `climbing:1`-krydsled #3325 fjernede, flat 2 mod 4) — drift-vagten gør det umuligt nu. Og den nye delmængde-vagt fandt et **femte** uadskilleligt rollepar ud over #3592's fire: `climber ⊆ gc`, rettet med `punch 1` tilbage til bjergrytteren. **Målt:** den nye skala er MINDRE træningsfølsom end den gamle (38,3 % vs 28,8 % uden bevægelse på en uge) → #3643 skal bære følelsen, ikke rating-tallet.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; D1 = kun AI. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag i puljen. **Pension:** måles på AFSLUTTET sæsons alder.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben (service-key-rotation). **Skalering:** #323.

_Historik i git-log, issue-tråde + docs/audits/._
