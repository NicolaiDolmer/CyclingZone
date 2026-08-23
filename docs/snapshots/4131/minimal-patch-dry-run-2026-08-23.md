# #4131 minimal-patch dry-run v2 — flyt 21/9's endagsloeb (+1-loft, ejer-beslutning 23/8)

Koert 2026-08-23, 100% read-only (prod-data via infisical). Ejer-beslutning ordret: "Vi skal have en kalender fra 25/8-20/9 paa lige saa mange loebsdage som vi havde planlagt i forvejen ... Det kan vi godt faa til at fungere." INGEN loeb udgaar, INGEN regenerering — kun de 25 endagsloeb der ligger 21/9 flyttes, puljens loft maa overskrides med +1 paa de dage det kraever.

## Maal

| | Vaerdi | Maal |
|---|---:|---:|
| Loeb flyttet | 25 | 25 |
| Loeb med uaendret dato | 446 | 446 |
| race_entries for saeson 3 (foer) | 0 | 0 |

## Pr.-pulje: cap+1-dage + loebs-antal (verifikation: samlet loebs-antal pr. pulje er UAeNDRET — vi flytter kun DATO, ingen loeb tilfoejes/fjernes)

| Pulje | Tier | M_pool (foer) | cap+1-dage | Dage | Loeb i puljen |
|---|---|---:|---:|---|---:|
| 1 | 1 | 4 | 0 | — | 33 |
| 2 | 2 | 4 | 0 | — | 43 |
| 3 | 2 | 4 | 0 | — | 43 |
| 4 | 3 | 3 | 0 | — | 36 |
| 5 | 3 | 3 | 0 | — | 36 |
| 6 | 3 | 3 | 0 | — | 36 |
| 7 | 3 | 3 | 0 | — | 36 |
| 8 | 4 | 2 | 1 | 2026-08-25 | 26 |
| 9 | 4 | 2 | 1 | 2026-08-25 | 26 |
| 10 | 4 | 2 | 1 | 2026-08-25 | 26 |
| 11 | 4 | 2 | 1 | 2026-08-25 | 26 |
| 12 | 4 | 2 | 1 | 2026-08-25 | 26 |
| 13 | 4 | 2 | 1 | 2026-08-25 | 26 |
| 14 | 4 | 2 | 1 | 2026-08-25 | 26 |
| 15 | 4 | 2 | 1 | 2026-08-25 | 26 |

## Flytnings-plan (25 loeb)

