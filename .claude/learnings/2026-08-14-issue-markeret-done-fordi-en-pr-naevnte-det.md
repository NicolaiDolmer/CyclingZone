# Et issue blev markeret done, fordi en PR nævnte det — ikke fordi det var løst

**Dato:** 2026-08-14 · **Issue:** [#3620](https://github.com/NicolaiDolmer/CyclingZone/issues/3620) · **PR'er:** [#3698](https://github.com/NicolaiDolmer/CyclingZone/pull/3698) (merget), [#3710](https://github.com/NicolaiDolmer/CyclingZone/pull/3710) (rettelsen)

## Hvad der skete

Efter natbølgen 14/8 merged jeg elleve PR'er og flippede deres issues fra
`claude:todo` til `claude:done` i samme håndbevægelse. #3620 var en af dem, fordi
PR #3698 refererede den og var merget.

#3620 handlede om en usand påstand: at en akademirytters løn bliver erstattet af
en senior-løn ved oprykning. Den er kun sand for en **kontraktløs** rytter —
`backend/lib/contractSeed.js:86` returnerer `{}`, når rytteren allerede har både
`salary` og `contract_end_season`, så løn, længde og udløbssæson står uændret.

Påstanden stod **to steder**. #3698 rettede den i `help.json`. Den identiske
sætning i selve bekræftelses-modalen blev ikke rørt:

> "They take a senior place and a senior contract. Their academy salary is
> replaced by the senior wage shown above."

Den tekst er den, spilleren læser i klik-øjeblikket, foran en handling der ikke
kan fortrydes. Den blev stående live på main med et `claude:done`-flag over sig.

## Hvordan det blev opdaget

Ved et tilfælde. Ejeren spurgte til noget andet, jeg listede åbne PR'er, og der
lå #3710 — oprettet 07:02, efter bølgen var slut — med `fix(3620)` i titlen. Et
issue jeg havde lukket 45 minutter tidligere havde pludselig en ny PR.

Havde den PR ikke eksisteret, eller havde jeg ikke listet PR'erne igen, var en
usand lønbesked blevet stående foran en irreversibel handling, mærket som
færdig.

## Rod-årsagen

Jeg behandlede "en merget PR refererer issue N" som "issue N er løst". Det er to
forskellige påstande. `feedback_mark_issues_done_after_ship` siger, at flippet
skal ske straks efter merge, PR-for-PR — og den regel er rigtig. Men
`feedback_audit_close_aggressive` siger "merged PR **matcher scope**", og det er
netop scope-matchet jeg sprang over. Referencen blev taget som bevis.

## Reglen

**Før et issue flippes til `claude:done`: søg efter issuets symptom, ikke efter
issuets nummer.**

Er issuet "tekst X er usand", så grep efter tekst X og bekræft nul resterende
forekomster. Er det "kolonne Y mangler i et select", så grep efter selectet. Det
tager sekunder og er den eneste kontrol, der faktisk måler det, issuet handlede
om.

Konkret her ville dette have fanget det med det samme:

```bash
grep -rn "academy salary is replaced" frontend/public/locales/
```

To træffere i stedet for nul. Issue ikke løst.

**Skærpelse ved spillervendt tekst:** en usand sætning foran en irreversibel
handling er ikke en almindelig doc-fejl. Den skal verificeres i den flade
spilleren faktisk ser, ikke kun i hjælpen.

## Sidegevinst

Fejlen afslørede også et hul i PR #3698's eget arbejde: den lavede ikke
backwards-checket fra `feedback_backwards_check_forward_guard` — den rettede den
forekomst, issuet nævnte, og ledte ikke efter søskende. Samme kontrol fanger
begge fejl, uanset hvem der laver dem.

Se også: [[feedback_mark_issues_done_after_ship]],
[[feedback_audit_close_aggressive]], [[feedback_backwards_check_forward_guard]],
[[feedback_runtime_verify_first]]
