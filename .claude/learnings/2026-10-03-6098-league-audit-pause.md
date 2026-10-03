# Liga-audit under planlagt pause (#6098)

Årsag: liga-auditten brugte planlagte etapers alder som stall-bevis uden at læse skemalæggerens driftstilstand. Et igangværende løb kan legitimt vente under en planlagt pause.

Rettelse: læs scheduler-flagget strengt ved første relevant, frisk løbsbinding. Eksplicit pause undtager kun stalled-tjekket. Manglende/ukendt flag og opslagfejl stopper auditen. Ventefrist og uforklaret overskud bevares; ingen flag eller prod-data ændres.

Bevis: pause- og fejlopslagstests observeret røde før kodeændring. Genstart, udløbet markør og fravær af levende binding indgår i regressionerne. SSOT: docs/GAME_INVARIANTS.md.

Læring: runtime fail-off er passende for en writer, men et kontrolværktøj skal skelne bevidst pause fra utilgængelig tilstand.
