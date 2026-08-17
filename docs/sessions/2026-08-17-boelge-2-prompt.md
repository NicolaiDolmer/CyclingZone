# Bølge 2: cutover-kernen + de vigtigste spillermærkbare ting

Skrevet ved close-out af bølge 1-sessionen 17/8 (8 PR'er merget: #3820 til #3825, #3827, #3828). Ejer-valg for denne bølge: blandet fokus, uden om motoren, ~8 spor. Kopiér blokken nederst til den nye session.

## Prompt

```
Kør bølge 2: cutover-forberedelsen til 23/8 + de vigtigste spillermærkbare ting.
Anbefalet: Fable/Opus som orkestrator, høj indsats; udførende workers på Sonnet.

START MED at læse docs/NOW.md, docs/MASTERPLAN.md (sektion A + F) og
docs/sessions/2026-08-17-boelge-2-prompt.md.
Kontekst fra bølge 1 (17/8): 8 PR'er merget (#3820-#3825, #3827, #3828).
Trin 7 (#3798) er PARKERET af mig; staging-branchen staging-3746-trin7 står
med prod-kopi + kørt backfill og må bruges til test, aldrig slettes uden mit ok.

═══ SPOR 0: CUTOVER-BESLUTNINGERNE (før agenter launches) ═══

PR #3801 (drejebogs-udkast for 23/8, #3645) stiller fire spørgsmål i sin body.
Stil dem til mig ÉN ad gangen med din anbefaling, vigtigst først: skal 23/8
reduceres til race-day-flippet alene, når kun 1 af 4 komponenter er klar?
Når alle fire er besvaret: opdatér drejebogen efter svarene, merge #3801,
og lad spor 1 bygge ud fra beslutningerne.

═══ BØLGEN (~8 spor, én worker pr. spor i egen worktree) ═══

1. #3645 drejebogens VÆRKTØJ (mit valg 13/8: backup + genberegnings-scripts
   for BÅDE løn og mandat, ikke kun en skreven plan) + rollback-procedure.
   Dry-run som default, apply er ejer-gated. Ingen prod-mutation.
2. #3618 akademi-kvoten. Uindfriet spillerløfte fra 10/8, og køen voksede
   368 til 772 på tre dage. Rod-årsag + fix + måling af køen før/efter.
3. #3715 forkortede kontrakter: rod-årsag FØR datareparation (#3620 er
   lukket). Reparations-script med dry-run; apply venter på mit go.
4. Indbakke-pakken (W6): #3496 #3493 #3491 #3549. Samme rod-domæne, én
   agent; tjek fil-overlap før fan-out.
5. Hjælp/transparens (W7-rest): #3623 #3551 #3456 #3412 #2889. Forfilter
   hårdt: flere kan være dækket af trin 7-PR'en eller bølge 1.
6. Små bugs fra E-blokken: #3669 (forhandlet byttetilbud kan ikke afvises)
   + #3541 (skadedage vises forskelligt tre steder).
7. Marked-småfix: #3826 (proxy-endpointets trup-tjek mangler akademi-
   fallback, fund fra bølge 1) + #3067 + #2400. Forfilter for allerede-løst.
8. #3819 Clarity-analytics: ~4.000 "unikke brugere" 3/8 mod 35 ægte,
   syntetisk self-referral-trafik. Diagnose + filter, så uge-tallene kan bruges.

═══ BINDENDE ═══

- Følg docs/NIGHT_WAVE_RUNBOOK.md: preflight-night-wave.ps1 -Fix først (kræv GO),
  dispatch-forfilter pr. issue (state + findes merged PR med Refs #N),
  launch i samme tur som mit go.
- RØR IKKE: trænings-/race-motoren (#3806 venter på trin 7-beslutningen),
  riderProgression.js, TrainingPage/RiderScoutingTab og trin 7-PR'ens øvrige
  filer (konflikt med parkeret #3798; derfor er #3815 bevidst IKKE med),
  patchNotes.js/PatchNotesPage.jsx (orkestrator skriver ÉN samlet entry ved merge).
- Patch note-numre: tjek origin/main OG åbne PR'er lige før du skriver;
  PR #3802 bærer 7.134 indtil den merges eller renummereres.
- Bundle-budgettet: mål det FORENEDE træ inden sidste merge. Bølge 1 lærte at
  8 hver-især-grønne PR'er tilsammen væltede perf-gaten med 1,6 KB
  (budgettet er nu 913; konventionen med målt begrundelse i _note er bindende).
- UI-ændringer på smoke-dækkede sider SKAL refreshe snapshots i alle 3
  Playwright-projekter i deres egen PR (bølge 1 glemte det i ét spor).
- Ingen merges uden mit go. Saml godkendelsen som i bølge 1: én visuel side
  med screenshots (desktop+mobil) pr. UI-spor, sorteret efter sikkerhed.
- Ingen prod-mutation uden dry-run + tal + mit go. Send ALDRIG spillerbeskeder;
  udkast skrives, jeg poster selv.
- Kun ÉN fuld e2e-suite ad gangen pr. maskine; workers bruger verify-affected
  + targeted specs, CI bærer fuld suite.
- Saml det jeg skal tage stilling til, men stil det ÉN ting ad gangen i klart
  sprog med din anbefaling.

═══ IKKE I DENNE SESSION ═══

Trin 7-kæden (#3798/#3803, parkeret af mig 17/8). #3806 (rører motoren).
#3815 (fil-konflikt med parkeret trin 7). Bitype-patch-noten #3802, #3816,
#3512-vurderingen og trin 7-spillerbeskederne ligger til mig på PR-kø-siden
fra bølge 1-sessionen og skal ikke dubleres her.
```
