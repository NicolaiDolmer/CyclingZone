# Postmortem · 2026-08-04 · Ryttertype-klassifikator kollapset + ability_caps' skjulte cirkularitet

## Hvad skete der?
`backend/lib/riderTypes.js`'s kontrast/z-score-klassifikator kollapsede: climber+tt = 94,0% af U22 og 89,8% af seniorer (målt mod 8.301 prod-ryttere, #3325). 6 af 8 typer var reelt uopnåelige. Ejeren besluttede "type = potentiale" (klassificér mod `ability_caps` i stedet for live evner), stabilt hele karrieren, alle aldre.

## Root cause
To lag:
1. **Design-fejl i vægte/guards** (uafhængig af input-rum): climber og puncheur delte 3 af 4 positive evner som krydsled, så den ene altid vandt. gc-guarden krævede 3-4 uafhængige ~97-99-percentil-betingelser SAMTIDIG, hvilket matematisk giver næsten 0% i skæring uanset hvor tallene kalibreres (produktet af lave sandsynligheder).
2. **Skjult cirkularitet mellem type og caps** (opdaget under implementeringen, ikke i den oprindelige issue-analyse): `ability_caps` beregnes af `buildYouthCaps`'s rolle-faktor (`riderProgression.js`), som selv er en funktion af rytterens PERSISTEREDE `primary_type`. At bare skifte klassifikatorens input til de EKSISTERENDE `ability_caps` (som issuet selv foreslog: "kør den eksisterende klassifikator mod ability_caps i stedet for de live evner. Start der") GENSKABTE kollapset, fordi caps for en climber-typet rytter allerede er climber-formede (climbing/tempo/punch/endurance boostet via rolle-faktoren) — klassifikationen bekræftede blot sig selv. Målt: climber gik fra 45,6% (live) til 49,8% (caps, uændrede vægte) FØR vægt-justeringer.

## Fix
- `riderTypes.js`: vægte trimmet (fjernet climber/puncheur-krydsled, trimmet climber/tt's brede negative vægte, opjusteret brostensrytter/rouleur), guards rekalibreret til caps-rummets fordeling (percentil-matchet) og løsnet for gc.
- `backfillCores.js`/`starterSquadAllocator.js`: ny-rytter-intake er nu topunkts (bootstrap-type fra live evner mod NEUTRAL_BASELINE, kun til at seede caps' rolle-faktor, derefter ENDELIG type fra caps mod den rigtige baseline) for at undgå at den skjulte cirkularitet rammer helt nye ryttere (som ikke har en forudgående type at seede med).
- `riderValueRefresh.js`/`riderValueTrend.js`: type-klassifikation adskilt fra valuation-abilities (caps for type, live evner for base_value), så træning ikke længere flytter type-labelen.
- PR: https://github.com/NicolaiDolmer/CyclingZone/pull/3343 (draft, ejer-review krævet).

## Forhindret-fremover
`backend/scripts/simRiderTypesCapsMeasure.js` er et committet, genkørbart, read-only måle-harness (ikke et engangsscript) — enhver fremtidig vægt/guard-justering kan måles mod hele prod-populationen FØR den skrives ind i `riderTypes.js`. Dette havde fanget cirkularitets-problemet MEGET hurtigere hvis det havde eksisteret før #3325.

## Læring
1. **"Skift bare input" er ikke en fri handling når to systemer deler state.** `ability_caps` og `primary_type` er gensidigt afhængige i denne kodebase (caps → rolle-faktor → type; type → hvilke caps skrives). Et forslag om at klassificere FRA et felt der selv blev udledt AF det man klassificerer TIL, skal altid tjekkes for cirkularitet, ikke bare implementeres og målt bagefter — men her blev det netop fanget FORDI vi målte empirisk i stedet for at stole på issuets egen antagelse ("start der").
2. **En AND-gate af N uafhængige høj-percentil-betingelser er matematisk næsten-tom uanset kalibrering** (produktregel for sandsynligheder). Guards med flere SAMTIDIGE høje tærskler (som gc-gaten) bør enten løsnes bevidst eller erstattes af et point-system, ikke bare "rekalibreres" til samme percentil i et nyt rum — problemet er strukturelt, ikke et skalerings-spørgsmål.
3. **Delte vægt-tabeller har usynlige forbrugere.** `RIDER_TYPES.weights` bruges ikke kun af klassifikatoren, men også af `riderProgression.js` (cap-vækst/signatur-evner) og `training.js` (fokus-trænbarhed via `youthRoleFactor`). En vægtjustering for at fixe klassifikationen ændrer også disse afledte systemer, det er ikke isoleret til "hvilket label vises". `predictBaseValue`'s `offset[primary_type]` gjorde typen økonomisk relevant på samme vis, en type-reklassificering flytter reelt market_value, selvom kolonnerne "kun bruges til visning" ifølge en forældet kode-kommentar.
