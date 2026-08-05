# En "spring over"-gren skal stadig rydde op efter sig

**Dato:** 2026-08-05 · **Issue:** CYCLINGZONE-44 (#3119-opfølgning) · **Type:** bug/anti-mønster

## Symptom

`riderDoubleBookingWatch` (CYCLINGZONE-44) eskalerede: 185 events på 7 dage, og
alarmen sagde vedvarende "1 rytter-par i to overlappende løb i sæson 2 (1 kan
stadig nås før afvikling)". Bruddet forsvandt aldrig, selvom entry-generator-
sweep'en kører hver time og rapporterer sig som konvergeret (0 indsat, 0 fjernet).

Prod-forensik 5/8: Marcos S. Ortega (Team Fakta, D4 — ægte manager-hold) stod i
**begge** af to tidsoverlappende løb:

| Løb | game_day | Rolle | `is_auto_filled` | Oprettet |
|---|---|---|---|---|
| O Gran Camiño Menor | 10-13 | helper | **true** | 4/8 17:12:57 |
| Settimana di Coppi e Bartali Minore | 11-14 | captain | true | 4/8 17:13:46 |

O Gran Camiño Menor er `Class2` → hård selection-cap på 6. Team Fakta havde **6
manuelle + 1 auto** = 7 ryttere dér. Begge løb var `scheduled` med
`stages_completed = 0`, dvs. bruddet kunne stadig nås før afvikling.

## Rod-årsag

`raceEntryGenerator.js` step 9 springer en `(race, team)`-enhed over når truppen
er FULD manuel (`manualRiders.length >= sizeRule.max`). Skip-grenen gjorde to ting
— og undlod en tredje:

1. ✅ Den genererede ingen picks (korrekt — der er ingen ledige pladser).
2. ✅ Den låste `manualRiders` i løbets vindue (korrekt — de er optaget).
3. ❌ Den lagde **aldrig** enheden i `staged`, så en forældet
   `is_auto_filled=true`-række fra en tidligere kørsel blev aldrig diffet væk.

Punkt 3 giver dobbelt skade, ikke bare kosmetisk drift:

- **Trup-cap brydes:** løbet står med `max + N` ryttere i et løb hvor cap'en er hård.
- **Binding-invarianten brydes:** skip-grenen låser kun `manualRiders`, ikke de
  residuale auto-ryttere. `assignTeamAcrossRaces` regner derfor rytteren som FRI
  og udtager ham til et tidsoverlappende søsterløb. Sweep'en ser aldrig
  modsigelsen, fordi den ene af de to rækker lever i en enhed sweep'en har
  besluttet ikke at kigge på.

Adfærden var **bevidst** — kommentaren i `regenerateUnitAfterConcurrentManualSave`
sagde det eksplicit: *"eksisterende auto-rækker efterlades urørt (samme adfærd som
når fullManual opdages i step 9, hvor enheden aldrig når `staged`)"*. Antagelsen
var at en fuld manuel trup ikke KAN have auto-rækker. Den holder ikke: rækkefølgen
"auto-fyld først, manuel udtagelse bagefter" efterlader præcis den tilstand.

## Mønsteret (tredje gentagelse)

Det er samme fejlklasse som to allerede lukkede fund i den SAMME funktion:

- **#3113a:** "en enhed med NUL picks skal STADIG stages" — ellers overlever dens
  forældede auto-rækker (prod 27/7, Aquila–L3gatus).
- **#3113b:** `isStarted` og `hasManual` er ikke gensidigt udelukkende — den gamle
  `else if` låste kun de manuelle, så de auto-fyldte stod som frie (prod 27/7,
  Team Brutaliste).
- **CYCLINGZONE-44 (dette):** `fullManual` springer over UDEN at prune og UDEN at
  låse de residuale auto-rækker.

**Lektien:** i en diff-baseret idempotent generator er "spring enheden over" og
"enheden ønsker intet" to forskellige ting. `continue` betyder *"jeg lader
databasens nuværende tilstand stå"* — og det er kun forsvarligt hvis den tilstand
er beskyttet af noget andet (afmelding bevarer entries bevidst, #1823; et
igangværende løbs felt er frosset, #1825). Er den ikke det, skal enheden stages
med et tomt `desired`, så diff'et rydder op. Enhver ny skip-betingelse i denne
funktion skal fremover besvare spørgsmålet eksplicit: **bevarer vi tilstanden med
vilje, eller glemmer vi bare at rydde op?**

## Fix

`raceEntryGenerator.js`: `fullManual`-enheder (og kun dem — ikke afmeldte, ikke
igangværende, ikke ryddede) stages nu med `picks: []`, så `applyUnitDiff` sletter
de residuale auto-rækker. Samme prune i
`regenerateUnitAfterConcurrentManualSave`'s tilsvarende gren. Manuelle rækker kan
strukturelt ikke røres — alle delete/update-filtre i `applyUnitDiff` er scopet til
`is_auto_filled=true`.

Data-reparationen sker af sig selv: næste sweep-tick efter deploy fjerner den
residuale række, og Team Fakta står tilbage med præcis den trup manageren selv
valgte. Ingen manuel SQL.

## Forward-guard

To regressionstests i `raceEntryGenerator.test.js` (begge fejler uden fixet):

- fuld manuel trup med residual auto-række → rækken prunes, truppen tilbage på cap.
- prod-formen: residual auto-række i fuld-manuel løb (gd 10-13) må ikke give
  rytteren plads i det overlappende løb (gd 11-14).

`riderDoubleBookingWatch` (CYCLINGZONE-44) er selv backstoppet: den fandt bruddet
og holdt fast i det i en uge. Vagten virkede — det var triagen der manglede.

## Verifikation

- `node --test lib/raceEntryGenerator.test.js`: 41/41 (2 nye).
- Backend-suite: 5141/5141.
- Blast radius målt mod prod (SELECT, read-only): **præcis 1** berørt
  `(race, team)`-enhed i hele den aktive sæson, 1 overskydende entry.
