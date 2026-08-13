# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (omskrevet 13/8 efter #3662) · **Arbejdsform:** arkitekt-model i hovedtråden, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Næste session:** **rytter-pakkens designsession ([#3664](https://github.com/NicolaiDolmer/CyclingZone/issues/3664))** — hele pakken designes færdig med ejeren FØR første linje kode, derefter bygges #3665 og videre i samme session. Ejer-krav 13/8: kvalitet over tempo, skal lande ordentligt første gang. Prompt + de 8 spørgsmål: [`docs/sessions/2026-08-13-rytter-pakke-designsession-prompt.md`](sessions/2026-08-13-rytter-pakke-designsession-prompt.md). **Ryd bordet først: merge PR #3641 + #3663.** Model: Opus 5 høj reasoning + sonnet-workers.

> **⭐ ALTOVERSKYGGENDE — spor B, startet 13/8:** ejer-mandat ordret: *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3."* Rammen er **loft, potentiale, ryttertyper og følelsen af at træning ikke virker**. Kæde: #3665 → #3666 → #2454 → #3592 → capsShaping → #3643/#3649 → #3667. Spec: [`rating-fundament-v3`](superpowers/specs/2026-08-13-rating-fundament-v3-design.md). **#3668 rod-fix udskudt igen** (ejer 13/8: de faktisk viste stats kan vente) → vej A står, de 8 opskrifter i §3 gælder som skrevet.

> **📅 23/8 cutover (10 dage) — dato-bundet, viger ikke:** #3449 sweep **kører 14.-15/8** (løftet holdes ordret) → #3393 løn re-kalibreret mod post-sweep-fordeling → #3459 race-day-flip (flag verificeret `off` i prod) → #3514 mandat, **hård frist: merget + dry-run-godkendt 19/8 ellers ud**. **#3645 rollback = backup-tabel + genberegnings-script for BÅDE løn og mandat** (ejer-valg 13/8) — løn og mandat er de eneste uden kill-switch.

> **🧬 Progressionskæden ([#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564), spec §11-12 = SSOT).** **Blok 1 (identiteten) er LUKKET 13/8** — #3593 + #3591 pkt. 2 kørt og verificeret. **16/8→23/8, kun flow:** #3631 → **#3634 er presserende, ikke kosmetisk**: voksen-generatoren fødte 48 ryttere uden bitype 12/8, hullet fylder op ~24/døgn; invarianten `riders_identity_anchored` tæller det nu.

> **✅ Afklaret 13/8, kræver ingen handling:** auto-accept-floor 15/8 bliver stående (fair-window #3584 er i main → 20/8 rammer kun inaktive hold, aktive først 25/8). Penge-sporet (#2853 → #2813 → #3104) er **betinget** — gaten er spor B leveret.

> **📋 Sessionsplan 13.-23/8:** [`docs/sessions/2026-08-13-sessionsplan-3662.md`](sessions/2026-08-13-sessionsplan-3662.md) — 8 sessioner med model-anbefaling pr. stk.

> **👤 Dine klik:** [PR #3641](https://github.com/NicolaiDolmer/CyclingZone/pull/3641) go (eller drop boardet) · [#3486](https://github.com/NicolaiDolmer/CyclingZone/issues/3486) `VERCEL_TOKEN` (låser #1784) · #3393 kurve/eksponent/sats før merge · #3425 mobilbundbar A/B (5 min, venter siden 7/8) · **POST kommunikationspakken** (`docs/discord/2026-08-10-*.md`) + **[patch notes v7.112-7.117](discord/2026-08-12-patch-notes-catchup.md)** — klar til copy-paste, ikke postet.

> **📌 Opfølgninger:** #3620 kontraktår (regression af lukkede #2881, åben siden 24/7) · #3541 · #3669 (ny 13/8) · #3586 · #3172 CI-flake · #3640 · #3633. Gæld: **546 åbne, done-pukkel 23** (talt 13/8 — de gamle tal 524/19 var forkerte). 23 done-men-åbne kan lukkes; #3094 er duplikat af #2883.

> **🤖 Working agent:** Ingen aktiv session. Sidst: #3662 planlægningssession 13/8 — 12 ejer-beslutninger, MASTERPLAN omskrevet, sessionsplan lagt, #3669 oprettet. **Merged 13/8: [PR #3648](https://github.com/NicolaiDolmer/CyclingZone/pull/3648) (#3593 + #3591, v7.118)** — kørt i prod m. ejer-go: `archetype_draw.secondary` udfyldt for **606** ryttere (post-verify 0/0/0/0) + lofter genberegnet for **516** (453 op, 63 ned; 0 type-skift, 0 værdiflytning, 0 gulv-brud). Backups: `riders_3593_backup_20260811`, `rider_caps_3591_backup_20260813` (navnene bærer forkert dato — maskinens ur var 2 døgn bagud). Rod-årsagen lukket: `buildCapsForRider`'s `age` er nu **påkrævet**; et fjerde kaldsted (`starterSquadAllocator`) manglede den. [Postmortem 12/8](../.claude/learnings/2026-08-12-aggregatet-viste-det-bedste-medlem-som-helhedens-tilstand.md).

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; D1 = kun AI. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag i puljen. **Pension:** måles på AFSLUTTET sæsons alder.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben (service-key-rotation). **Skalering:** #323.

_Historik i git-log, issue-tråde + docs/audits/._
