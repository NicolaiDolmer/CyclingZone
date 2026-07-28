# AI-hold blev adopteret af manager-heal-sweep'en — og næsten slettet

**Dato:** 2026-07-28 (fundet i daglig Sentry/Railway-triage)
**Sentry:** CYCLINGZONE-42 — "starter-squad heal sweep: 23 hold fejlede"
**Berørt:** `backend/lib/starterSquadHealSweep.js`, `backend/lib/starterSquadAllocator.js`

## Symptom

Én Sentry-event 27/7 kl. 20:52 (CEST): `starter-squad heal sweep: 23 hold fejlede`,
`healed: 0`. Alarmen læser som "23 hold står med tom trup" — altså 23 managere ramt.

Det var ikke det, der skete. Ingen manager var berørt overhovedet.

## Hvad der faktisk skete

Railway-loggen fra den kørende container gav hele historien — 23 identiske linjer:

```
[starterSquadHealSweep] hold <id> fejlede: delete partial starter <riderId>:
block_rider_delete_with_inflight_entries: rytter <riderId> kan ikke slettes —
har entries i 1 igangværende løb (låst felt, #2074).
```

Sweep'en forsøgte at **slette ryttere** på 23 AI-hold. Den blev udelukkende stoppet af
DB-guarden fra #2074 — dvs. af det tilfælde, at rytterne allerede var udtaget til et
løb. Kæden:

1. En ægte manager signede op 27/7 kl. 20:43 → AI-fill oprettede 23 AI-hold i
   division 4 i sekunderne efter.
2. `aiTeamGenerator.createAiTeam` sætter **aldrig** `teams.starter_squad_allocated_at`
   — markøren er signup-flowets kvittering, og AI-fyldet har sin egen trup-allokering.
3. `runStarterSquadHealSweep` gatede kun på `starter_squad_allocated_at IS NULL` +
   alder > 5 min. Alle 23 AI-hold blev derfor kandidater 5 minutter senere.
4. `allocateStarterSquadForTeam` kørte manager-stien på dem. AI-truppen har sin egen
   størrelse (`AI_SQUAD`, op til 24) og matcher ikke `STARTER_SQUAD.TOTAL_SIZE` (12),
   så heal'en landede i "ryd delvist forsøg"-grenen → `deleteRiders(hele truppen)`.

Prod-evidens for at det er strukturelt og ikke et engangstilfælde: af de hold der er
oprettet de seneste 14 dage fik **27/27 AI-hold** markøren sat af denne sweep minutter
efter oprettelsen, mod **0/33 ægte hold**. Hver eneste AI-fill har kørt gennem
manager-bootstrappen.

## Rod-årsag

To fejl, der forstærkede hinanden:

1. **Manglende diskriminator.** Sweep'ens kandidat-query spurgte på markøren alene.
   Markør-NULL betyder "signup-bootstrap fuldførte aldrig" for et manager-hold, men
   "har aldrig været i signup-flowet" for et AI-hold. Samme NULL, to helt forskellige
   betydninger.
2. **En destruktiv gren, der var bredere end sin egen dokumentation.** Kommentaren
   siger `0<n<SIZE: en yderst sjælden delvis-insert`, men koden var en bar `else` —
   den fangede også `n > SIZE`. Bootstrappen indsætter præcis SIZE ryttere i ét batch,
   så `n > SIZE` kan per definition ikke være et halvt forsøg.

Det er samme klasse som `feedback_match_ui_filter_for_capacity_logic`: en sweep der
kører med service_role skal gentage "hvem er et ægte hold"-diskriminatoren eksplicit.

## Fix

- `starterSquadHealSweep.js`: `.eq("is_ai", false)` som hard gate på kandidat-queryen.
- `starterSquadAllocator.js`: `n > SIZE` kaster nu i stedet for at slette truppen —
  defence in depth, så manager-bootstrappen aldrig kan rydde en trup den ikke selv
  har lagt.
- Regressionstests for begge; begge er verificeret til at **fejle uden** fixet.

## Læring

**En alarm der lyder spillervendt er ikke nødvendigvis spillervendt — men den skal
læses helt til bunds alligevel.** Hvis triagen var stoppet ved Sentry-titlen, var
konklusionen blevet "transient, 23 hold fejlede, healed næste tick" (markørerne blev
faktisk sat 6 minutter senere, så det ville se selvhelet ud). Railway-loggen var det,
der afslørede at fejlen var en *blokeret sletning* og ikke en fejlet reparation.
Sentry fortalte hvad der fejlede; Railway fortalte hvad koden forsøgte at gøre.

**En DB-guard er ikke et design.** `block_rider_delete_with_inflight_entries` (#2074)
var det eneste, der stod mellem et nyt AI-hold og en tømt trup. Havde AI-holdene ikke
allerede haft ryttere udtaget til et løb, var sletningen gået igennem — lydløst, uden
Sentry-event, fordi den så ville have "virket". Guards fanger den klasse fejl de er
skrevet til; de erstatter ikke en korrekt kandidat-afgrænsning.

**Skriv grenen så snæver som kommentaren.** `else` i stedet for `else if (n < SIZE)`
kostede intet at skrive og åbnede en destruktiv sti for hver fremtidig call-site der
ikke lignede den, forfatteren havde i hovedet.