| Loeb | Pulje | Tier | Fra | Til | Belastning foer→efter | Cap-status | Note |
|---|---|---|---|---|---|---|---|
| Chrono des Herbiers Mineur | 14 | 4 | 2026-09-21 | 2026-08-25 | 2→3 | +1 (var 2) |  |
| Grand Prix de Namur | 6 | 3 | 2026-09-21 | 2026-08-27 | 2→3 | inden for eksisterende loft |  |
| Classique du Japon | 4 | 3 | 2026-09-21 | 2026-08-27 | 2→3 | inden for eksisterende loft |  |
| Chrono des Herbiers Mineur | 10 | 4 | 2026-09-21 | 2026-08-25 | 2→3 | +1 (var 2) |  |
| Chrono des Herbiers Mineur | 9 | 4 | 2026-09-21 | 2026-08-25 | 2→3 | +1 (var 2) |  |
| Classique de Touraine | 4 | 3 | 2026-09-21 | 2026-08-28 | 2→3 | inden for eksisterende loft |  |
| Giro Veneto | 2 | 2 | 2026-09-21 | 2026-09-01 | 2→3 | inden for eksisterende loft |  |
| Grand Prix de Namur | 7 | 3 | 2026-09-21 | 2026-08-27 | 2→3 | inden for eksisterende loft |  |
| Chrono des Herbiers Mineur | 8 | 4 | 2026-09-21 | 2026-08-25 | 2→3 | +1 (var 2) |  |
| Classique du Japon | 5 | 3 | 2026-09-21 | 2026-08-27 | 2→3 | inden for eksisterende loft |  |
| Classica delle Colline Venete | 3 | 2 | 2026-09-21 | 2026-09-01 | 2→3 | inden for eksisterende loft |  |
| La Classique Bretonne | 1 | 1 | 2026-09-21 | 2026-09-05 | 1→2 | inden for eksisterende loft |  |
| Classique du Japon | 6 | 3 | 2026-09-21 | 2026-08-28 | 2→3 | inden for eksisterende loft |  |
| Classique du Japon | 7 | 3 | 2026-09-21 | 2026-08-28 | 2→3 | inden for eksisterende loft |  |
| Classique de Touraine | 5 | 3 | 2026-09-21 | 2026-08-28 | 2→3 | inden for eksisterende loft |  |
| Chrono des Herbiers Mineur | 13 | 4 | 2026-09-21 | 2026-08-25 | 2→3 | +1 (var 2) |  |
| Chrono des Herbiers Mineur | 15 | 4 | 2026-09-21 | 2026-08-25 | 2→3 | +1 (var 2) |  |
| Chrono des Herbiers Mineur | 11 | 4 | 2026-09-21 | 2026-08-25 | 2→3 | +1 (var 2) |  |
| Giro Veneto | 3 | 2 | 2026-09-21 | 2026-09-02 | 2→3 | inden for eksisterende loft |  |
| Grand Prix de Namur | 5 | 3 | 2026-09-21 | 2026-08-30 | 2→3 | inden for eksisterende loft |  |
| Classique de Touraine | 6 | 3 | 2026-09-21 | 2026-08-30 | 2→3 | inden for eksisterende loft |  |
| Grand Prix de Namur | 4 | 3 | 2026-09-21 | 2026-08-30 | 2→3 | inden for eksisterende loft |  |
| Chrono des Herbiers Mineur | 12 | 4 | 2026-09-21 | 2026-08-25 | 2→3 | +1 (var 2) |  |
| Classique de Touraine | 7 | 3 | 2026-09-21 | 2026-08-30 | 2→3 | inden for eksisterende loft |  |
| Classica delle Colline Venete | 2 | 2 | 2026-09-21 | 2026-09-02 | 2→3 | inden for eksisterende loft |  |

## Bemanding paa cap+1-dage (information til ejeren, ikke en blokering)

| Pulje | Tier | Dag | Hold | Min trup | Median trup | Rytter-behov (alle loeb den dag) | Hold der IKKE kan bemande fuldt |
|---|---|---|---:|---:|---:|---:|---:|
| 8 | 4 | 2026-08-25 | 9 | 5 | 11 | 18 | 8 |
| 9 | 4 | 2026-08-25 | 9 | 8 | 9 | 18 | 8 |
| 10 | 4 | 2026-08-25 | 9 | 11 | 14 | 18 | 7 |
| 11 | 4 | 2026-08-25 | 9 | 4 | 12 | 18 | 7 |
| 12 | 4 | 2026-08-25 | 9 | 4 | 13 | 18 | 8 |
| 13 | 4 | 2026-08-25 | 9 | 4 | 13 | 18 | 8 |
| 14 | 4 | 2026-08-25 | 8 | 8 | 14 | 18 | 6 |
| 15 | 4 | 2026-08-25 | 8 | 1 | 12 | 18 | 6 |

## Entries

race_entries for saeson 3 foer flytning: **0**. 0 fundet (saeson 3 er 2026-08-23, 2 dage foer foerste loebsdag 25/8) — springes over ved --apply.

## Konklusion

Alle 25 loeb placeret. 8 cap+1-dage i alt paa tvaers af 8 puljer (se bemandings-tabellen for ejerens beslutningsgrundlag). 0 loeb fjernet, 0 puljer/tiers aendret, 0 andre loeb roert.
