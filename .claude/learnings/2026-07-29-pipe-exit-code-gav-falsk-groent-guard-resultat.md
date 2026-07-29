# Falsk grønt fra en guard, fordi `$?` læste `tail` i stedet for `node`

**Dato:** 2026-07-29
**Kontekst:** PR #3029 (#230, auto-annullér udmattede autobud)

## Hvad skete der

CI's `dropped-supabase-error-guard` fejlede på PR #3029. Jeg kørte guarden lokalt for
at afgøre om fejlen var reel eller stale, og fik "exit 0". Konklusion: stale, main var
løbet fra PR'en. Forkert — guarden fejlede fordi PR'en genuint tilføjede to utjekkede
`.delete()`-kald (`proxyBidding.js`: 5 mod baseline 3).

Kommandoen var:

```bash
node scripts/lint-unchecked-supabase-mutation.mjs | tail -8; echo "guard-exit=$?"
```

`$?` i en pipeline er **sidste** kommandos exit-kode. `tail` lykkes altid. Guardens
faktiske exit 1 var usynlig, og dens fejloutput var scrollet ud af de sidste 8 linjer.
Jeg rapporterede "begge guards exit 0" til ejeren på det grundlag.

Fejlen overlevede fordi jeg gentog samme mønster ved næste kørsel — jeg tjekkede ikke
konklusionen, jeg gentog målingen med samme defekte instrument.

## Hvorfor det betød noget her

Fejlklassen guarden beskytter mod var præcis den, PR'en indførte. `supabase-js` kaster
ikke: en afvist `.delete()` returnerer `{ error }` og koden kører videre. Overlever
proxy-rækken, forbliver saldoen reserveret — `computeWorstCaseCommitment` summerer
`max_amount` direkte fra `auction_proxy_bids`. Men koden sendte alligevel beskeden
"din reserverede saldo er frigivet".

Altså: en usand besked til manageren om deres egne penge, i en feature hvis hele formål
var at frigive netop de penge. Værre end bug'en den fixede.

## Regel fremadrettet

- Læs **aldrig** `$?` efter en pipe når exit-koden er det, der afgør noget. Brug
  `${PIPESTATUS[0]}`, eller endnu bedre: skriv til en fil og læs exit-koden direkte:
  ```bash
  node scripts/lint-x.mjs > /tmp/out.log 2>&1; echo "exit=$?"; tail -5 /tmp/out.log
  ```
- En rød CI-check er ikke "stale" før jeg har set dens **faktiske output**. `--log-failed`
  var fyldt med checkout-støj; det rigtige greb var `gh run view <id> --log` filtreret på
  jobnavnet, hvor `FEJL lint:supabase-mutation` stod klart med fil, linjenumre og baseline.
- Når en guard flagger noget, er "hæv baseline" sidste udvej. Her var det rigtige svar at
  binde `{ error }` og — afgørende — gøre den brugerrettede besked betinget af at
  skrivningen faktisk lykkedes.

## Forward-guard

`proxyBidding.test.js` har nu `proxyDeleteError` i mocken, så en fejlende delete kan
simuleres, plus testen *"#230: fejlet delete → INGEN 'saldo frigivet'-besked"*.
Verificeret at den fejler uden fixet og passerer med — ikke antaget.

Se også: `feedback_runtime_verify_first`, `feedback_verify_each_edit_landed`.
