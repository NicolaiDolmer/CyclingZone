# Postmortem · 2026-08-10 · Et tredje skrivested gjorde #3588's frysning uholdbar

## Hvad skete der?
PR #3588 (#3570 fase 3) gjorde `resolveRiderTypes(archetype_draw, caps, baseline)` til
identitets-kilden for ryttertypen og beskrev den som rettet "begge steder typen
persisteres". Der var tre. `runRiderTypesBackfill` i `backend/lib/backfillCores.js`
klassificerede stadig fra `ability_caps` og læste aldrig `archetype_draw` — og den
skriver `primary_type`/`secondary_type` for hele peletonen (8.234 rækker, inkl. de 35
pensionerede) i én kørsel. Fejlen nåede ikke prod: stien køres kun manuelt
(`node backend/scripts/backfillRiderTypes.js`) eller via relaunch-sekvensen, og ingen
af delene er kørt siden #3588 merged.

## Root cause
`backend/lib/backfillCores.js:141` (før fixet):

```js
const { primary, secondary } = computeRiderTypes(r.ability_caps || {}, rowModel);
return { id: r.rider_id, primary_type: primary.key, secondary_type: secondary.key };
```

Kaldere: `backend/scripts/backfillRiderTypes.js` (ops-CLI, allowlistet) og
`backend/lib/relaunchOrchestrator.js:124`. Ingen af dem er nye — stien er fra #1103.
Den blev overset fordi den ligger i SAMME fil som `deriveForRiderIds`, der ER rettet:
en fil-niveau-læsning af diffen ser "backfillCores.js bruger resolveRiderTypes" og
stopper der.

Målt mod snapshottet 10/8 (n=8.199): den gamle sti ville i dag have overskrevet 3 af
de 6 draw-bærende ryttere. Efter den planlagte frysning (alle får et anlæg) ville ÉN
kørsel have kastet identiteten væk for **1.879-6.366 ryttere (23-78 %)** afhængigt af
kandidat — tavst, uden fejl, uden log der siger "her nulstillede jeg din frysning".

## Fix
- `backend/lib/backfillCores.js` — `runRiderTypesBackfill` kalder nu
  `resolveRiderTypes(r.riders?.archetype_draw, …)` og har `archetype_draw` med i sit
  `riders!inner(...)`-select. Paritet: 16.398 sammenligninger mod den gamle kæde over
  snapshottets 8.199 ryttere, **0 afvigelser** for de 8.193 uden draw.
- `backend/lib/starterSquadAllocator.js` — accept-gaten (spejlet af
  `deriveForRiderIds`) bruger samme identitets-kilde. Bit-identisk i dag (6.000
  genererede kandidater, 0 type- og 0 caps-afvigelser), men kan ikke længere drifte
  fra skrivestien.
- Forward-guard: `backend/scripts/lintRiderTypeWrites.js` + `.test.js`.

## Forhindret-fremover
Guarden er en statisk scanner der kører i backend-testsuiten (`node --test`, dermed CI):

1. **Inventar** — mængden af filer der både skriver til `riders` og bygger et objekt
   med `primary_type`/`secondary_type` skal matche en dokumenteret allowlist. En helt
   ny skrivesti dukker op som et ukendt filnavn.
2. **Kilde** — i `lib/` + `routes/` må værdien af en `primary_type:`-nøgle ikke stamme
   fra `computeRiderTypes`, hverken direkte eller via en binding. Reglen er
   objekt-literal-lokal, ikke fil-lokal: en skæv skrivning inde i en funktion der
   ELLERS kalder `resolveRiderTypes` fanges også (verificeret).
3. **Ankre** — de tre kendte identitets-kaldsteder skal blive ved med at kalde
   `resolveRiderTypes`.

Legitime ikke-persisterede klassifikationer (bootstrap til caps-formning, read-only
preview, balance-snapshot) markeres med `// rider-type-write-ok: <begrundelse>`.

## Læring
**Når en PR retter "alle steder X sker", så tæl stederne med et værktøj, ikke med
øjnene.** #3588 rettede 2 af 3 og skrev "begge" i sin egen beskrivelse — og fejlen lå
i en fil PR'en allerede havde rørt, hvilket gjorde den usynlig for både forfatter og
review. Samme mønster som #2238 (kolonne-grant) og #3331 (pagination): en invariant
der gælder "overalt" holder kun hvis der findes en maskine der kan opremse "overalt".
Generaliseringen: **retter du N-1 af N stier, er systemet ikke rettet — det er blevet
sværere at opdage at det ikke er rettet.**
