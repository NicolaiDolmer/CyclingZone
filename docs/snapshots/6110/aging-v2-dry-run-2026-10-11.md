# Udvikling 2.0 del 1 — prøvekørsel af tilbagegangen (2026-10-11)

> **FORÆLDET — skal køres igen.** Tallene herunder er lavet før rettelsen af løbsdag-tællingen: endagsløb (`race_type='single'`) gav 0 løbsdage, fordi kun `result_type='stage'` blev talt. Kolonnerne "ny" og "ny hel" er derfor for høje for ryttere der har kørt endagsløb. "Gammel" er upåvirket. Genkør `backend/scripts/dev/agingV2DryRun6110.mjs`; den nye fil viser også hvor mange rytter-løbsdage endagsløbene gav.

Read-only prøvekørsel af `backend/scripts/dev/agingV2DryRun6110.mjs` mod prod (#6499, #6110).
Produktionens egen sæsonskifte-motor er kørt mod et øjebliksbillede, med flaget slukket (gammel) og tændt (ny).
"Ny (hel)" fremskriver den igangværende sæsons belastning til en hel sæson. Alder = alder i den nye sæson.
Kun antal ryttere står her; gennemsnit og fald-størrelser ligger privat i `balance-internals/6110/`.

| Alder | Gruppe | Ryttere | ≥1 fald (gammel / ny / ny hel) | Vækst ved skiftet (gammel / ny) | Tekniske+mentale ændret (gammel / ny) | Synligt ratingfald (gammel / ny / ny hel) |
|---|---|---|---|---|---|---|
| <=28 | manager | 2900 | 0 / 0 / 0 | 80 / 0 | 80 / 0 | 0 / 0 / 0 |
| <=28 | AI | 3079 | 0 / 0 / 0 | 3079 / 0 | 3079 / 0 | 0 / 0 / 0 |
| <=28 | fri | 4155 | 0 / 0 / 0 | 4155 / 0 | 4155 / 0 | 0 / 0 / 0 |
| 29-30 | manager | 425 | 425 / 0 / 0 | 0 / 0 | 425 / 0 | 422 / 0 / 0 |
| 29-30 | AI | 355 | 355 / 0 / 0 | 0 / 0 | 355 / 0 | 350 / 0 / 0 |
| 29-30 | fri | 194 | 194 / 0 / 0 | 0 / 0 | 194 / 0 | 194 / 0 / 0 |
| 31-33 | manager | 606 | 606 / 606 / 606 | 0 / 0 | 606 / 0 | 593 / 268 / 224 |
| 31-33 | AI | 721 | 721 / 721 / 717 | 0 / 0 | 721 / 0 | 711 / 273 / 184 |
| 31-33 | fri | 257 | 257 / 257 / 257 | 0 / 0 | 257 / 0 | 251 / 144 / 144 |
| 34-36 | manager | 326 | 326 / 326 / 326 | 0 / 0 | 326 / 0 | 324 / 253 / 213 |
| 34-36 | AI | 544 | 544 / 544 / 544 | 0 / 0 | 544 / 0 | 537 / 425 / 278 |
| 34-36 | fri | 161 | 161 / 161 / 161 | 0 / 0 | 161 / 0 | 154 / 118 / 118 |
| 37+ | manager | 139 | 139 / 139 / 139 | 0 / 0 | 139 / 0 | 137 / 113 / 103 |
| 37+ | AI | 252 | 252 / 252 / 252 | 0 / 0 | 252 / 0 | 250 / 230 / 174 |
| 37+ | fri | 85 | 85 / 85 / 85 | 0 / 0 | 85 / 0 | 79 / 66 / 66 |
| **Alle** |  | 14199 | 4065 / 3091 / 3087 | 7314 / 0 | 11379 / 0 | 4002 / 1890 / 1504 |

Kontrol: vækst ved skiftet (ny) = 0, tekniske+mentale ændret (ny) = 0. Begge skal være 0.
