# En invariant-vagt skal dele filter-semantik med de guards den vogter over

**Dato:** 2026-08-03 · **Issues:** #3185 (P0), #3119, #3122, #3114 · **PR:** #3206

## Hvad skete

CYCLINGZONE-44 (riderDoubleBookingWatch) voksede 4→7 rytter-par på 4 dage efter at
#3113-rodårsagen var fixet. Triagen antog at væksten kom fra den kendte
sweep-bug (#3119, CET-binding). Forensik mod prod viste noget andet: de 3 nye
par var **transfer-artefakter**. En rytter kørte færdig i D2 (game_day 0-7, real
27-30/7), blev solgt til et D4-hold og kørte lovligt D4's game_day 4-9 — som i
D4's kalender ligger SENERE i real-tid. Vagten grupperede på rider_id alene og
læste rå race_entries; alle guards (PUT /selection, regenerate, sweep) filtrerer
bevidst ghost-entries fra (#1906) og tillader præcis dét.

## Rodårsag

Vagten blev bygget som "samme vindues-funktion som guarden" (raceBindingWindow)
— men delte kun NØGLE-rummet, ikke ENTRY-filteret. En vagt der er strengere end
guards alarmerer på adfærd systemet selv tillader, og alarmen vokser monotont
uden at noget er galt.

## Læringer

1. **En invariant-vagt defineres af guardens fulde semantik: nøgle-rum OG
   entry-filter OG scope.** Når man kopierer "samme funktion som guarden", så
   kopiér hele kæden — her manglede loadEligibleEntries-krydsningen.
2. **"Tallet vokser" ≠ "kilden lækker".** Verificér HVEM der skabte de nye
   rækker (created_at + is_auto_filled + team_id på BEGGE sider af parret) før
   man antager at den kendte mistænkte er skyldig. #3119 var ægte, men var IKKE
   det der voksede — den var udelukkende overrestriktiv.
3. **game_day er pulje-relativt i real-tid.** Samme game_day afvikles på
   forskellige datoer i forskellige divisioner. Enhver cross-pool-sammenligning
   af game_day-vinduer (transfers!) er derfor semantisk tvivlsom — kun
   inden-for-pulje-binding er veldefineret.
4. **Sentinel-værdier skal slås op ved kilden.** game_day=100000 lignede
   datakorruption, men var en bevidst lane-packer-markør
   (MONUMENT_GAMEDAY_BASE). En "data-reparation" ville være blevet overskrevet
   ved næste sæson-materialisering.

## Forward-guards

- Vagten ghost-filtrerer nu via filterEligibleEntries (delt predikat) +
  regressionstest for begge retninger (ghost tæller ikke / ægte brud tæller).
- Sweep'en binder i game_day-rummet med monument-afledte vinduer; regressions-
  tests låser nøgle-rummet fast.
- Dokumenteret trade-off i modulkommentaren: et ægte historisk brud forsvinder
  fra tællingen hvis rytteren sælges/pensioneres bagefter — samme trade-off som
  guards.
