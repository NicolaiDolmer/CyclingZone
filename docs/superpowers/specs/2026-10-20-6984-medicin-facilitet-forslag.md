# Medicinsk afdeling koblet til form og træthed (#6984)

**Status:** ejer-beslutning 20/10 (låst, #6984): **M1, M2, M3, M4 og M8 bygges**, sammen med Form og træthed 2.0 ([design](2026-10-20-6984-form-traethed-design.md)), bag `condition_model_v2`, tændes ved S5-start på ejerens go efter harness-gaten. M5 udgår. M6 (styrt: fortsæt/stå af), M7 (højdetræningslejr) og M9 (sygdom) er ikke valgt nu. Spillertekst (M4/M8, help.json) følger `docs/TONE_OF_VOICE.md` og vises ejeren før merge.
**Tal:** alle styrker og lofter ligger privat i `balance-internals/6984/medicin-konstanter-2026-10-20.md` (hard rule 17).
**Udgifter:** ingen løbende driftsudgift (facilitetsudgifterne er fjernet fra S5, #6936). Kun den eksisterende engangspris for at opgradere et tier og chefens løn som i dag.

## 1. Hvad findes i dag

| Del | Hvor | Status |
|---|---|---|
| Sporet `medical` (tier 0-5) | `backend/lib/facilityConstants.js:30` | Kan købes |
| Effekt-kurve pr. tier ("form-genopretning") | `backend/lib/facilityConstants.js:167` | Kun til visning |
| Effekten er slukket | `backend/lib/facilityConstants.js:193-194` (`EFFECT_LIVE_BY_TRACK.medical = false`) | Ingen motor-hook |
| Chefens styrke skalerer effekten (bedre chef = større effekt; spænd privat) | `backend/lib/facilityEngine.js:40` (`staffEffectFactor`), `:72` (`effectiveBonus`) | Virker for træning |
| Medicinchefens to akser: `recovery`, `injuryPrevention` | `backend/lib/staffAbilityDerivation.js:44` | Afledt, bruges ikke |
| Mønster for at hente facilitet + chef pr. hold | `backend/lib/trainingStaffContext.js:67` (kun `training`) | Genbruges |
| Restitution, skaderisiko, skadelængde (træning) | `backend/lib/riderCondition.js:31-101` | Medicin indgår ikke |
| Styrtskader i løb (v4, officielle etaper) | `backend/lib/engine/v4/mechanics/incidents.ts:687-696` (`resolveIncident`), nedkørselsstyrt `descent.ts:653-660` (`resolveCrashIncident`); persisteres via `raceIncidents.js` | Medicin indgår ikke |
| Løfte til spillerne | `help.json` → `facilities.tracks.rows` ("Medical Department: Speeds up form and injury recovery", **Coming soon**) og `facilities.liveTracksStatus` | Ikke indfriet |

Spillerne har altså kunnet købe en afdeling, der intet gør. Det er det første, der skal rettes.

## 2. Besluttet indhold

Fælles princip: afdelingen gør en god manager bedre, men den kan aldrig gøre en Grand Tour gratis igen. Alle effekter regnes fra samme tal (`effectiveBonus('medical', tier, chef)` = afdelingens niveau × chefens samlede styrke), har et samlet loft og ligger bag flaget `condition_model_v2`. Første version bruger kun det fælles tal; chefens to specialakser (`recovery`, `injuryPrevention`) indgår ikke endnu, så to chefer med samme samlede styrke giver samme effekt. En akse-afhængig vægt pr. effekt kan lægges på senere og kræver et ejer-valg. Effekterne indgår i harness-gaten (§7 i designet) med tier 5 og topchef som værste tilfælde.

### M1 · Hurtigere restitution
- **Hvad:** rytterens daglige restitution bliver lidt større.
- **Spillerens gevinst:** kan køre lidt flere løbsdage, før sæsonbelastningen bider; hviledage giver mere tilbage.
- **Kræver:** én faktor ind i v2's restitutionsfunktion. Lille.
- **Bygger på:** spillerkrav 3 i #6984 (friisisch 20/10: restitution skal betyde mere), help.json-løftet, roadmap-ønsket "Medical: hurtigere restitution".

### M2 · Færre skader
- **Hvad:** lavere trænings-skaderisiko ved høj træthed, og lidt lavere risiko for at et styrt bliver til en skade.
- **Spillerens gevinst:** man tør presse en rytter lidt mere, når man har investeret.
- **Kræver:** faktor på `injuryRisk` (træning). For løb: v4-motoren afgør skaden (`incidents.ts`, `descent.ts`) og forbliver ren; medicinen anvendes i ét skridt på hele etapens output lige efter simuleringen: hændelserne (`race_incidents`, og `rider_condition`-skaden der udledes af dem) og løbsfilmens tidslinje (`incident`-events) får samme skadelængde. Et seedet rul pr. rytter og etape gør en skade til et styrt uden skade med afdelingens sandsynlighed; styrtet og udfaldet bevares. Samme sti for v3 og v4. Koherens-test: hændelse og tidslinje bærer samme skadedage. Lille-mellem.
- **Bygger på:** #4854 (træthedsgrænse og skader), staff-ønskelisten 6/9 ("Lægen forkorter skader").

### M3 · Kortere skader
- **Hvad:** skadens længde forkortes, både trænings- og styrtskader. Altid mindst én dag.
- **Spillerens gevinst:** et uheld koster mindre, især i en GT.
- **Kræver:** faktor på skadedagene, der hvor de sættes: `rollInjury` (træning) og v4's `injury_days` i stage-runneren før persistering (begge styrttyper). Regressionstest for varigheden. Lille.
- **Bygger på:** help.json-løftet ("injury recovery"), #5865 (skader ved sæsonskiftet) og thelamba 6/9 (uheldige skader).

### M4 · Holdlægens tjek før etapen
- **Hvad:** holdudtagelsen og etapesiden viser lægens vurdering af hver rytter: "frisk / brugbar / træt / bør hvile", plus om sæsonbelastningen er begyndt. Med højere tier og bedre chef bliver vurderingen skarpere (to kategorier uden afdeling, fire ved højt tier). Tallet vises aldrig.
- **Spillerens gevinst:** gør v2 forudsigelig uden at vise formlen. Det er lidt "fog of war", og investeringen kan ses.
- **Kræver:** visning oven på samme funktion som afregningen (designets §5.7). Mellem.
- **Bygger på:** spillerkrav 5 i #6984 (egomadsen og friisisch 20/10: konsekvensen skal være åben, tallene ikke), staff-ønskelisten 6/9 ("fortæller om rytter starter bjergetapen på 80 procent").

### M8 · Lægens sæsonråd før hver Grand Tour
- **Hvad:** før hver Grand Tour siger lægen i ord, aldrig tal, hvilke af holdets ryttere der er klar, og hvem der vil være kørt flade til den tredje Grand Tour. Bygger på M4's vurdering og sæsonbelastningen (løbsdage i sæsonen). Skarpere med højere tier og bedre chef, som M4.
- **Spillerens gevinst:** man ser i tide, at man ikke kan køre alle tre Grand Tours på fuld styrke, og kan vælge hvem der skal spares.
- **Kræver:** samme vurdering som M4, kørt på holdets ryttere mod de kommende Grand Tours i kalenderen; vises på holdudtagelsen til en GT. Mellem.
- **Bygger på:** ejeren 20/10 ("ikke nemt at peake i alle"), spillerkrav 2 og 5 i #6984.

### M5 · udgår (ejer 20/10)
I en Grand Tour kører alle ryttere alle etaper, og hviledagene er fælles; et ekstra hviledags-tillæg giver ingen realistisk mening.

### Ikke med nu (kan komme senere)
- **Skadeshistorik i medicin-fanen (#4942):** thelamba 6/9 ønsker "medicin afdeling så jeg kan få overblik". Passer naturligt i samme fane; ikke med i denne omgang.
- **Højdetræningslejr (M7)**, **styrt: fortsæt eller stå af (M6)** og **sygdom (M9)**: ikke valgt nu.
- **Skadeinfo på andres ryttere (#5314)** og **hvorfor skadet (#6302)**: visning, ikke facilitets-effekt.

## 3. Samspil

- **B1-B5:** M1 virker gennem v2's restitution; M2 og M3 gennem skaderne; M4 og M8 er visning oven på samme funktion som afregningen. Ingen af dem ændrer etapens belastning, så ejerens låste valg står.
- **Udvikling 2.0 (#6110):** ingen kobling til evneudvikling. Medicin ændrer ikke træningsscoren direkte, kun gennem lavere træthed.
- **AI-hold:** samme regler; et hold uden afdeling får ingen effekt.
- **help.json + patch note:** "Coming soon" fjernes og erstattes af de effekter, der faktisk tændes (EN+DA), ved tænding.

## 4. Tænding af sporet i klubben

I dag viser klubsiden Medicin som "Coming soon" og skjuler køb og ansættelse, fordi `EFFECT_LIVE_BY_TRACK.medical` er `false` (`facilityConstants.js:193-195`), og `resolveTrackLiveFlags` kun kender akademiet. Byg-PR'en skal derfor afledes af samme flag (`condition_model_v2`): `isTrackEffectLive('medical')` og `resolveTrackLiveFlags` bliver sande, når flaget er on, så `FacilityTrackCard` viser køb, ansættelse og den rigtige effekttekst. Test: flag off = "Coming soon" som i dag; flag on = sporet er aktivt i både klub-UI og route-svaret.

## 5. Gate

Samme gate som designets §7 plus: (a) tier 5 + topchef må ikke bryde §5.8 omvendt, dvs. en rytter med fuld medicin skal stadig kunne køre sig over grænsen i den tredje GT; (b) skader pr. 1.000 rytter-datoer pr. tier vises til ejeren; (c) flag off = bit-identisk, og hold uden afdeling = identisk med v2 uden medicin.
