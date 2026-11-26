# Undersoegelse: taendingskort for training_peak_from_ticks_6490 (#6490)

Dato: 2026-11-26. Spor: undersoegelse (kind: investigate). Ingen kodeaendring, ingen flip, ingen prod-skrivning (kun SELECT i read-only transaktion). Bygger paa rapporten i PR #8753.

## 1. Frisk paritet, alle hold: 0 afvigelser

Read-only transaktion (BEGIN READ ONLY ... ROLLBACK). Kopien (`training_day_runs.report.riders`: rider_id, status, focus) mod `training_runs_from_ticks_6490(..., p_slim=true)` (peak-signalets laeseglue), for ALLE hold med koersler de seneste 30 dage, 2026-10-27 til og med i dag.

| Maaling | Kopi | Kvitteringer |
|---|---|---|
| Hold | 294 | 294 |
| Koersler (dagsrapporter) | 39.198 | 39.198 |
| Rytterraekker | 1.159.771 | 1.159.771 |
| EXCEPT ALL kopi minus kvittering | 0 | |
| EXCEPT ALL kvittering minus kopi | 0 | |

Sammenligningsnoegle: (hold, tick_date, rider_id, status, focus). **Afvigelser: 0 (nej, ingen afvigelser).** Stoerre og bredere end PR #8753 (40 hold, 18 dage).

## 2. Foer-billede af aktive peak-planer

Gemt PRIVAT (ikke i repoet): `C:\Dev\CyclingZone-worktrees\.wave-scratch\docs-6490-taendingskort\foer-billede-peak-planer-2026-11-26.txt` (indeholder kun taeller, hash og genskab-forespoergsel).

- Tidspunkt: 2026-11-26 ca. 08:43 UTC. Kilde: `rider_peak_plans` med `window_end >= current_date`, joinet til `races`.
- Antal og hash ligger i den private fil (hash over id, rytter, saeson, loeb, vindue, laas).
- Vigtigt: planerne er INPUT, flaget aendrer ikke tabellen. Flaget aendrer kun peak-signalet (status/focus-historikken, motoren laeser). Foer/efter-sammenligningen af planer er derfor en sanity-check (intet er skrevet), og den reelle effekt maales via paritet (afsnit 1) plus at motorens peak-output er uaendret (golden-test dækker slukket/taendt paritet). Hash flytter sig naturligt hvis en spiller redigerer en plan eller en plan udloeber; sammenlign derfor med filter paa den oprindelige dato.

## 3. Praecise kommandoer (kun ejer-go, jeg har IKKE flippet)

Nuvaerende vaerdi: `"off"` (jsonb-streng), historik-flaget er `"on"`.

Flip (fresh-laesning, ingen deploy):

    UPDATE public.app_config SET value = '"on"'::jsonb WHERE key = 'training_peak_from_ticks_6490';

Rollback (samme sekund, ingen data aendret):

    UPDATE public.app_config SET value = '"off"'::jsonb WHERE key = 'training_peak_from_ticks_6490';

Kun den eksakte vaerdi "on" taender; alt andet (ogsaa opslagsfejl) giver slukket.

## 4. Tjek efter flip

1. Verificer vaerdi: `SELECT key, value FROM public.app_config WHERE key='training_peak_from_ticks_6490';`
2. Railway-log (read-only) efter foerste motorkoersel/peak-beregning: ingen linjer med `training_day_runs (peak leadup)`; ingen fejl fra `training_runs_from_ticks_6490`; koerselstid ikke vaesentligt laengere (ny vej pagineres).
3. Sentry: ingen nye issues i timen efter flip med "peak leadup" eller RPC-navnet.
4. Peak-planer: samme taelling og hash som foer-billedet (med samme dato-filter); planerne maa ikke vaere aendret.
5. Fresh paritet igen lige efter flip (afsnit 1) = 0.
6. Ved fejl eller afvigelse: rollback-kommandoen oven for, derefter rapportér paa issuet.
7. Ingen spillervendt tekst, ingen patch note. Opdater issue/roadmap efter tre gode aftener.

## 5. Dom

Problemet (er det sikkert at taende?) er bekraeftet klart til taending: 0 afvigelser paa alle 294 hold over 30 dage (1,16 mio. rytterraekker), flaget er fail-safe og testet, og foer-billedet og rollback er paa plads. Mangler kun ejer-go ordret (motor-input).

bekraeftet + fix-plan
