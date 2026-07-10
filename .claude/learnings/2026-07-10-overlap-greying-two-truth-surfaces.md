# 2026-07-10 — Overlap-greying: to flader, to sandheder (#2256/#2265)

## Symptom
Rytter vistes ledig på ét løbs planlægningsside men optaget på et overlappende løbs side; spiller kunne (tilsyneladende) gemme samme rytter i to samtidige løb.

## Rod-årsager (tre adskilte)
1. **Per-løb-siden (`RaceSelectionPanel`) havde INGEN binding-greying** — konflikten opdagedes først som 409 ved gem. Dag-brættet havde greying, men dets bindingMap så kun dagens egne kolonner → løb på andre dage/puljer bandt "usynligt".
2. **Monument-båndet:** monumenter ligger bevidst på `game_day` 100000+ (binding-fri) — så "gemte overlap" med et monument var by design, men ejer-intentionen var en EGEN eksklusiv game day, ikke undtagelse fra reglen (→ #2274).
3. **TOCTOU:** save-guarden læste binding-kontekst FØR RPC'ens advisory-lås.

## Læringer
- **Mål overlap i det rigtige dag-rum.** `races.game_day_start` er IRL-visningsdag; binding-sandheden er `race_stage_schedule.game_day`. Min første prod-måling i det forkerte rum gav 97 falske "violations" i tier 3; i guardens rum var der 0. Verificér nøglerummet FØR du kalder noget en violation.
- **Tilgængeligheds-sandhed skal komme fra ÉN kilde.** Når to UI-flader hver bygger deres egen binding-model, divergerer de. Fix = server beregner binding (samme datavej som save-guarden) og fladerne konsumerer.
- **Subagent-stalls:** flere baggrunds-agenter svarede "jeg arbejder i baggrunden" uden tool-kald. Fix = kør udførende agenter SYNKRONT (`run_in_background: false`) med eksplicit "ingen delegering, evidens-krav i svaret".

## Forebyggelse
- RPC-guard under advisory-lås = hård garanti (migration i PR #2275); app-lagets tjek er nu kun den navngivne pre-flight.
- #2274 fjerner monument-særtilfældet ved at give monumenter eksklusive game days.
