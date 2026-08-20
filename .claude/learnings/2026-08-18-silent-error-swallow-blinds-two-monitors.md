# Postmortem · 2026-08-18 · To ops-vagter blindet af samme mønster: fejl der forsvinder i stedet for at larme

## Hvad skete der?
To uafhængige admin-/ops-flader viste forkert tal uden at fejle synligt.
`driftMonitor.js`s forældreløse-rytter-tjek selectede `riders.name` (findes
ikke — kolonnen hedder `firstname`/`lastname`) og har derfor altid rapporteret
nul forældreløse ryttere (#3695). `/api/admin/balance-drift` hentede rows
faldende, byggede en stigende kopi (`ascRows`) til breach-beregningerne, men
mappede stadig de rå faldende rows til response-feltet `days` — så admin-UI'et
viste den ældste dag som "Seneste måling" og trenden løb baglæns (#3696).

## Root cause
- #3695: `if (!orphanError)`-mønstret sluger 400-fejl tavst — en fejlende
  query og "ingen forældreløse ryttere" så identiske ud i output.
- #3696: to variabler (`rows` faldende, `ascRows` stigende) blev vedligeholdt
  parallelt i samme handler, og kun to af de tre steder brugte den rigtige.
  Ingen test pinnede hvilken rækkefølge responset skulle have.

## Fix
- `backend/scripts/driftMonitor.js:71-89` — select rettet til
  `firstname, lastname`; `orphanError` giver nu et eksplicit issue-punkt i
  stedet for at blive ignoreret.
- `backend/routes/api.js` (`GET /admin/balance-drift`) — `days` mappes nu fra
  `ascRows` (samme kilde som `breaches`/`tierBreaches`), ikke fra de rå rows.
- `scripts/lint-schema-columns.mjs` — fjernet `driftMonitor.js:riders.name`
  fra `KNOWN_FINDINGS` (ratchet skrumpet, som krævet af #3586-guarden).
- Ny test `backend/lib/balanceDriftWatchRoute.test.js` pinner at `days`
  bygges fra `ascRows`.

## Forhindret-fremover
Skema-guarden fra #3586 (PR #3693) fanger fremtidige ukendte kolonner
automatisk. Rækkefølge-buggen er der stadig ingen generisk vagt for — den nye
kilde-scan-test er den konkrete guard for netop dette endpoint.

## Læring
`if (!error)`/`if (!queryError)`-mønstret er farligt i monitorer: den
fejltype monitoren findes for at fange er præcis den mønstret gør usynlig.
Når en handler holder to kopier af samme data i forskellig rækkefølge
("rows" og "ascRows"), er det et rødt flag i sig selv — næste person der
tilføjer et response-felt vil statistisk gætte forkert på hvilken af de to
der er "den rigtige". Overvej at kun beholde den stigende kopi og lade
kaldere reversere lokalt hvis de faktisk har brug for faldende.
