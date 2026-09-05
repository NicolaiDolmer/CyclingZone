# Tre ubesvarede balance-spørgsmål — målinger 2026-09-06

> Refs #4704, #4489, #4417. Read-only SELECT mod prod (Supabase, `backend/.env`) kørt
> 2026-09-04/05 via engangs-scripts i `scripts/dev/measure4704PunchPotentialRank.mjs`,
> `scripts/dev/measure4489FavoriteVsResults.mjs`, `scripts/dev/measure4417ValueVsAbilityGrowth.mjs`.
> Kun aggregerede tal herunder — ingen rytternavne, ingen raa vaegte/formler (hard rule 17).
> Scripts genbruger den FAKTISKE kode hvor muligt (`weights/displayRecipes.js`s `ratingForRole`),
> ikke en genopfundet formel.

---

## 1. #4704 — Er puncheur-potentialet systematisk næsthøjest?

**Metode.** Målt på hele den aktive rytterbestand (n=7.441 med fuldt udfyldte
evne-lofter). For hver rytter beregnet den faktiske "potentiel rating" for alle
8 arketyper via `weights/displayRecipes.js`s `ratingForRole` anvendt på
`rider_derived_abilities.ability_caps` (samme funktion fladen selv bruger til
loft-rating), og rangeret de 8 typer mod hinanden pr. rytter.

**Måling.**
- Uafhængig baseline hvis typerne var ligeligt fordelt: 37,5 % chance for at en
  given type ligger i top-3 af 8.
- Puncheur ligger i top-3 hos **48,9 %** af alle ryttere — klart over baseline,
  men **ikke** den mest ekstreme type: rouleur ligger i top-3 hos 68,9 %.
- Opdelt på rytterens PRIMÆRE arketype (ekskl. puncheur-typen selv): hos
  **climber**-ryttere ligger puncheur-potentialet på rang 1 eller 2 hos **100 %**
  (59,3 % rang 1, 40,6 % rang 2) — det mønster spilleren selv beskrev
  ("climber/puncheur … puncheur er 2nd-4th highest"). Hos **gc**-ryttere ligger
  det typisk rang 4-5 (94,8 % samlet), hos **brostensrytter** typisk rang 2-3
  (77,9 %), hos **baroudeur** typisk rang 2-4 (100 %).
- Puncheurens EGEN type rammer korrekt rang 1 hos 98,5 % af puncheur-ryttere
  (sanity-check på metoden).

**Rodårsag (kode-verificeret, `backend/lib/weights/displayRecipes.js`).**
Klatrerens ("climber") visnings-opskrift blev **bevidst udvidet med en
`punch`-post 13/8** — koden dokumenterer selv hvorfor: uden den var
klatrerens fulde evne-sæt en delmængde af GC'ens (`climber ⊆ gc`), hvilket
brød en af de fire uadskillelighedsvagter i `abilityRegistryGuards.test.js`.
Løsningen var tematisk begrundet (en klatrer angriber på en stigning) og
rettede netop dét problem. Men klatrerens opskrift deler i forvejen tre andre
evner tungt med puncheurens (climbing, tempo, endurance), så en klatrers
allerede-høje evner i de tre giver ham automatisk et pænt puncheur-tal — og
punch-tilføjelsen lægger yderligere oven i. Samme mønster (delte evner, ikke
kun punch) forklarer baroudeur- og brostensrytter-tallene.

**Konklusion.** **Delvist tilsigtet, delvist en umålt sideeffekt.** At flere
typer kan score pænt på punch er en direkte konsekvens af en bevidst,
dokumenteret 13/8-beslutning (bryd `climber ⊆ gc`) — ikke en generator-fejl.
Men at konsekvensen konkret blev "climber-ryttere har næsten altid puncheur
som 2. potentiale" blev aldrig selv målt eller vurderet dengang; det er en
sideeffekt af en anden rettelse, opdaget nu via spillerens observation.
Anbefaling: ingen kode-ændring i denne omgang (det er ikke en fejl i
generatoren), men flag det som et åbent punkt i `PROGRESSION_RULES.md` §9
(kendte modsigelser) til en fremtidig recipe-gennemgang, og svar spilleren at
det er tilsigtet delt evnegrundlag, ikke en bug.

---

## 2. #4489 — Favorit/outsider-markeringen mod resultater

**Metode.** Fundet koden bag mærket: `raceNarrative.js`s `terrainRanking()` +
`raceDominanceMetrics.js`s `observeRace()`. Favoritten er **ikke** den rytter
med højeste synlige rating på profilen — det er den rytter med højeste
stage-SPECIFIKKE terræn-score (evner vægtet mod netop DENNE etapes
efterspørgselsprofil), udregnet KUN blandt de ryttere der faktisk startede.
Målt direkte mod `race_simulation_rider_scores.components.terrain` (motorens
egen gemte score pr. simulering) og faktiske `race_results` for alle S3-etaper
til dato.

**Måling (S3, 59 etaper/enkeltløb med både simulerings-data og resultat).**
- Favoritten (højeste terræn-score) vandt **23,7 %** af tiden — altså en
  "outsider" (per motorens egen definition) vandt **76,3 %**, tæt på
  spillernes egen optælling (11/13 ≈ 85 %).
