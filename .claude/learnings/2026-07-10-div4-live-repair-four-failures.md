# 2026-07-10 — Div 4 live-reparation (#2276): fire fejl dry-run ikke fangede

## Kontekst
Fuld Div 4-nulstilling (146 løb slettet, 253 præmie-tilbageførsler, ny kalender). Dry-run var grøn, men `--live` fejlede/halv-fejlede FIRE gange på ting dry-run per definition ikke rører.

## De fire fejl
1. **FK dry-run aldrig ser:** `finance_transactions.race_id` er NO ACTION → blokerede løbs-sletning. Dry-run sletter ikke, så FK'en blev aldrig prøvet. Fix: detach (`race_id=null`) før delete; audit bevaret via idempotency_key.
2. **Preview og apply delte IKKE parametre alligevel:** preview brugte `forceTiers: [4]`, live-kaldet kun `tiers: [4]` → puljer med få rigtige managers blev skippet → +0 løb.
3. **Genkørsels-stien fandtes ikke:** efter delvis kørsel (slettet men ikke re-materialiseret) exitede scriptet på "0 løb at slette" FØR re-materialiseringen.
4. **In-memory kannibalisering:** `materializeTierCalendars` planlagde IKKE-mål-tiers i hukommelsen; deres egne navne var dedup-blokeret, så de genvalgte NYE løb fra kataloget og åd alle ledige Class1 → tier 4 `selected=0` uden fejl. Fix: planlæg kun mål-tiers.

## Læringer
- **Dry-run beviser klassifikation, ikke skrivningen.** Test destruktive scripts mod en DB med de RIGTIGE constraints (staging/branch-DB) eller assert FK-graf eksplicit (`delete_rule` for alle FKs mod tabellen) i pre-flight.
- **"Samme plan-kode" skal betyde samme KALD:** udtræk ét delt options-objekt som både preview og apply bruger — to håndskrevne kald divergerer (fejl 2).
- **Destruktive scripts SKAL være genkørbare fra ethvert mellemstadie** (crash-only design): hvert trin idempotent + genkørsel fortsætter hvor den slap. Fejl 3 var tæt på at efterlade Div 4 tom.
- **Stille 0-resultater er værre end exceptions:** re-materialisering med selected=0 burde have fejlet højlydt (kvote 45, opnået 0 = shortfall-assert). Tilføj "quotaHit ellers throw" ved apply.
- **Sentry-watchdog fangede mellemtilstanden på minutter** (race_startfield_lost) — den slags transiente alarmer skal forventes + annonceres før planlagte reparationer.
