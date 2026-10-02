# #6097: morgenudbruddets størrelse under `orders_gc_v2` (2/10)

Kvalitativ rapport. Tal, løbsnavne og fordelinger ligger privat i `balance-internals/6097/` (`tal-2026-10-02.md`, `foer-efter-6097.png`).

## Problem

Under `orders_gc_v2` var morgenudbruddet typisk meget lille, og på en stor del af vejetaperne kom der slet intet udbrud. Årsagen: kun hunters, frie roller og ryttere med "Forsøg udbrud" må forsøge, og AI-holdenes trupper består af kaptajner, sprint-kaptajner og hjælpere. AI-taktikken (M14) sendte kun hunters og frie roller, så AI-holdene forsøgte i praksis aldrig.

## Ændringen (ejer-beslutning A, kun `orders_gc_v2`)

Et AI-hold der lader udbruddet gå, vælger selv sin bedste passende rytter som udbrudsforsøg: hunter, fri rolle eller hjælper, aldrig kaptajn, sprint-kaptajn eller en rytter på grupetto, og kun en rytter der passer til dagens terræn (aggression og terrænevne højt nok i feltet). Neutrale hold og hold der jager sender ingen ekstra. Valget ligger i M14 og når motoren som en almindelig holdordre, så prod og dry-run bruger samme logik. Intet skrives til databasen. Menneskeholdenes ryttere følger rolle-reglerne uændret. Legacy og `orders_gc_v1` er uændrede (M14 får kun revisionen under `orders_gc_v2`, låst med tests).

Flere varianter blev målt (flere forsøg pr. hold, også neutrale hold, intet terrænfilter). De gav større udbrud, men udbruddet vandt for ofte på bjerg, kuperet og flad, og GC-kaptajnerne tabte mere tid til favoritterne. Den valgte variant er den mindste ændring der rammer målene.

## Resultat på 13 rigtige felter (74 vejetaper, 20 seeds)

- **Udbruddets størrelse:** fra typisk 1-2 ryttere til en median inden for ejer-målet på alle terræntyper.
- **Etaper uden udbrud:** fra en stor andel til næsten ingen.
- **Udbrud foran favoritterne på bjerg:** fra et godt stykke under til omkring ejer-målet.
- **Udbruddet vinder:** stiger moderat. Flad er stadig sjælden, rullende under kuperet, bjerg højest.
- **GC-kaptajnernes tidstab til favoritterne:** uændret på bjerg og kuperet (median og andel over 5 minutter).
- **GC-kaptajnernes tidstab til vinderen og "nr. 10 efter vinderen":** stiger på bjerg. Det er den direkte følge af at udbruddet oftere ender foran favoritterne, som ejer-målet beder om, og ikke et større tab inden for favoritgruppen.
- **Spearman (evne mod placering) og specialist-inversion:** praktisk talt uændrede.
- **Overtrædelser af rolle-reglerne for menneskehold:** fortsat ingen. AI-holdenes forsøg tælles separat i dry-run.
- **replay5957:** udbruddene er nu af realistisk størrelse; Spearman pr. terræn er praktisk talt uændret.

## Stresstest ("alle må forsøge, men alle skal ikke lykkes")

Hvert hold, AI og menneske, får én rytter med "Forsøg udbrud" på hver etape. Alle hold forsøger, ikke alle lykkes, og udbruddet stopper ved motorens faste loft over udbruddets størrelse, som ligger inden for ejer-målet. Adfærden er låst i `backend/lib/engine/v4/mechanics/breakawayStress6097.test.ts` på et felt med 20 hold over tre terræntyper. I stresstesten er udbruddet altid fuldt (loftet), og på flad vinder det klart oftere end normalt, fordi næsten ingen hold er tilbage til at jage.

## Dry-run

`backend/scripts/dev/dryRunUpcomingStage.mjs` tæller ikke længere AI-holdenes egne forsøg som overtrædelser. Den viser dem separat og viser også antal seeds uden udbrud.

## Hvad målingen ikke dækker

- Ordrerne er dem der lå i prod 2/10; managerne kan ændre dem før hver etape.
- Etaperne er målt enkeltvis uden akkumuleret klassement (GC-reaktionen er derfor ikke aktiv i målingen).
- Felter med få AI-hold får stadig mindre udbrud; dér afhænger størrelsen af menneskeholdenes egne ordrer.
- Stresstesten bruger motorens faste loft som "kamp om pladserne". Udbruddet varierer derfor ikke i størrelse, når alle forsøger.
