# #4131 minimal-patch dry-run — flyt 21/9's endagsloeb

Koert 2026-08-23, 100% read-only (prod-data via infisical). Flytter KUN de 25 endagsloeb der ligger paa mandag 21/9 til en tidligere dag i puljens EGEN kalender (25/8-20/9). Alt andet er uroert.

## Maal

| | Vaerdi | Maal |
|---|---:|---:|
| Loeb flyttet | 5 | 25 |
| Loeb med uaendret dato | 466 | 446 |
| D1-dage med kun 1 loeb (foer) | 3 | — |
| race_entries for saeson 3 (foer) | 0 | — |

## Maks loeb/dag pr. involveret pulje

| Pulje | Tier | Foer | Efter |
|---|---|---:|---:|
| 1 | 1 | 4 | 4 |
| 2 | 2 | 4 | 4 |
| 3 | 2 | 4 | 4 |
| 4 | 3 | 3 | 3 |
| 5 | 3 | 3 | 3 |
| 6 | 3 | 3 | 3 |
| 7 | 3 | 3 | 3 |
| 8 | 4 | 2 | 2 |
| 9 | 4 | 2 | 2 |
| 10 | 4 | 2 | 2 |
| 11 | 4 | 2 | 2 |
| 12 | 4 | 2 | 2 |
| 13 | 4 | 2 | 2 |
| 14 | 4 | 2 | 2 |
| 15 | 4 | 2 | 2 |

## Flytnings-plan (5 loeb)

| Loeb | Pulje | Tier | Fra | Til | Ny belastning den dag | Note |
|---|---|---|---|---|---:|---|
| Giro Veneto | 2 | 2 | 2026-09-21 | 2026-09-01 | 3 |  |
| Classica delle Colline Venete | 3 | 2 | 2026-09-21 | 2026-09-01 | 3 |  |
| La Classique Bretonne | 1 | 1 | 2026-09-21 | 2026-09-05 | 2 |  |
| Giro Veneto | 3 | 2 | 2026-09-21 | 2026-09-02 | 3 |  |
| Classica delle Colline Venete | 2 | 2 | 2026-09-21 | 2026-09-02 | 3 |  |

## Uloeste (20)

| Loeb | Pulje |
|---|---|
| Chrono des Herbiers Mineur | 14 |
| Grand Prix de Namur | 6 |
| Classique du Japon | 4 |
| Chrono des Herbiers Mineur | 10 |
| Chrono des Herbiers Mineur | 9 |
| Classique de Touraine | 4 |
| Grand Prix de Namur | 7 |
| Chrono des Herbiers Mineur | 8 |
| Classique du Japon | 5 |
| Classique du Japon | 6 |
| Classique du Japon | 7 |
| Classique de Touraine | 5 |
| Chrono des Herbiers Mineur | 13 |
| Chrono des Herbiers Mineur | 15 |
| Chrono des Herbiers Mineur | 11 |
| Grand Prix de Namur | 5 |
| Classique de Touraine | 6 |
| Grand Prix de Namur | 4 |
| Chrono des Herbiers Mineur | 12 |
| Classique de Touraine | 7 |

## Entries

race_entries for saeson 3 foer flytning: **0**. 0 fundet (saeson 3 er 2026-08-23, 2 dage foer foerste loebsdag 25/8) — INGEN entries at flytte/regenerere. Springes over ved --apply.

## Konklusion

20 loeb kunne IKKE placeres inden for eksisterende kapacitets-loft — se tabellen "Uloeste" ovenfor. Kraever ejer-beslutning (loesne loftet for netop disse dage, eller acceptere at de forbliver paa 21/9).
