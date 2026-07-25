# Droppet Supabase-error: den fejlklasse der ramte tre gange uden at efterlade spor

**Dato:** 2026-07-26 · **Issues:** #2897, #2861, #2898, #2877 · **PR:** feat/2897-dropped-supabase-error-guard

## Symptom

Kalender-siden loadede i 8-9 sekunder (#2861). Ejeren meldte det som et perf-problem.
Ingen 500'er, ingen Sentry-issue, ingen fejllog. Der var intet at kigge på.

## Rodårsag

Koden kaldte et endpoint der ikke kunne lykkes, og skrev:

```js
const { data } = await supabase.from("…").select("…");
```

`supabase-js` **kaster ikke**. Den returnerer altid `{ data, error }`. Destrukturerer man
kun `data`, bliver `error` aldrig bundet — og så findes fejlen ikke længere nogen steder:
ingen exception, ingen HTTP-statuskode, ingen log, ingen Sentry-linje. `data` bliver bare
`null`, og koden fortsætter som om svaret var tomt.

Det er den farligste form for fejl vi har: **et tomt resultat og en fejl ser ens ud.**

## Hvorfor ingen guard fangede det

`scripts/lint-swallowed-catches.mjs` fandtes allerede og virkede. Den fangede bare en
anden fejlklasse: den leder efter `catch`-blokke uden `captureException`/`throw`/markør.
Her er der **ingen catch** — der er ingen exception at fange. Guarden var ikke i stykker,
den kiggede det forkerte sted.

Dertil scannede den kun `backend/lib/**` + `cron.js`. `backend/routes/api.js` — hele
HTTP-fladen, 12.500 linjer, 174 svaltede catches — lå uden for scope.

## Hvad det kostede

Fejlklassen ramte tre gange før nogen forbandt prikkerne:

| Issue | Hvad forsvandt tavst |
|---|---|
| #2861 | Kalender-kald der ikke kunne lykkes — 8-9 sek. pr. load, i månedsvis |
| #2898 | Utjekket `race_results`-delete i fuld-sim → dublerede point og dobbelt præmiepenge |
| #2877 | Etape-berigelse tabt permanent når standings-recompute fejlede — 19 etaper i 14 løb |

Værste fund i denne omgang: `closePrevTransferWindow` i sæsonskiftet. En fejlet select gav
`window = null`, hvorefter funktionen returnerede `{ skipped: true, reason: "no
transfer_window for prev season" }` — altså **rapporterede succes** — og skiftet fortsatte
med det gamle transfer-vindue stadig åbent. S1→S2 den 26/7 var det første rigtige skifte,
så den sti var aldrig blevet kørt i praksis.

## Fix

`scripts/lint-dropped-supabase-error.mjs`: flager destrukturering af et await'et
Supabase-kald der binder `data` uden også at binde `error`. Baseline-ratchet pr. fil
(178 eksisterende frosset, nedspisning i #2997), `// best-effort`-markør som escape-hatch.
`lint-swallowed-catches.mjs` udvidet til `backend/routes/**`.

De 8 forekomster i cutover-stien rettes separat i PR #3000 — de ændrer sæsonskiftet fra
tavst-fortsættende til fail-fast, og det er et ejer-kald, ikke et lint-kald. Guarden er
splittet fra dem netop for at kunne merge uden runtime-risiko.

## Læring

1. **En guard der er grøn beviser kun at den fejlklasse den kender ikke er til stede.**
   Da #2861 blev fundet, var alle guards grønne. Spørgsmålet efter et fund er ikke "var
   guarden i stykker?" men "hvilken fejlklasse dækker ingen af vores guards?"
2. **Tjek altid scopet, ikke kun logikken.** Guarden havde fanget flere af de 174 sites i
   api.js i et år, hvis nogen havde kigget på `collectFiles()`.
3. **Et bibliotek der returnerer fejl i stedet for at kaste, kræver sin egen disciplin.**
   `await` giver en falsk tryghed: det ligner en linje der kaster ved fejl. Det gør den ikke.
4. **Tredje gang er ikke tilfældigt.** Da #2898 og #2877 begge blev sporet tilbage til
   "utjekket Supabase-svar", var det tidspunktet at bygge guarden — ikke at rette site nr. 3.