- Stage race-etaper: 24,5 % favorit-sejre (n=53). Enkeltløb: 16,7 % (n=6, lille
  stikprøve).
- Pr. division spredning fra 0 % til 60 % (n pr. division kun 2-7, for lille
  til selvstændige konklusioner).

**Konklusion — begge forklaringer i issuet er delvist sande, men (a) er
hovedforklaringen:**
1. **(a) Markeringen ER beregnet på et andet grundlag end den rating spilleren
   ser.** Bekræftet i kode: "favorit" måler dagens specifikke parcours-fit
   (klatrer-tungt bjerg vs. fladt osv.), ikke den generelle 8-type-rating
   spillerprofilen viser. En rytter kan sagtens være højest ratet generelt og
   samtidig ikke være bedste terræn-match for netop denne etape — det er ikke
   en fejl i mærket, men mærket måler noget andet end det spilleren
   sammenligner med. UI'et forklarer det ikke i dag.
2. **Ikke en holdudtagelses-fejl.** Mærket beregnes blandt de ryttere der
   FAKTISK startede (post-selektion), ikke en pre-selektions-prognose — så
   "favoritten stillede måske ikke op" er udelukket som forklaring.
3. **(b) Motoren rammer også forbi.** 23,7 % favorit-sejre er under det
   ejer-godkendte bånd (25-40 %, `RACE_ENGINE_RULES.md` §4/§7) og matcher det
   kendte, allerede sporede fund i #2557/#4604 (felt-favoritters lave
   vinderrate) — dette ER samme balance-problem, ikke et nyt.

**Anbefaling:** Ingen ny motor-ændring herfra — #2557/#4604 ejer allerede
retningen (koble mekanikker på uden at straffe styrke). Det UI-krav
issuet selv peger på (forklar hvad mærket faktisk måler) bør laves uafhængigt
af motor-arbejdet, og kan ske nu.

---

## 3. #4417 — Markedsværdiens kadence

**Metode.** `riders.updated_at`-datoernes fordeling blandt aktive ryttere med
hold (n=6.537) sammenholdt med `rider_derived_ability_history`-snapshots
14+ dage tilbage vs. nuværende evner (`rider_derived_abilities`).

**Måling.**
- `riders.updated_at`-datoerne viser at søndagssweepet rører meget få rækker:
  kun **12** ryttere fik en `updated_at`-opdatering søndag 30/8, og kun **2**
  søndag 23/8 (mod klynger på 200-450 rækker på andre datoer, som stammer fra
  kendte engangs-scripts som niveaukorrektionen — ikke fra den ugentlige
  sweep). `rider_value_sunday_log` (den nye kadence-log fra #4419) har 0
  rækker endnu — konsistent med at kadencen først lige er sat i drift.
- Blandt 4.015 ryttere med både nuværende evner og en 14+ dage gammel
  evne-snapshot: **1.748** havde mærkbar samlet evne-vækst (≥5 point summeret
  over de 15 evner) i vinduet.
- Af dem havde **1.745 (99,8 %)** ikke fået rørt deres `market_value` siden
  FØR seneste søndag — dvs. næsten samtlige ryttere med reel fremgang står med
  en værdi der ikke har fulgt med, hverken i det generelle 14-dages vindue
  eller hen over den seneste søndags-kørsel.

**Konklusion.** **Bekræftet reelt problem, ikke kun kadence-forventning.**
Ejerens egen kommentar i issuet (30/8) forklarede korrekt at "14 dage" kun
dækker to genberegninger, ikke fjorten dagsopdateringer — men målingen viser
at selv de to genberegninger stort set ikke rører befolkningen. Mest
sandsynlige mekanisme (matcher ejerens egen hypotese i issuet): sweepet
skriver kun når det beregnede tal reelt AFVIGER fra det lagrede, og ved den
værdi-skala spillet opererer med, runder små evne-stigninger ofte til samme
heltal — så writet udebliver selv når evnerne rent faktisk er steget.
**Mindste rettelse:** ingen formel-ændring nødvendig for at løse
kerneproblemet — det er en gennemsigtigheds-mangel, ikke en beregningsfejl:
vis en synlig "opdateret <dato> · næste søndag"-markering ved værdien (som
issuets egen acceptkriterie #3 allerede beder om), så spilleren kan se AT
sweepet kørte, selvom tallet ikke ændrede sig. En senere, separat beslutning
kan overveje om skrive-tærsklen (kun ved afvigelse) er for konservativ.

---

## Metodenoter

- Alle tre scripts er read-only (`SELECT` via Supabase service-key fra
  `backend/.env`) og er efterladt i `scripts/dev/` til senere genkørsel —
  ingen skrivning, ingen migration, ingen `app_config`-læsning/-ændring.
- #4704- og #4417-målingerne dækker HELE den aktive bestand; #4489 dækker S3
  til måletidspunktet (2026-09-04/05, altså før søndag 6/9's planlagte
  markedsblend-flip — upåvirket af den).
- Ingen af de tre målinger krævede kodeændring eller migration; denne PR er
  docs-only.
