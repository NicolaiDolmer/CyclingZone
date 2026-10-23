# Udvikling 2.0 byggetrin 7: Udviklingsscore B, teknisk design

**Status:** teknisk design 23/10 2026 (AGENTS 36: design + målt baseline før første kode-PR). Ingen kode endnu.
**Epic:** [#6110](https://github.com/NicolaiDolmer/CyclingZone/issues/6110) · **Samlet design:** [`2026-10-23-6110-potentiale-et-tal-samlet-design.md`](2026-10-23-6110-potentiale-et-tal-samlet-design.md) §5 og §13 (S9, S10, S11, S13, S14, S22)
**Baseline og tal:** privat i `balance-internals/6110/udviklingsscore-baseline-2026-10-23.md` (hard rule 17). Dette dokument er kvalitativt.

## 1. Hvad er besluttet (genåbnes ikke)
| Kilde | Beslutning |
|---|---|
| 11/10 træningsscore B | Én værdi pr. dag. Ungdomsfaktoren fjernes. Mere dagsstøj, så talentet først skiller sig ud efter nogle træninger. 7-dages snit ved siden af |
| 20/10 | Navnet bliver Udviklingsscore samme søndag som løbsudviklingen tændes |
| S9 | Løbsdage får et tal på samme skala |
| S10 | Kun tallet og 7-dages snittet vises. Ingen faktorforklaring |
| S11 | Træningsdisciplin (synlig mental evne) indgår som talent-led ved siden af grundtalentet |
| S13 | Træner og facilitet påvirker kun træningsdage, aldrig løbsdage |
| S14 | Løbsdagen: basis + tillæg + "lær af afgørelsen" + bred niveau-bonus |
| S22 | Scoren ER udviklingen: dagens udvikling følger scoren direkte; samlet tempo kalibreres til D1-milepælene |
| H6b | Scorehistorikken må ikke afsløre talentet mere præcist end holdets eget skøn efter samme antal afregnede datoer |

## 2. Hvad er sandt i dag (kortlægning + baseline 23/10)
- `backend/lib/trainingScore.js` bygger scoren af otte led (intensitet, fokus-match, kondition, træner, facilitet, potentiale, ungdom, støj) som et produkt relativt til en reference-session, mappet til 1-99 med en mættende kurve.
- Koblingen til udviklingen er svag (en lav eksponent med normalisering), men udviklingen følger alligevel scoren stærkt inden for samme aldersgruppe, fordi scoren og motoren (`dailyAbilityDelta`) bruger de samme led.
- Løbsdage gemmes, men uden score, og vises som "løb".
- **Sidekanal live i dag:** scorens bidrag (`contributions`) gemmes og sendes til klienten, inklusive talent- og støj-bidrag med point. Med støjen synlig kan talentet aflæses for egne ryttere. S10 lukker det ved tænding; se §7 for en hurtigere rettelse.

## 3. Arkitektur
**Én kilde til både tal og udvikling.** Nyt modul `backend/lib/developmentScore.ts` (TypeScript, ren funktion) erstatter `trainingScore.js` som scorens kilde:

```
developmentDay(input) -> { score: 1..99, devMult: number, kind: "training" | "race" }
```

- `score` er det, spilleren ser. `devMult` er det, motoren ganger på dagens udvikling, og det afledes KUN af `score` (S22, doktrinen S20). Ingen skjult parallel faktor.
- `dailyAbilityDelta` får score-stien som eneste sti, når flaget er tændt: niveau-kurven (D1) × rolleklasse-fart (S6) × `devMult`. Den gamle gren (alder, ungdomstillæg, potentiale-rate) bliver stående bag slukket flag til tænding og slettes bagefter.
- **Træningsdag:** led = intensitet, fokus-match (rolleklasse pr. sessionens evner, S12-kataloget), kondition, træner, facilitet, talent (grundtalent + træningsdisciplin), dagsstøj.
- **Løbsdag:** led = basis (som hård dag, uden træner og facilitet, S13), tillæg i etapens evner, afgørelses-bonus (S14), niveau-bonus, kondition, talent, dagsstøj. Udgået rytter: kun basis (S16). Fri rolle: halvt kaptajn, halvt hjælper (S17).
- **Støj** seedes pr. (rytter, dato), som i dag med `seededUnitMixed`, men bredere (B). Kalibreres mod H6b.
- **Normalisering:** `devMult` normaliseres, så sæsonens samlede udvikling rammer D1-milepælene; måles i 10-sæsoners-simuleringen (S25).

## 4. Data og migration
- `rider_training_scores` beholdes som tabel; ny kolonne `kind` ("training" | "race") og score udfyldes også for løbsdage. Additiv migration, ingen omskrivning af historik.
- `contributions` skrives ikke længere, når flaget er tændt (S10). Gamle rækker ryddes ikke (historik), men API'et sender dem aldrig.
- Navneskiftet (Træningsscore → Udviklingsscore) er kun tekst i alle sprog + help.json og ligger i del 2-pakkens tænd-PR.

## 5. API og visning
- `/api/training/me` og rytterprofilen sender kun `{ today, avg7, spark, kind }`. Ingen faktorer, ingen bidrag (S10, H4, H6b).
- Løbsdage vises med tal på samme skala (S9).

## 6. Flag og rækkefølge
- Flag `development_score_v2` (off). Slukket = bit-identisk med i dag, også i DB-kald.
- PR-rækkefølge: (a) modul + tests uden kaldere · (b) skrivning af score for løbsdage bag flag · (c) motor-kobling bag flag · (d) API-svar bag flag · (e) tekster i tænd-PR'en.
- Gates før tænding: H6b, G1-G8 (del 2), D1-milepælene i 10-sæsoners-simuleringen.

## 7. Åbent til ejeren (ét kort)
**Sidekanalen i dag.** Skal talent- og støj-bidraget fjernes fra API-svaret nu, som en ren teknisk rettelse, i stedet for at vente på tændingen? Anbefaling: ja. Det lukker lækagen med det samme. Den eneste synlige forskel er, at "talent" ikke længere kan stå som årsag i linjen "trækker op/ned".
