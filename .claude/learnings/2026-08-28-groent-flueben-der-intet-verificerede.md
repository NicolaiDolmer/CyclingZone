# Et grønt flueben der intet verificerede (source-map-guarden)

**Dato:** 2026-08-28 · **Issue:** [#4335](https://github.com/NicolaiDolmer/CyclingZone/issues/4335) · **PR:** [#4363](https://github.com/NicolaiDolmer/CyclingZone/pull/4363) · **Oprindelse:** #621 punkt 3

## Hvad der skete

Source-map-guarden i `deploy-verify.yml` havde to fejl på én gang, og de skjulte hinanden:

1. **Den kunne ikke køre.** `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` lå ikke i GitHub Actions. Guarden ramte sin tidlige `exit 0`, satte `result=skipped` og efterlod kun en annotation. Step-conclusion blev `success`.
2. **Den spurgte det forkerte endpoint.** Den kaldte `releases/<sha>/files/`. `@sentry/vite-plugin` v5 uploader source maps som artifact bundles (debug-id-baseret), og de findes ikke dér. Endpointet returnerer `[]` selv når uploaden er lykkedes.

Guarden stod grøn i tre måneder. Havde nogen "aktiveret" den ved at tilføje de tre secrets, var deploy-verify gået rød på hvert eneste frontend-deploy med beskeden "0 source-map files" om en upload der lagde 357 filer hver gang.

## Målt bevis

Release `c9ce695`, som producerede en fuldt symboliseret stacktrace i `CYCLINGZONE-50`:

```
releases/<sha>/files/                 -> []          0 filer
files/artifact-bundles/?query=<sha>   -> 1 bundle    357 filer
```

Samme billede på alle testede main-commits, inkl. rene docs-commits.

## Rod-årsag

Fejl 1 gjorde fejl 2 uopdagelig. En guard der aldrig kører, får aldrig sit spørgsmål afprøvet mod virkeligheden. Og et grønt flueben på et step der sprang over ser i UI'et præcis ud som et grønt flueben på et step der bestod.

Det er den farlige klasse: ikke en vagt der fejler, men en vagt der bekræfter.

## Fix

- Guarden spørger nu `files/artifact-bundles/?query=<sha>` og summerer `fileCount`, med det gamle kald som fallback hvis upload-metoden skifter tilbage.
- Samme fejl fandtes i `scripts/verify-deploy.ps1` og blev rettet med.
- **Forward-guard:** hvert udfald skriver nu en linje til `$GITHUB_STEP_SUMMARY`. Et permanent skip er synligt på run-siden i stedet for begravet i annotations.
- De tre secrets er lagt i Actions, så guarden faktisk kører. Rækkefølgen var kritisk: fix FØR secrets, ellers rød CI.

## Læring

**En vagt der ikke kan fejle, er ikke en vagt.** Når du bygger en guard bag en opt-in (secrets, feature flag, env var), så verificér mindst én gang at den kan sige NEJ. Ellers ved du kun at den kan tie.

**Test guarden mod virkeligheden, ikke mod din model af virkeligheden.** Fejlen her var en antagelse om hvilket Sentry-endpoint der holder source maps. Ét ægte API-kald ville have afsløret det på dag ét.

**"Skipped" må aldrig rapportere som "success" uden at det er synligt.** Hvis et step kan springe over permanent, skal skippet stå et sted et menneske faktisk kigger.

## Relateret

- `.claude/learnings/2026-05-24-claimed-fix-without-verifying-observability-pipeline.md` — samme familie: observability der antages at virke.
- Memory: `feedback_runtime_verify_first` (verificér FØR claim), `feedback_backwards_check_forward_guard`.
