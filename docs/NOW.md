# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (omskrevet 13/8 efter #3662) · **Arbejdsform:** arkitekt-model i hovedtråden, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Aktiv session:** **landing 1, RESTEN** — kravspec: [`sessions/2026-08-14-landing1-fortsaettelse-prompt.md`](sessions/2026-08-14-landing1-fortsaettelse-prompt.md). Arbejd i worktreet `CyclingZone-worktrees/feat-3666-rating-skala-landing1` (rebaset på main, **ingen PR endnu**). Rækkefølge: badge-formen (14 kaldsteder) → scouting-kortet D4 + #3671's UI → #2454 (10 flader, kræver ny backend-sti først) → Udvikling-fanen → dead code → #3667 → snapshots → PR. **FÆRDIGT:** backend-kernen, det relative scout-gulv, farveskalaen + CI-vagt, radaren, verdict-tærsklerne (frontend 1873/1873, backend exit 0). **Ejer-klik venter:** [#3679](https://github.com/NicolaiDolmer/CyclingZone/issues/3679) + R1-missen (7 mod ≤6, anbefaling: land med 7).

> **⭐ ALTOVERSKYGGENDE — spor B, designet LÅST 13/8:** 8 ejer-beslutninger i [#3664](https://github.com/NicolaiDolmer/CyclingZone/issues/3664)-tråden (læs den før #3666). Kæde: ~~#3665~~ → **#3666+#2454 sammen** → #3592 (skåret ned til capsShaping) → #3643/#3649 → #3667. **Tre landinger:** (1) "tallene er lagt om", nul rytterdata flytter sig · (2) **[#3682](https://github.com/NicolaiDolmer/CyclingZone/issues/3682) positionerings-loftet** — målt +2,83 potentiel rating for 4.747 ryttere i FIRE roller (tidskøreren taget ud 13/8); ENESTE del der ændrer ryttere, ejer-gated, skal være gulv-løft · (3) #3643 løbende. **`classifierWeights` FROSSET** — målt: alle 8.731 ryttere har `archetype_draw`, `primary_type` matcher 100 %, så den klassificerer nul. **#3668 → #3512 = ét spor lige efter cutover.**

> **📅 23/8 cutover (10 dage) — dato-bundet, viger ikke:** #3449 sweep **kører 14.-15/8** (løftet holdes ordret) → #3393 løn re-kalibreret mod post-sweep-fordeling → #3459 race-day-flip (flag verificeret `off` i prod) → #3514 mandat, **hård frist: merget + dry-run-godkendt 19/8 ellers ud**. **#3645 rollback = backup-tabel + genberegnings-script for BÅDE løn og mandat** (ejer-valg 13/8) — løn og mandat er de eneste uden kill-switch.

> **🧬 Progressionskæden ([#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564), spec §11-12 = SSOT).** **Blok 1 (identiteten) er LUKKET 13/8** — #3593 + #3591 pkt. 2 kørt og verificeret. **16/8→23/8, kun flow:** #3631 → **#3634 er presserende, ikke kosmetisk**: voksen-generatoren fødte 48 ryttere uden bitype 12/8, hullet fylder op ~24/døgn; invarianten `riders_identity_anchored` tæller det nu.

> **✅ Afklaret 13/8, kræver ingen handling:** auto-accept-floor 15/8 bliver stående (fair-window #3584 er i main → 20/8 rammer kun inaktive hold, aktive først 25/8). Penge-sporet (#2853 → #2813 → #3104) er **betinget** — gaten er spor B leveret.

> **📋 Sessionsplan 13.-23/8:** [`docs/sessions/2026-08-13-sessionsplan-3662.md`](sessions/2026-08-13-sessionsplan-3662.md). **I MORGEN 14/8 er patch-notes-formatet** (ejer 13/8: for lange og rodede, ikke til at læse for spillere) [#3680](https://github.com/NicolaiDolmer/CyclingZone/issues/3680) + [prompt](sessions/2026-08-14-patch-notes-format-prompt.md); derefter omskrives hele den uposteede backlog v7.112-7.120. **Post ikke de eksisterende Discord-udkast som de er.**

> **👤 Dine klik:** [#3486](https://github.com/NicolaiDolmer/CyclingZone/issues/3486) `VERCEL_TOKEN` (låser #1784) · #3393 kurve/eksponent/sats før merge · #3425 mobilbundbar A/B (venter siden 7/8) · **POST kommunikationspakken** (`docs/discord/2026-08-10-*.md`) + **[patch notes v7.112-7.120](discord/2026-08-12-patch-notes-catchup.md)**: nu inkl. v7.119+v7.120 (scout-tooltips, to usande hjælpe-svar, tillids-chippen), klar til copy-paste, ikke postet.

> **📌 Opfølgninger:** **#3679** loft-båndet er inverterbart (præ-eksisterende) · **#3678 = duplikat af #2511** perf-gaten på main · **#3681** backwards-check: øvrige håndholdte kopier · **#3671** scout-gulvet (kun teksten rettet, mekanikken køber stadig intet for 149 hold) · #3620 kontraktår (regression af lukkede #2881, åben siden 24/7) · #3541 · #3669 (ny 13/8) · #3586 · #3172 CI-flake · #3640 · #3633. Gæld: **546 åbne, done-pukkel 23** (talt 13/8 — de gamle tal 524/19 var forkerte). 23 done-men-åbne kan lukkes; #3094 er duplikat af #2883.

> **🤖 Working agent:** **Landing 1 kører (Claude Code, 14/8)** på `feat/3666-rating-skala-landing1`. Bygget indtil nu: backend-kernen, det relative scout-gulv (#3671), farveskalaen + CI-vagt, radaren, verdict-tærsklerne. Transparens-auditten ([`docs/audits/2026-08-13-transparens-flade-audit.md`](audits/2026-08-13-transparens-flade-audit.md)) er **kravspec** — seks rækker venter, og `faq.riderRating` ("the very best riders sit near 99") bliver falsk i samme sekund skalaen lander, så den skal med i SAMME PR. **Tre fund:** (1) spec §D1 tager fejl — bedste rytter viser **85, ikke ~72**, og han er PÅ sit loft; toppen står tom fordi ingens LOFTER når 99. (2) Loft-båndet er **inverterbart** fra to scout-niveauer (#3679), harness som `todo` i `ceilingBandInversion.test.js`. (3) Mocken havde **aldrig** en handler for `rider_derived_abilities` — profilens evner kunne aldrig ses på preview; lukket nu.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; D1 = kun AI. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag i puljen. **Pension:** måles på AFSLUTTET sæsons alder.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben (service-key-rotation). **Skalering:** #323.

_Historik i git-log, issue-tråde + docs/audits/._
