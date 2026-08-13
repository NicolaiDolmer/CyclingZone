# Postmortem · 2026-08-14 · Forlæng-knappen låste op igen efter hver forlængelse (#3597)

## Hvad skete der?
Sentry CYCLINGZONE-45 (`player action rejected: rider_extend_quote`) blev ved med
at logge afviste kontrakt-forlængelser EFTER #3186 (merged 3/8 kl. 14:54, commit
`7f24a847`). 8 hændelser / 7 forskellige brugere 3.-9./8, 7 af dem efter mergen —
og denne gang spredt over Chrome desktop, Edge, Firefox desktop OG mobil, ikke
kun iOS. Tredje runde på samme symptom (#3143/#3164 → #3186 → #3597).

Sentry-issuet stod som `ignored`, så ingen alarm udløstes; det blev fundet ved
ugentlig triage.

## Root cause
Frontend afledte hele sin spærre-tilstand af ét signal: **"er vi blevet
AFVIST?"** — `extendCapped`, som kun sættes når et svar fra extend-quote/
extend-contract er 409 `contract_extension_cap_reached`. Alle tre runder
optimerede det signal i stedet for at skifte det ud:

- #3164/#3169 flyttede afvisnings-tjekket tidligere (fra klik til mount).
- #3186 lukkede race-vinduet mens tjekket var i flight.

Fordi signalet er afvisnings-afledt, åbner **enhver** state-overgang der
efterlader `extendCapped === false` mens kapaciteten reelt er 0, hullet igen. En
helt almindelig succesfuld forlængelse gør præcis det:

`confirmExtend()`s success-gren smider den brugte quote væk
(`setExtendQuote(null)`) og rører ikke `extendCapped` (der kom jo ingen 409).
Mount-tjekket der ville have opdaget loftet er nøglet på `[rider.id]` — som ikke
ændrer sig, og `onChanged()`s refetch remounter ikke komponenten. Var det den
SIDSTE tilladte sæson der lige blev brugt, stod "Forlæng kontrakt" derfor igen
guld og klikbar på en rytter hvis næste extend-quote er **garanteret** 409
(`computeContractExtension` giver `end + 1 > currentSeason + 3`). Ét klik = én
afvist request = én Sentry-hændelse. Deterministisk, ikke et race — hvilket
forklarer browser-spredningen.

Ironisk detalje: #3186 tilføjede netop `setExtendCapInfo(data.extensionCap)` i
den samme success-gren. Klienten VIDSTE altså at der var 0 tilbage og viste
"Forlængelser brugt 3/3" på skærmen — tallet var bare aldrig koblet til knappen.

Holdsidens `RiderActionModal` havde samme afvisnings-afledte gate, men ramte
ikke hullet: modalen lukker efter succes og remounter næste gang. Det matcher at
alle Sentry-hændelser kom fra `/riders/:id`.

## Evidens
- `actionTelemetry.js` sender kun titlen `player action rejected: …` fra
  `captureMessage`-grenen (`player_action_kind: "rejected"`); en netværksfejl
  ville lande som `captureException` i et ANDET Sentry-issue. Hændelserne er
  altså ægte non-2xx-svar, ikke netværk.
- `rider_extend_quote` rapporteres kun ét sted: `openExtend()` — klik-handleren.
  Mount-tjekket sluger sine fejl tavst. Der ER altså blevet klikket på en
  knap der stod enabled.
- Forælderen (`RiderStatsPage`) gater komponenten på
  `isMyRider && !isPendingTransfer && !isRetired`, så af extend-quotes 4
  fejl-grene er `contract_extension_cap_reached` den eneste realistisk nåbare.
- Prod (14/8, aktiv sæson 2 → loft = sæson 5): **299 ryttere på 28
  manager-hold** står på `contract_end_season >= 5`, dvs. 3/3 brugt. Ryttere
  krydsede den grænse bl.a. 5/8, 6/8 og 9/8 — samme dage som 5 af de 7
  hændelser efter fixet. Tilstanden er hverdag, ikke et hjørnetilfælde.

## Fix
1. `frontend/src/lib/extendCapGate.js` — ny delt, ren gate der spærrer på det
   **positive kapacitets-tal** backend allerede sender i hver eneste gren
   (`extensionCap.remainingExtensions`, fra `contractExtensionCapInfo`), med
   `extendCapped` som fallback for svar uden `extensionCap`. Frontend gentager
   stadig ikke "+3"-formlen.
2. Både rytter-profilen og holdsidens modal gater nu på den samme funktion, så
   de to flader ikke kan divergere igen.
3. `RiderManageActions` nulstiller extend-state ved rytterskift. Komponenten
   remountes ikke ved navigation /riders/A → /riders/B, så rytter B arvede før
   A's quote (panelet ville vise A's lønvilkår) og A's `extendCapped` (B's knap
   låst for evigt) — samme klasse af fejl: state der overlever den tilstand den
   beskrev.
4. `openExtend()`s fejl-gren låser nu også ved en 409, som `confirmExtend()`
   allerede gjorde.

## Forhindret-fremover
- `frontend/src/lib/extendCapGate.test.js` beviser gaten, med "kapacitet brugt
  op, aldrig afvist" som hovedcase, plus at et manglende `extensionCap` betyder
  "ved ikke" (ikke "0 tilbage" — ellers byttes afvisningen bare ud med en død
  knap). Samme fil holder kontrakten om at BEGGE flader gater på den delte
  udledning.
- `frontend/tests/e2e/rider-extend-cap-after-success.spec.js` kører spillerens
  vej: forlæng en rytter med 1 forlængelse tilbage, og kræv at knappen er låst
  bagefter. Verificeret negativt kontrolforsøg: med den gamle
  `disabled={extendCapped || …}` fejler specen.

## Læring
Når en handling har et loft, skal knappens gate afledes af **kapacitet** ("er
der noget tilbage?"), ikke af **afvisning** ("er vi blevet stoppet?"). Et
afvisnings-afledt flag er kun sandt efter at fejlen allerede er sket, og det
nulstilles af enhver overgang der ikke selv producerede en afvisning — så hver
runde af fixes lukker ét vindue og efterlader det næste. Runde 1 flyttede
tjekket, runde 2 lukkede race-vinduet, runde 3 skiftede endelig signal.

Sekundær læring: da runde 2 tilføjede tælleren, havde klienten allerede tallet
der kunne have lukket sagen — det blev vist for spilleren, men aldrig brugt til
en beslutning. Når et nyt felt hentes ind, så spørg hvilke gates der burde læse
det, ikke kun hvor det skal renderes.
