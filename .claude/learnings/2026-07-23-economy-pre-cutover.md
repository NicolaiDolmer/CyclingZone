# Postmortem · 2026-07-23 · Tre økonomi-huller før sæson 2-skiftet (#2746, #2589, #2764)

## Hvad skete der?
Orkestrator-audit 23/7 fandt tre uafhængige økonomi-huller der alle aktiverer ved
sæsonskiftet 27/7: (1) 1.317 ryttere på menneskehold manglede `salary` (NULL), (2)
70 pending sponsor-valg ville aktivere med en 60-dages per-dag-rate selvom den
faktiske kalender er 28 dage, (3) auto-prize-sweepet timede ud én gang (Sentry
CYCLINGZONE-3B, 20/7).

## Root cause
1. **Løn:** ingen kode-sti genberegner `salary` for HELE populationen efter
   #2594-lønnedkoblingen — kun signering/forlængelse sætter feltet
   (`contractOnAcquirePatch`/`computeContractExtension`). Ryttere der aldrig blev
   (gen)signeret siden cutoveren beholdt NULL. `runContractSeed` findes, men er en
   engangs-seed (relaunch), ikke et løbende sæson-start-trin.
2. **Sponsor-rate:** `expireAndRenewContracts` (pending→active) flippede kun
   `status`, aldrig `per_race_day_rate`. Raten blev frosset ved PICK-tidspunktet
   med den daværende kalenderlængde (60 dage, før #2512-fixet), men aktiveres
   først ved sæsonskiftet, hvor kalenderen er 28 dage — halveret indkomst for
   52/70 pending-rækker (målt via baglæns-udledning af `guaranteed_base`).
   Et tidligere forsøg (PR #2606) matchede pending mod et FRISK regenereret
   tilbud via `guaranteed_base`, hvilket driftede fordi `renownTargetValue`
   afhænger af `season_standings`, som opdateres løbende.
3. **Præmie-timeout:** `getSeasonPrizePreview` paginerer `race_results` med
   filter `prize_money > 0`, men ingen index understøtter det prædikat.
   Planlæggeren faldt tilbage til (Parallel) Seq Scan af HELE tabellen
   (415.892 rækker på tværs af alle sæsoner), selvom kun 4,7% matcher — betalt
   forfra for hver af ~20 sider, og voksende ubegrænset med tabellens totale
   størrelse for hver fremtidig sæson.

## Fix
1. `database/2026-07-23-2746-salary-backfill.sql` — backfill med
   `contractSeed.js`s egen `computeFrozenSalary`-formel oversat til SQL
   (`GREATEST(1, ROUND(cpv × SALARY_RATE_PROD[division]))`), scopet til
   menneskehold (is_ai/is_bank/is_frozen/is_test_account = false). AI-hold og
   test-konti bevidst IKKE rørt (dokumenteret invariant, #2674).
2. `backend/lib/sponsorOffers.js` (`guaranteedFractionForLength`) +
   `backend/lib/sponsorContractsService.js` (`recomputeActivationRate`,
   kaldt i `expireAndRenewContracts`): baglæns-udleder den ORIGINALE
   `renownTargetValue` fra `guaranteed_base` via `length_seasons` (stabilt,
   ændres aldrig efter pick) i stedet for at matche mod et regenereret tilbud.
   Retter kun divisor-fejlen, robust mod `season_standings`-drift.
3. `database/2026-07-23-2764-prize-preview-index.sql` — covering partial index
   `(id) INCLUDE (race_id, team_id, prize_money) WHERE prize_money > 0`.
   Verificeret med `hypopg` (read-only): plan-cost 13.831 → 4.428 for samme
   side (OFFSET 18.000), Index Only Scan i stedet for Seq Scan.

## Forhindret-fremover
- Løn: `driftMonitor.js` fanger allerede NULL-invarianten dagligt (#2674), men
  intet retter den automatisk — næste skridt (ikke i dette slice) er et
  sæson-start-trin der backfilller løbende, ikke kun én gang.
- Sponsor-rate: ny test låser at aktivering bruger den NYE sæsons kalenderdage
  som divisor, OG en separat test der reproducerer prod-drift-scenariet
  (guaranteed_base der ikke matcher en frisk regenerering) for at forhindre
  regression til "match mod regenereret tilbud"-tilgangen.
- Præmie: indexet retter den generelle adgangsvej — alle fremtidige sæsoner
  drager nytte, ikke kun S2. Ingen kodeændring i selve pagineringen (bevidst
  minimal-risiko scope).

## Læring
Når en formel/rate fryses ved ét tidspunkt (pick) og anvendes ved et SENERE
tidspunkt (aktivering), skal genberegning ved aktivering ALDRIG afhænge af at
kunne reproducere fortidens mellemregning (`renownTargetValue`) — den drifter
med live data. Baglæns-udled i stedet fra det der ER stabilt gemt (her:
`length_seasons` → `guaranteedFraction` → `guaranteed_base`). Og for
performance: en `WHERE`-prædikat uden understøttende index koster ikke bare
"lidt ekstra" — det koster HELE tabellens størrelse, gentaget per
paginerings-side, og den regning vokser med hver sæson der lægges oven på en
tabel der aldrig prunes.
