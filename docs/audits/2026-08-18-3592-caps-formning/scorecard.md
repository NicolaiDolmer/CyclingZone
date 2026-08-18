# #3592 — Scorecard: dry-run af Kandidat 1 mod riders_full.json (313 pot-5-6 human)

Script: `scorecard.mjs` i denne mappe. Rå output: `scorecard-run.log` / `scorecard-output.json`.
Population og metode: samme som `maaling.md` (313 human pot-5-6, `CAPS_SHAPING_WEIGHTS` +
`YOUTH_PROGRESSION_CONFIG` importeret fra de faktiske kilder, kun formlen er patchet lokalt
— intet i repoet er ændret).

## Kandidaten der simuleres

`youthRoleFactor`s signatur/sekundaer-TAG ganges med `w / (global maks-positiv-vægt for
DENNE evne på tværs af alle 8 typer)`. Én magnitude-only tabel-ændring: `gc.time_trial: 3 → 2`
(tt forbliver eneste type med time_trial=3, dermed time_trial's stærkeste ejer). Ingen
fortegn ændres nogetsteds — `signatureFactor`/`abilityCap`/`buildCaps` (valuation +
fald-hastighed, se forslag.md) er 100 % urørt i denne simulation, ligesom de ville være ved
en reel implementering af kandidat 1.

## Forkastet undervejs (simulér-før-ship — v1)

Første forsøg normaliserede TAGGET mod typens EGEN højeste positive vægt (`w / maxOwnType`)
i stedet for den globale pr.-evne-ejer. Det brød begge par fuldstændigt (0,3 %/0,3 %
uafgjort — endda bedre end v2 på selve parrene), men straffede EN typs samtlige
signatur-evner blot fordi typen har flere end én positiv vægt:

| type | median egen-score FØR | v1 (afvist) | v2 (anbefalet) |
|---|---|---|---|
| baroudeur | 84,0 | **49,0 (−35)** | 63,9 (−20,1) |
| gc | 84,0 | **56,5 (−27,5)** | 78,9 (−5,1) |
| brostensrytter | 80,0 | **52,1 (−27,9)** | 67,9 (−12,1) |
| sprinter | 84,0 | **56,0 (−28,0)** | 76,1 (−7,9) |
| climber | 80,0 | **57,1 (−22,9)** | 72,4 (−7,6) |
| rouleur | 84,0 | **63,0 (−21,0)** | 84,0 (0,0) |
| tt | 84,0 | 84,0 (0,0) | 84,0 (0,0) |
| puncheur | 84,0 | 60,0 (−24,0) | 84,0 (0,0) |

v1 er forkastet: 6 af 8 typer mistede 22-35 point i median egen-type-score — det er en
reel kollaps-risiko (multi-signatur-typer som baroudeur og gc bliver systematisk svagere end
enkelt-signatur-typer som tt, bare fordi de har flere positive evner). v2 (global
per-evne-ejerskab) løser de to navngivne par UDEN denne bivirkning, fordi den kun
skalerer evner der reelt er DELT med en stærkere ejer — en type der ejer en evne ALENE
(fx brostensrytters cobblestone=6) beholder fuld styrke.

## Før/efter — de to navngivne par (uafgjort = |gap| < 1,0 rating-point)

### Hele pot-5-6-populationen (upartisk baseline, inkl. urelaterede typer/støj)

| par | FØR uafgjort | EFTER uafgjort |
|---|---|---|
| tt/gc | 123/313 (39,3 %) | 35/313 (11,2 %) |
| rouleur/brostensrytter | 20/313 (6,4 %) | 39/313 (12,5 %) |

Bemærk: den samlede "uafgjort %" for rouleur/brostensrytter STIGER (6,4→12,5 %) — det er
IKKE en forværring af selve parret (se næste tabel, den falder til 0 der), men et
sideeffekt af at scorer generelt falder, hvilket skaber flere lav-magnitude tilfældige
tie'er blandt ryttere der hverken er rouleur- eller brostensrytter-type. Den relevante
tabel er den type-specifikke nedenfor.

### Den population der reelt er ramt (den afgørende måling)

| par | filtreret på | FØR uafgjort | EFTER uafgjort |
|---|---|---|---|
| tt/gc | **gc**-primær/sekundær (n=138) | 88 (**63,8 %**) | **0 (0,0 %)** |
| tt/gc | tt-primær/sekundær (n=52, kontrol) | 5 (9,6 %) | 0 (0,0 %) |
| rouleur/brostensrytter | **brostensrytter**-primær/sekundær (n=27) | 20 (**74,1 %**) | **0 (0,0 %)** |
| rouleur/brostensrytter | rouleur-primær/sekundær (n=201, kontrol) | 14 (7,0 %) | 25 (12,4 %) |

**Begge navngivne par er fuldt løst** for den population de faktisk rammer (0,0 % uafgjort,
median gap går fra 0,00 til hhv. 22,09 og 14,58 rating-point — solidt adskilt, ikke bare
lige over tærsklen). Kontrol-siderne forbliver lave (tt-siden falder endda til 0,0 %); den
eneste bemærkelsesværdige bivirkning er rouleur-kontrollen der stiger fra 7,0 % til 12,4 %
— stadig lavt, men værd at holde øje med ved implementering (sandsynlig årsag: `flat`s
globale nedskalering af brostensrytter rammer nogle grænsetilfælde blandt
rouleur-sekundær-ryttere med lav brostens-eksponering).

## Fordelingsskift pr. type (ingen type kollapser)

Median egen-type caps-score (rytterens egen primærtype, evalueret mod egne caps) FØR/EFTER,
pot-5-6, n som i `maaling.md`s type-fordeling:

| type | n | FØR | EFTER | delta |
|---|---|---|---|---|
| tt | 39 | 84,0 | 84,0 | 0,0 |
| puncheur | 22 | 84,0 | 84,0 | 0,0 |
| rouleur | 53 | 84,0 | 84,0 | 0,0 |
| gc | 88 | 84,0 | 78,9 | −5,1 |
| sprinter | 22 | 84,0 | 76,1 | −7,9 |
| climber | 29 | 80,0 | 72,4 | −7,6 |
| brostensrytter | 20 | 80,0 | 67,9 | −12,1 |
| baroudeur | 40 | 84,0 | 63,9 | −20,1 |

Spredning efter ændringen: 63,9–84,0 (26 point). Ingen type falder til nul eller under de
andre typers gulv — laveste (baroudeur) er stadig solidt midt-højt niveau, ikke "ubrugelig".
**Men** baroudeur og brostensrytter tager en reel, mærkbar bid (−20 / −12 point) som
sideeffekt, fordi begge "låner" flere evner der er stærkere ejet af andre typer (baroudeur:
flat fra rouleur, punch fra puncheur, recovery fra gc; brostensrytter: flat fra rouleur,
punch fra puncheur) — dette er IKKE en del af issuets to navngivne par, men en afledt
konsekvens af formlen og bør vises til ejeren eksplicit før ship, evt. som egen
opfølgende kalibrering (fx en mindre tabel-justering af baroudeurs egne vægte, ikke
undersøgt her — uden for dette issues scope).

## Max abs. ændring i loft pr. evne (pot-5-6, hele populationen, buildYouthCaps-niveau)

| evne | max delta | mean delta |
|---|---|---|
| flat | 66 | 16,92 |
| punch | 59 | 20,17 |
| time_trial | 29 | 10,33 |
| recovery | 44 | 7,18 |
| øvrige 11 evner | 0 | 0,00 |

Kun de evner der reelt er DELT mellem to eller flere typer (flat, punch, time_trial,
recovery) rammes — resten af de 15 synlige evner er helt uændrede, hvilket bekræfter at
formlen er kirurgisk (rammer kun de evner der faktisk skaber camouflage), ikke en generel
nedskalering af hele caps-systemet.

## Konklusion

Kandidat 1 (global per-evne-ejerskab + ét magnitude-only tal) løser begge navngivne par
fuldt ud for den ramte population (63,8 %→0,0 %, 74,1 %→0,0 %), rører ikke
`signatureFactor`/`abilityCap`/valuation/fald-hastighed, og efterlader ingen type
kollapset — men koster baroudeur og brostensrytter en mærkbar (om end ikke katastrofal)
nedtoning af lånte sekundær-evner. Klar til ejer-review; IKKE implementeret eller
committet i denne session (analytisk opgave, jf. instruks).
