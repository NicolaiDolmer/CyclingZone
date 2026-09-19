# 2026-09-18: Event-katalog-guarden stod rød på main i ugevis, og Detector E's cron var rød på fire ord fra en kommentar

## Hvad skete

`scripts/check-event-catalog.mjs` (#5048, 8/9) fejlede med exit 1 på en ren main. Ingen så det, fordi guarden ikke blev kørt noget sted: ikke i en workflow, ikke i `package.json`, ikke i `preflight-pr.ps1`. ANALYTICS_STACK §8 noterede det selv som "Uden issue: guarden bider ikke endnu".

Bag den røde guard lå to forskellige ting:

1. **Ægte drift.** `app_version_reload` (#5033), `discord_invite_clicked` (#5130) og `onboarding_step2_one_click` (#5241) kom i `KNOWN_EVENTS` uden en række i ANALYTICS_STACK §3. Tre PR'er i træk, netop den drift guarden var skrevet til at fange.
2. **Parser-fejl.** `extractKnownEvents` matchede alle citerede ord i blokken, også i `//`-kommentarer. Kommentaren ved `app_version_reload` citerer sine outcome-værdier, så "arrived", "no_effect" og "deferred" blev meldt som udokumenterede events.

Backwards-checket fandt samme parser-fejl i `listKnownEvents()` i `backend/scripts/audit-feature-liveness.js` (Detector E), som oven i købet matcher backticks. Den ugentlige cron-kørsel 14/9 (run 34829160584) var rød på præcis fire fund: `outcome`, `arrived`, `no_effect`, `deferred`. Ingen af dem er events. En rød cron uden ægte fund er værre end ingen cron: den træner alle til at ignorere den.

## Hvorfor det slap igennem

- En guard uden kaldested er et dokument, ikke en guard. Den eksisterende unit-test hed "ignorerer kommentarer", men assertede det ikke; fixturens kommentar sagde ligefrem "matcher mønstret bevidst".
- To parsere læste samme blok med hver sin regex, og ingen af dem havde en test med en kommentar der citerer et ord.
- Detector E's cron havde været rød af andre grunde 31/8 og 7/9, så et nyt rødt 14/9 lignede mere af det samme.

## Rettelse (#5369)

1. Begge parsere stripper `/* */` og `//` før navnene læses. Detector E's parser er trukket ud som ren, eksporteret `parseKnownEvents()` med egen test. De to steder henviser til hinanden i en kommentar.
2. Tre manglende rækker tilføjet i §3.
3. De 16 canary-blinde events tilføjet til `KNOWN_EVENTS` efter måling mod prod: 15 flyder (8 til 3.502 pr. 30 dage), `academy_intake_pull` står på 0 fordi featuren er dormant bag flag og er whitelistet i Detector E med begrundelse og udløb.
4. Guardens ADVARSEL om canary-blinde events er nu en FEJL, fordi listen er tom og §3-reglen dermed kan håndhæves.
5. Guarden kører i det required job `frontend-build`, i `preflight-pr.ps1` og som `npm run check:event-catalog`.

## Forward-guard-tjek

- Ny guard i en PR: PR'en er ikke færdig før guarden har et kaldested i et REQUIRED job (se #4330-begrundelsen i `ci.yml`) og i preflight. "Hookes ind senere" bliver ikke til noget.
- En parser der læser kildekode som tekst skal have en test med en kommentar der ligner det den leder efter.
- Rød cron: læs fundene, ikke kun farven. Fire fund der alle er ord fra én kommentar kunne ses på ti sekunder i loggen.

## Åbent fund, ikke rettet her

`onboarding_step2_one_click` har 0 events i prod i 30-dages-vinduet pr. 18/9, selv om #5241 blev lukket 15/9. Det kan være lav trafik (kun nye managers på trin 2 med samtykke), men Detector E vil flage det ved næste cron-kørsel. Det er et ægte signal og er bevidst IKKE whitelistet.
