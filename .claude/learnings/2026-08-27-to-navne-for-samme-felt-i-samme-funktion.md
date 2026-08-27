# To navne for det samme felt i den samme funktion (#4232)

**Dato:** 27/8-2026 · **Sentry:** CYCLINGZONE-4V · **Fix:** `backend/lib/balanceDriftWatch.js`

## Hvad skete der

Balance-drift-vagten crashede med `TypeError: Cannot read properties of undefined
(reading 'map')` hver eneste gang den kørte for en dag uden løb. 68 events i
Sentry over fire døgn (24/8-27/8, hele sæsonpausen mellem S2 og S3).

## Rodårsag

`fetchDayInputs()` har to returns — én for den tomme dag, én for en normal dag —
og de brugte to forskellige navne til det samme felt:

| Gren | Feltnavn |
|---|---|
| `runs.length === 0` | `incidentObservations: []` |
| normal dag | `incidentObservationsInput` |

Kalderen læser kun det sidste. På en løbsfri dag blev `.map()` derfor kaldt på
`undefined`, og kørslen døde **før** `computeDayMetrics` — altså før den
tom-dags-håndtering der lå længere nede og som skulle have taget hånd om præcis
denne situation. Ingen række blev skrevet i `race_balance_drift_daily`, så
vagten var tavs og blind gennem hele pausen, og hullet forplantede sig til
streak-poolingen (#2731), der læser de seneste persisterede rækker.

Ingen spillerpåvirkning.

## Hvorfor testene ikke fangede det

`balanceDriftMetrics.test.js` dækker `computeDayMetrics` på en tom dag. Men
**ingen** test kørte `runBalanceDriftWatch` mod `fetchDayInputs`' tomme gren —
og det er præcis dér, ved samlingen mellem I/O-adapteren og kalderen, at de to
kontrakter divergerede. Begge sider var testet hver for sig; sømmen var ikke.

## Mønsteret at genkende

En funktion med **flere håndskrevne return-literals** har ingen som helst
garanti for at grenene deler form. Der er ingen type, ingen skema-check, og en
gren der kun rammes i en sjælden tilstand (sæsonpause, tom tabel, feature-flag
slået fra) kan ligge forkert i månedsvis uden at nogen ser det.

Tjek ved review: har funktionen mere end én `return {...}`? Så skal grenene
enten sammenlignes felt-for-felt eller bygges fra én fælles fabrik.

## Forward-guard

`backend/lib/balanceDriftWatchEmptyDay.test.js` stubber supabase til 0 runs og
kræver:

1. at den tomme gren returnerer **alle** de felter kalderen læser (loop over
   feltnavnene — så en fremtidig omdøbning i den ene gren fejler med det samme),
2. at `runBalanceDriftWatch` **gennemfører** en løbsfri dag og faktisk skriver
   dagens række — ikke bare at den lader være med at kaste.

Verificeret: testen fejler med præcis Sentry-fejlen når fixet rulles tilbage.

Refs #4232 #2414 #2731
