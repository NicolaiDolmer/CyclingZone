# Postmortem · 2026-07-23 · To stier, én konvention, kun den ene konverterede

## Hvad skete der?

Et bytte-modtilbud afgivet af den modtagende part fik pengeretningen vendt om. Feltet lovede "positive = you receive"; systemet registrerede afsenderen som betaler. En spiller fangede det via in-game feedback-knappen — første rigtige indsendelse gennem den kanal nogensinde — og modparten nåede at gennemskue fejlen, så handlen ikke blev gennemført.

## Root cause

`frontend/src/pages/TransfersPage.jsx:548` negerede værdien på vej ud:

```js
doAction("counter", { counter_cash: -counterCash })
```

Konventionen er ellers uniform hele vejen ned: `schema.sql:359` (positiv = proposing betaler receiving), `transferExecution.js:762` (`payerId = cash > 0 ? proposing : receiving`), og counter-handleren i `routes/api.js:5835` gemmer værdien verbatim. Inputfeltet prefilles endda med den rå lagrede værdi (`TransfersPage.jsx:450`), så feltet ER i rå konvention.

Den anden modtilbuds-sti — den foreslående part der svarer på et modtilbud (`:591`) — negerede **ikke**. Begge stier deler samme `counterCash`-state og samme prefill. Asymmetrien er hele bugget.

Sandsynlig oprindelse: de to labels (`cashReceiveLabel` / `cashPayLabel`) beskriver korrekt hvad positiv betyder for hver sin part, og det ser ud som om nogen har læst det som at også *værdien* skulle vendes for den ene part. Men labelen oversætter allerede perspektivet; værdien skulle blive i rå konvention.

## Fix

Fjern negeringen, så begge stier sender den rå værdi. Labels bevares forskellige. Regressionsguard i `frontend/src/pages/TransfersPage.swapCashSign.test.js`: forbyder negeret `counter_cash`, kræver at **alle** sendesteder sender samme rå udtryk, og fastholder at de to perspektiv-labels forbliver forskellige. Mutations-verificeret mod `origin/main` før fixet — regexen matcher den gamle kode, så testen ville have fejlet.

PR-branch `fix/2843-swap-counter-cash-sign`, Refs #2843.

## Forhindret-fremover

Testen asserter **symmetri** mellem sendestederne, ikke bare fraværet af det ene minus. En fremtidig tredje modtilbuds-sti der finder på sin egen konvention, fejler også.

## Læring

**Når en UI-label allerede oversætter perspektivet, må værdien ikke oversættes igen.** "Positiv = du modtager" og "positiv = du betaler" er to *beskrivelser* af den samme lagrede konvention set fra hver sin side. Konverterer man oveni, konverterer man to gange.

Den generaliserbare lugt: **to call sites der deler state og prefill, men behandler den forskelligt på vej ud.** Prefill'et var her det afgørende bevis — feltet blev fyldt med den rå lagrede værdi, så input'et *kunne* ikke være i en anden konvention end den rå. Når man er i tvivl om et fortegn, så se på hvad feltet initialiseres med; det afslører hvilken konvention feltet faktisk taler.

Og en observation om kanalen frem for koden: bugget lå i en flade med tests, lint og CI, og blev fundet af en spiller. Feedback-knappen betalte sig selv tilbage på sin første indsendelse. Men den lå ulæst i to timer og blev kun opdaget ved et tilfælde, fordi feature-liveness-auditen råbte op om en forældet whitelist-entry. En kanal der tager imod uden at nogen læser, er kun halvt bygget — se #2842.
