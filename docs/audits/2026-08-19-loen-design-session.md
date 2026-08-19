# Løn-design-sessionen 19/8

Session-prompt: [`2026-08-19-loen-design-session-prompt.md`](../sessions/2026-08-19-loen-design-session-prompt.md). Kørte parallelt med merge-dag-sessionen (ejer-sanktioneret); rørte ikke #3798/trin 7/merge-køen og kørte kun targeted tests (hard rule 24). Måle-detaljer med tal ligger i sessions-scratchpad (uden for repoet) per hard rule 17; dette dokument bærer beslutningerne og metoden.

## Ejer-beslutninger (stillet enkeltvist med anbefaling)

1. **Niveau-korrektionen kalibreres mod den forhandlede kanal, én global konstant.** Kilen mellem auktions- og forhandlingskanal er strukturel (samme rytter clearer markant lavere på auktion), så 17/8-gatens "to kanaler enige ±0,15" er omdefineret til "forhandlet kanal stabil" (n-krav + rullende medianer i bånd, config-styret). Timing uændret: gate-styret engangskorrektion efter cutover, dræn-neutral + løn-neutral bundlet, dry-run + ejer-go før apply. Måling 19/8: kanalen driver monotont og er IKKE stabil; gaten seeder RØD.
2. **Præmie-indeksets D3/D4-løft + upkeep-rekalibrering: udskudt til efter cutover** (egen kalibrerings-session på ægte S3-målinger). Lønnen flipper stadig 23/8 mod nuværende præmieniveauer.
3. **Ungdomspakken (lukker #3550-roden, adresserer #3903):** pull-baseret intake (ét kuld pr. hold pr. uge via knap; uafhentet kuld genereres aldrig og rammer aldrig markedet), symbolsk provisorisk startværdi med rigtig værdi første søndag (signing fee følger automatisk med ned), 1-sæsons intro-kontrakt på symbolsk løn hele sæsonen (auktionsvundne ryttere beholder normal kontraktlængde, orkestrator-afgørelse), 24-timers auktioner ved akademi-afvisning/-udløb (bevidst reversering af #2627-liggetiden). Ejeren trak fyring→auktion tilbage undervejs (fri transfer består). Fremtid: [#3970](https://github.com/NicolaiDolmer/CyclingZone/issues/3970) (kontraktforlængelse i dage, korte intro-kontrakter).
4. **Løn-A bekræftet på korrigeret præmis.** Ejeren fangede at "S3 har 60 løbsdage" var en schema-default, ikke en måling: S3-kalenderen er ~identisk med S2 (28 dage, etapedage pr. pulje næsten 1:1, divisionsdifferentieret belastning). 17/8's "bløde landing" var en illusion. Genfremskrivning på kommende placering (D1-komprimeringen) bekræftede det stående A som forsvarligt: global lønandel nær målet, D1-median under 50 %-loftet, G4 binder ikke. Datadrevet justering overvejes efter cutover, når D1's reelle indtægt kan måles (D1 har aldrig haft menneskehold; estimatet er ekstrapoleret).
5. Orkestrator-afgørelser (flagget, ejeren kan overrule): ingen retroaktiv dagsløns-opkrævning; "live-opdateret med buddet" opfyldes ved pris-uafhængig projiceret løn på auktionskortet (lønnen følger værdien, ikke buddet); korrektions-apply er CLI-only (ingen admin-knap til populations-mutation); kvitteringens Development-linje er neutral boilerplate indtil trin 2.

## Fund

- **Dagsløns-divisor-bug fanget FØR flip:** `seasons.race_days_total` stod med schema-default på S3-rækken og ingen kode materialiserede den; wageDeductionSweep ville have opkrævet ca. halv løn over sæsonen. Fixet i #3393 (tierCalendarMaterializer skriver feltet fra kalenderens distinkte game days; post-verify-trin lagt i PR-body til cutover-drejebogen).
- 17/8-lønkalibreringens præmis-fejl (fundet af ejeren, bekræftet i prod; korrektion logget på PR #3393).
- Rytterdatabasens løn-sortering læste stadig CPV under markedsbasis (fixet i #3393).
- c-målingen (forhandlet kanal): lille n, bredt bootstrap-interval, rullende median driver monotont over kanalens 50 dages levetid → korrektionen må ikke fyre endnu; præcis derfor er gaten stabilitets-styret. Én outlier-rytter bærer en tocifret procentdel af samlet trupværdi og bør verificeres separat (opfølgning).
- Youth-budrate: nul-bud-andelen er høj og budraten følger rytterkvalitet, ikke pris; niveau-korrektionen er krone-neutral for banken og ændrer den ikke. #3903's reelle svar er pull-modellen.

## Leverancer

- **PR #3968** (S2-recap) + **PR #3969** (etapeside PR A, #3914): færdiggjort fra KS3-WIP, ejer-godkendt visuelt, auto-merge CI-gated (#3969 krævede opdatering af race-detail-e2e-specs til den nye informationsarkitektur; 9/9 targeted grønne).
- **PR #3393** (løn): 3 rebase-testfejl fixet dynamisk, dagsløns-divisor-fix, løn-sort-fix, projiceret løn på auktionskort verificeret m. screenshots. 291 backend + 2.188 frontend targeted grønne. Draft til merge-koordination.
- **PR #3972** (ungdomspakken): bygget + ejer-godkendt visuelt; flag OFF, flippes i drejebogen EFTER #3393's basis-flip; post-flip-verify: intake-løn på gulvet. 162 backend + 2.183 frontend targeted grønne.
- **PR #3974** (#3899 forecast): regnskabsopstilling, interval på præmier (kvartilbånd mod divisions-peers), antagelses-linje, v7.145-patch-note på branchen. Ejer-godkendt visuelt på FØR/EFTER-par. Merge-rækkefølge: #3393 → #3974 (delt lønmodul konsolideres ved rebase).
- **PR #3449** (gate-maskineriet + #3733 trin 1): søndags-gate-måling, admin-status, dry-run + ejer-gated CLI-apply m. neutralitets-bundt, korrektions-kvittering. 60/60 targeted + fuld preflight grøn. Migrationer committet, applies post-merge (#2642).
- Issues: #3970 oprettet · beslutnings-kommentarer på #3750/#3719/#3720/#3550/#3903/#3733 · #2181 label-flip · **#435 er reelt stadig åben** (PR 3925 dækkede kun privacy-siderne; CookieBanner + Speed Insights mangler).

## Åbent efter sessionen

- Merges koordineres med merge-dag/cutover: #3393 → #3972/#3974 → #3449 (løn-neutral-benet aktiveres først når #3393's A-nøgle findes). Patch note for #3968/#3969 skrives ved deres merge (#3974 bumper sin version ved rebase).
- Efter cutover: præmie-D3/D4 + upkeep-kalibrerings-session · D1-lønandels-overvågning (spredningen over medianen) · evt. A-justering på målt D1-indtægt · outlier-rytteren · #3755/#3756-gebyrsporet · #3733 trin 2 følger Z-sweepet.
