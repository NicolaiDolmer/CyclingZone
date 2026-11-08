# Roadmap-omprioritering ud fra spillernes stemmer (ejer-besluttet 7/11)

Spillerne giver hver ting to karakterer fra 1 til 6: **Idé** og **Vigtig**. Planlagte ting har kun "Vigtig". Forslag v1 sorterede efter antal stemmer. Ejeren spurgte, om stemmerne overhovedet var positive, så v2 bruger karaktererne. Ting i de tre loft-områder, brand, dato-løfter og ting lovet i dag blev ikke foreslået. Hver ting blev besluttet af ejeren én ad gangen.

## Op i prioritet

| Ting | Stemmer | Idé | Vigtig | Beslutning | Roadmap nu |
|------|--------:|----:|-------:|------------|-----------|
| Træthedsprognose to uger frem + advarsel om kvalifikation (#7892, ny) | 42 | 4,8 | 3,8 | Næste uge | planned/next_week |
| Kaptajner på vejen og mentorer (#1177) | 37 | 4,7 | 3,8 | Efter loftet | planned/next |
| Profilen viser evnernes kilde (#3813) | 19 | 5,1 | 4,7 | Med Udvikling 2.0 | planned/this_season |
| Formtræning for udviklede ryttere (#5238) | 20 | 4,9 | 4,3 | Med Udvikling 2.0 | planned/this_season (uændret) |
| Nationale mesterskaber (#934) | 42 | 4,9 | 3,6 | Nej, bliver stående | active/next (uændret) |
| Klubmuseum (#1148) | 37 | 4,5 | 3,6 | Nej, bliver stående | active/next (uændret) |

## Starten af 2027

| Ting | Stemmer | Idé | Vigtig | Roadmap nu |
|------|--------:|----:|-------:|-----------|
| Værksted for træningsprogrammer (#4630) | 10 | 3,5 | 2,0 | active/y2027 |
| Flere ønskelister (#5621) | 11 | 4,1 | 3,2 | active/y2027 |
| Følg en manager + inviter en ven (#935) | 37 | 3,9 | 3,2 | active/y2027 |
| Flere rygter på markedet (#1147) | 37 | 4,1 | 3,3 | active/y2027 |

## Sæson 6 eller senere

| Ting | Stemmer | Idé | Vigtig | Roadmap nu |
|------|--------:|----:|-------:|-----------|
| Følg egne akademiryttere, også efter salg (#6191) | 12 | 3,8 | 3,4 | active/later |
| Scouts, der er forskellige (#5625) | 14 | 3,9 | 3,7 | active/later |
| Rytterens personlighed (#1154) | 10 | 4,0 | 3,2 | active/later |
| Milepæle, man kan jagte (#5180) | 10 | 4,0 | 3,3 | active/later |
| Junior-pyramiden (#4621, før "før S6-start") | 6 | - | 4,0 | planned/later |

## Laves ikke (arkiveret)

| Ting | Stemmer | Idé | Vigtig |
|------|--------:|----:|-------:|
| Sponsorens grundbeløb pr. løbsdag (#3147) | 11 | 2,5 | 2,1 |
| Løn pr. løbsdag (#2840) | 11 | 2,6 | 2,1 |
| Rejseregioner (#6194) | 10 | 3,3 | 1,9 |
| Ung rytter på prøve mod betaling (#7747) | 4 | 3,3 | 2,0 |
| Nye aldersgrænser for junior og ungdomstrøje (#6126, to punkter) | 11 | 3,1-3,4 | 3,0-3,7 |

## Beholdt som i dag

Spillet på telefonen som en topapp (#6916, næste uge), filtrér efter division (#2399), gemte filtre (#7805/#7744), skade på andre holds ryttere (#5314), løbstyper U23/junior (#7471, før S6-kalenderen), Planning Workbench (#7535, før S6-start).

## Før-tilstand i `roadmap_items` (til tilbagerulning)

Alle aktive punkter ovenfor var `active/next`, undtagen #1177 (`active/later`), #3813 (`planned/next_week`) og #4621 (`planned/next_season`). Træthedsprognosen (id `00000954-0000-4000-8000-000000000013`) var `active/next` uden `issue_ref`; nu er den `issue_ref` 7892. Ændret 7/11 nat via SQL `UPDATE roadmap_items SET status, horizon` på 18 rækker plus issue_ref på én.
