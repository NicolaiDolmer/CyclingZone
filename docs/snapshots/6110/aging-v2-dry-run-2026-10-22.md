# Udvikling 2.0 del 1 — prøvekørsel af tilbagegangen (2026-10-22)

Read-only prøvekørsel af `backend/scripts/dev/agingV2DryRun6110.mjs` mod prod (#6499, #6110).
Produktionens egen sæsonskifte-motor er kørt mod et øjebliksbillede, med flaget slukket (gammel) og tændt (ny).
"Ny (hel)" fremskriver den igangværende sæsons belastning til en hel sæson. Alder = alder i den nye sæson.
Kun antal ryttere står her; gennemsnit og fald-størrelser ligger privat i `balance-internals/6110/`.

| Alder | Gruppe | Ryttere | ≥1 fald (gammel / ny / ny hel) | Vækst ved skiftet (gammel / ny) | Tekniske+mentale ændret (gammel / ny) | Synligt ratingfald (gammel / ny / ny hel) |
|---|---|---|---|---|---|---|
| <=28 | manager | 3115 | 0 / 0 / 0 | 80 / 0 | 80 / 0 | 0 / 0 / 0 |
| <=28 | AI | 2830 | 0 / 0 / 0 | 2830 / 0 | 2830 / 0 | 0 / 0 / 0 |
| <=28 | fri | 3530 | 0 / 0 / 0 | 3530 / 0 | 3530 / 0 | 0 / 0 / 0 |
| 29-30 | manager | 444 | 444 / 0 / 0 | 0 / 0 | 444 / 0 | 439 / 0 / 0 |
| 29-30 | AI | 329 | 329 / 0 / 0 | 0 / 0 | 329 / 0 | 326 / 0 / 0 |
| 29-30 | fri | 196 | 196 / 0 / 0 | 0 / 0 | 196 / 0 | 196 / 0 / 0 |
| 31-33 | manager | 623 | 623 / 622 / 622 | 0 / 0 | 623 / 0 | 610 / 230 / 215 |
| 31-33 | AI | 674 | 674 / 674 / 674 | 0 / 0 | 674 / 0 | 670 / 368 / 369 |
| 31-33 | fri | 261 | 261 / 261 / 261 | 0 / 0 | 261 / 0 | 255 / 146 / 146 |
| 34-36 | manager | 338 | 338 / 338 / 338 | 0 / 0 | 338 / 0 | 336 / 220 / 213 |
| 34-36 | AI | 498 | 498 / 498 / 498 | 0 / 0 | 498 / 0 | 491 / 426 / 408 |
| 34-36 | fri | 159 | 159 / 159 / 159 | 0 / 0 | 159 / 0 | 152 / 117 / 117 |
| 37+ | manager | 146 | 146 / 146 / 146 | 0 / 0 | 146 / 0 | 144 / 112 / 109 |
| 37+ | AI | 235 | 235 / 235 / 235 | 0 / 0 | 235 / 0 | 233 / 218 / 218 |
| 37+ | fri | 84 | 84 / 84 / 84 | 0 / 0 | 84 / 0 | 78 / 65 / 65 |
| **Alle** |  | 13462 | 3987 / 3017 / 3017 | 6440 / 0 | 10427 / 0 | 3930 / 1902 / 1860 |

Kontrol: vækst ved skiftet (ny) = 0, tekniske+mentale ændret (ny) = 0. Begge skal være 0.
Endagsløb tæller med i løbsdagene: 291 endagsløb i sæsonen gav 31600 rytter-løbsdage (fra rytterens 'gc'-række; endagsløb har ingen 'stage'-rækker).
