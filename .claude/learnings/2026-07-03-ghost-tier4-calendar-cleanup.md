# Spøgelsesløb i Division 4 — cleanup + rod-årsag (2026-07-03)

## Symptom
`docs/NOW.md` + `stallWatchdog.js`-kommentaren nævnte "16 tomme spøgelsesløb (div 8-15,
`entries=0`) fra chronrebuild 28/6". Watchdogen ignorerede dem korrekt; en separat cleanup
var anbefalet.

## Hvad undersøgelsen faktisk fandt
Antagelsen var forkert i både antal og dato:
- **329** tomme scheduled-løb i den aktive sæson, ikke 16.
- Heraf **192** i **Division 4** (tier 4, `league_division_id` 8-15, puljer A-H), oprettet
  **30/6 23:19** (ikke 28/6). De øvrige **137** var i div 1-7.
- De 137 i div 1-7 er **IKKE spøgelser** — det er legitime *fremtidige* løb hvis startfelt
  fyldes just-in-time (kun det igangværende løb pr. pulje har entries; jf. div 1's Vuelta
  Ibérica med 192 entries mens alle andre div-1-løb står tomme). At slette dem ville have
  raseret ægte kommende løb.

Diskriminatoren: et løb er et spøgelse hvis dets pulje har **0 egnede hold** — hvilket er
præcis hvad koden allerede udtrykker i `poolHasCalendar(tier, realManagerCount)`
(`divisionCalendarGenerator.js`): tier 1/2 får altid kalender, tier 3/4 kun med ≥1 ægte
manager. Alle 176 hold ligger i tier 1-3 (div 1-7); tier 4 er 100% managerløs → dens 192
løb modsiger politikken.

## Rod-årsag
`league_divisions` er en 4-tier-pyramide (1 / 2 / 4 / 8 puljer = id 1-15). Tier 4 (Division
4 A-H) er den designede vækst-buffer der fyldes nedefra når spillerbasen vokser — endnu
uden managere. Både AI-generatoren (`targetAiCountForPool`, ejer-direktiv #1688) og
kalender-generatoren (`poolHasCalendar`) holder bevidst tier 3/4 sovende uden en ægte
manager, så toppen/aktive puljer er levende uden at brænde compute på løb ingen ser.

De 192 løb er **stale artefakter**: kalender-materialiseringen er **insert-only** og rydder
ALDRIG op når en pulje mister sin sidste manager (eller efter en force-kørsel). Fremadrettet
gater alle automatiske stier korrekt:
- `materializeSeasonCalendar` + `materializeTierCalendars` filtrerer på `poolHasCalendar`.
- `seasonTransition.js` materialiserer uden `forceTiers` → nye sæsoner får ingen tomme
  tier-4-kalendere.
- **Ingen cron** re-materialiserer kalendere → ingen automatisk gentagelse.
Tilbage står kun `forceTiers`-escape-hatch'en (manuelle chronrebuild-scripts) + det
manglende oprydnings-trin når en pulje tømmes.

## Handling
`backend/scripts/dev/cleanup-ghost-tier4-races.mjs` (dry-run default, `--apply` gated).
Binder sig til `poolHasCalendar` (ikke hardcodede division-numre) + tre-lags guard:
managerløs tier 3/4-pulje → status=scheduled & stages_completed=0 → 0 entries/results/
finance_tx. Slettede **192** løb; CASCADE ryddede **448** etapeplaner + **448** profiler.
Post-verify mod prod: tier 4 = 0 løb/schedule/profiler; div 1-7 = 263 løb intakte; 7.290
entries + 28.860 results urørte.

Reversibelt: materializeren regenererer Division 4-kalenderen deterministisk hvis en pulje
senere aktiveres.

## Forward-guard (forslag til ejer — i PR-body)
App-laget er ryddet nu. Den strukturelle rod-årsag (insert-only materializer der ikke
rydder op ved tømning) lukkes helt ved at wire en idempotent "reconcile calendars mod
poolHasCalendar"-oprydning ind i `seasonTransition` (efter op/nedrykning, hvor puljer kan
tømmes). Lagt som forslag, ikke bygget autonomt i en kritisk sti — samme mønster som
`raceActiveGuard`'s strukturelle FK-rod-årsag (#2074).

## Læring
- "Verificér FØR claim": NOW.md-tallet (16) var 12× forkert. Havde jeg fulgt antagelsen
  blindt, havde en "slet de tomme løb"-fortolkning ramt legitime div-1-7-løb.
- "Match UI'ets/koden filter i kapacitets-logik": den korrekte spøgelses-diskriminator var
  den politik koden allerede håndhævede (`poolHasCalendar`), ikke fortid/fremtid eller
  hardcodede division-numre.
- Destruktiv prod-op: ejer så hele kalenderen live + gav utvetydig godkendelse før apply
  (auto-mode-klassifieren blokerede korrekt en tvetydig første godkendelse).
