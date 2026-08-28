# Delta-payload plus absolut invariant: guarden skal resolvere mod basis-tilstanden

Dato: 2026-08-28 · Issue: [#4344](https://github.com/NicolaiDolmer/CyclingZone/issues/4344) · Fundet via Discord-sweep (thelamba 27/8)

## Symptomet

Etape-taktikken accepterede **to** kaptajner på samme etape uden en lyd. Tre eller flere blev afvist korrekt. Spilleren opdagede selv det mærkelige mønster: "It said big no to 8 captains, but no comments for 2."

## Roden

To beslutninger der hver for sig var rigtige, og tilsammen forkerte:

1. `frontend/src/lib/stageRoleMatrixLogic.js` → `diffToOverrides` sender **kun celler der afviger fra basis-rollen**. Det er den dokumenterede #2034-kontrakt (REPLACE-semantik, minimal payload).
2. `backend/lib/raceStageRolesApi.js` → `validateStageRoleOverrides` talte kaptajner **inden i den payload**.

En urørt basis-kaptajn er per konstruktion aldrig i payloaden. Så tælleren så præcis 1 kaptajn i det ene tilfælde hvor der reelt var 2: basis-kaptajn urørt plus én forfremmet hjælper.

Antallet af kaptajner der slap igennem var altså ikke tilfældigt. Det var altid præcis `1 + (antal overrides)`, hvor guarden kun kunne se det andet led.

## Klassen

**Når payloaden er en delta, og invarianten er absolut, må guarden aldrig tælle på payloaden.** Den skal først resolvere den effektive tilstand: `coalesce(delta, basis)`.

Motoren gjorde det allerede rigtigt: `raceStageRoles.resolveStageEntrant` har fallback-kæden `override → race_entries.race_role`. Validatoren havde ikke den kæde. Læse-siden og skrive-siden var uenige om hvad "rollen" var, og kun læse-siden havde ret.

Kig efter samme form andre steder: en validator der itererer over `req.body`-arrayet og tæller noget, mens klienten kun sender ændringer.

## Hvorfor ingen fangede det

- DB'en kunne ikke: `race_stage_roles` har PK `(race_id, stage_number, rider_id)` og ingen constraint på én leder pr. hold pr. etape. Det har `race_entries` derimod (`uq_race_entries_captain`), hvilket er præcis derfor basis-laget aldrig kunne bære to.
- Testene kunne ikke: alle overlap-tests sendte begge kaptajner i payloaden. Ingen test havde en basis-rolle der ikke også stod i bodyen. Testene testede guarden mod den tilstand guarden selv kunne se.
- Motoren sagde ikke fra: `raceSimulator.buildTeamContext` gør `t.captainId = e.rider_id`, sidste skrivning vinder. To kaptajner er ikke en fejl for den, bare et overskrevet felt.

## Konsekvensen i prod

35 etape-hold-tilfælde med to kaptajner, 12 hold, 18 løb, 34 allerede kørt. Plus 4 tilfælde med dobbelt sprintkaptajn. Beskyttelsen (og hold-boostet `weight × helperSupport`) landede på den af de to som `loadEntrantsForRace` tilfældigvis returnerede sidst. Den query har ingen `ORDER BY`.

## Hvad vi gjorde

- Guarden tæller nu effektive roller: overrides plus basis-rollen for enhver rytter uden override på den etape. Kun etaper der optræder i bodyen tjekkes, fordi en etape uden overrides falder tilbage til `race_entries` alene, hvor unique-indexet allerede garanterer højst én.
- UI'et degraderer den forrige indehaver i samme klik, så spilleren får det han mente i stedet for en fejl han ikke kan handle på. Reglen er løftet ud i `demoteOtherHoldersOfRole` og deles nu med førertrøje-genvejen, der havde implementeret den korrekt men privat.
- Tests dækker nu netop det hul der manglede: en basis-rolle der **ikke** er i payloaden.

## Bevidst ikke gjort her

`buildTeamContext`s sidste-vinder blev **ikke** ændret. `buildRaceResults` re-simulerer kørte etaper ved visning, så en ny tie-break ville ændre hvad de 34 allerede kørte etaper viser. Det hører sammen med ejer-beslutningen om de etaper, ikke med at lukke hullet.

## Forward-guard

Ved enhver ny delta-baseret PUT-kontrakt: skriv mindst én test hvor den relevante basis-tilstand **ikke** er i payloaden. Består guarden den, tæller den effektivt. Består den ikke, tæller den kun sig selv.
