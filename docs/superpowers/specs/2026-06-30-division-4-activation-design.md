# Division 4-aktivering — design

Status: godkendt af ejer 2026-06-30, klar til implementeringsplan.

## Baggrund

Division 4 findes allerede fuldt i skema og økonomi (frosset 2026-06-21, se
`database/2026-06-21-league-divisions-pyramid.sql` og
`backend/lib/economyConstants.js`). Den er ikke i brug af rigtige managere
endnu, fordi:

1. `MANAGER_ENTRY_DIVISION = 3` (economyConstants.js:106) er en statisk
   indgang — nye managere går altid til division 3, uanset fyldningsgrad.
2. Division 4's løbskalender er ikke materialiseret (kun 1 stub-løb pr. pool;
   `seasonCalendarMaterializer.js` springer tier 3/4-pools over, indtil de har
   ≥1 rigtig manager).
3. AI-fyld i division 4 kræver ingen ændring — `aiTeamGenerator.js` bruger
   allerede samme formel for tier 3 og 4.

## Verificeret nu-tilstand (2026-06-30, execute_sql mod prod)

Filter for "rigtig manager" = koden's eget filter
(`is_ai=false AND is_test_account=false AND is_frozen=false`,
teamProfileEngine.js:193-195).

| Pool | Rigtige managers | AI-hold | Total |
|---|---|---|---|
| Division 3 — A | 21 | 3 | 24 |
| Division 3 — B | 20 | 4 | 24 |
| Division 3 — C | 20 | 4 | 24 |
| Division 3 — D | 20 | 4 | 24 |
| **Total** | **81** | **15** | **96** |

Alle 4 pools er ved deres pool-mål (`POOL_TARGET_SIZE = 24`, manager+AI
tilsammen). 15 AI-hold fungerer som buffer og bliver evicted 1:1, efterhånden
som rigtige managere ankommer — reelt er der plads til 15 flere rigtige
managere (81→96), før division 3 er hård-mættet. Ingen datafejl fundet; en
tidligere undersøgelse rapporterede forkert 25 managers i Pool A pga.
manglende test/frozen-filter — rettet ved direkte SQL-verifikation.

Løbskatalog (`race_pool`): 121 distinkte løbstyper, genbruges på tværs af alle
pools/divisioner hver sæson (division 3's 4 pools har allerede materialiseret
184 løb ud fra de 121 skabeloner). Ingen knaphed — division 4 mangler kun selve
materialiseringen, ikke kildemateriale.

## Design

### 1. Dynamisk overflow division 3 → 4

**Fil:** `backend/lib/teamProfileEngine.js` (entry-pool-valg-funktionen,
omkring linje 173-220).

Ved hver ny manager-signup:
1. Hent rigtige-manager-antal pr. division-3 entry-pool (samme filter som i
   dag, linje 193-195).
2. Hvis ALLE 4 division-3 entry-pools har rigtige managers ≥
   `POOL_TARGET_SIZE` (24): fald igennem til division-4 entry-pools, vælg
   mindst-fyldte (samme deterministiske mindst-fyldte-logik som i dag,
   laveste pulje-id ved lige fyldning).
3. Hvis division 3 har ledig plads: uændret adfærd (vælg mindst-fyldte
   division-3-pool).

Kapacitets-tjekket bruger **rigtige managers, ikke total** (AI er
evict-bart, ikke en reel begrænsning) — matcher
`feedback_match_ui_filter_for_capacity_logic`-reglen (samme filter som
UI/ranglisten).

Selvkørende: ingen deploy nødvendig, når grænsen rammes, og virker
symmetrisk den anden vej (plads i division 3 igen efter nedrykning → nye
managere går tilbage til division 3).

**Kendt grænse (ikke en del af dette arbejde):** Når division 4 selv mættes
(8×24=192 rigtige managers), findes ingen division 5 at falde videre til.
Noteres som fremtidigt opfølgningspunkt.

### 2. Proaktiv kalender-materialisering for division 4

**Fil:** `backend/lib/seasonCalendarMaterializer.js`.

Kør materialiseringen for alle 8 division-4-pools nu — samme spec som
division 3 (56 race-days, overlap-cap=2, densitet=2 løb/IRL-dag). Sker
uafhængigt af om der står managere i poolen endnu (i modsætning til den
nuværende `poolHasCalendar()`-gate, der kræver ≥1 rigtig manager for tier
3/4). Formålet er, at kalenderen er klar, FØR den første manager lander der
via overflow-logikken i punkt 1 — ingen synkron materialisering under en
live signup.

Implementeres som engangskørsel (script eller admin-kald), ikke en
permanent ændring af `poolHasCalendar()`-gaten (den bevares for fremtidige
divisioner, der oprettes uden forhåndsmaterialisering).

### 3. AI-fyld i division 4

Intet kodearbejde. `reconcileAiTeamsForPool()` (aiTeamGenerator.js) bruger
allerede `targetAiCountForPool(tier, realManagers.length)`, som er
tier-agnostisk for tier 3/4 (0 AI uden managers, ellers op til 24). Udløses
automatisk ved team-oprettelse. Verificeres som en del af test-/QA-trinnet
i implementeringsplanen, ikke bygget separat.

## Fejlhåndtering

- Overflow-tjekket fejler "sikkert lukket": hvis division-4-pools af en
  eller anden grund ikke kan hentes (fx pre-migration/mock-edge, jf.
  eksisterende fallback linje 184-188), falder logikken tilbage til
  nuværende adfærd (division 3) i stedet for at fejle signup-flowet.
- Materialiserings-scriptet er idempotent (kan køres flere gange uden
  dubletter) — følger samme mønster som eksisterende
  `materializeSeasonCalendar()`-brug for division 1-3.

## Test

- Unit-test for overflow-logikken: alle 4 division-3-pools ved/over 24
  rigtige managers → ny manager lander i division 4 (mindst-fyldte pool).
- Unit-test: division 3 har ledig plads → uændret adfærd.
- Integrationstest mod materialiseret division-4-kalender: verificér
  race-day-tæthed (2/dag) og overlap-cap (2) matcher division 3's mønster.
- Manuel verifikation efter materialisering: SQL-optælling af
  `race_stage_schedule`-rækker pr. division-4-pool, sammenlignet med
  division 3's eksisterende 46 løb/pool som baseline.
