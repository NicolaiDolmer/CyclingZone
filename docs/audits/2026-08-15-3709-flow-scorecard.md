# Flow-scorecard — #3709 trin 4 + 5

Kuld: 1200 ryttere genereret gennem produktionens EGEN intake-sti
(`generateAcademyCandidates` → `seedPhysiologyFromLegacy` → `deriveAbilities`),
simuleret dag for dag fra 16 til 30 aar gennem `applyDailyTick`. Seed 2026.
Start ved 16 aar: rating-median 7, bedste evne 18.

**Harnessen har ingen egen vaekstformel.** Den kalder produktionens `applyDailyTick`
direkte med de parametre `dailyTrainingEngine.js` sender. "Bit-identisk" er derfor
en egenskab ved konstruktionen, ikke noget der skal bevises.

## Rating ved 30 aar (median, `ratingFromAbilities`)

| Model | spids | rotation | standard | forkert | spaend |
|---|---:|---:|---:|---:|---:|
| i dag | 29 | 29 | 29 | 28 | **1** |
| kandidat | 27 | 28 | 28 | 20 | **7** |
| kandidat + akademiets 1/3 | 21 | 21 | 22 | 15 | **6** |
| negativ-test (offFocusMult 0,97) | 35 | 35 | 35 | 33 | **2** |

## Bedste evne ved 30 aar (median)

| Model | spids | rotation | standard | forkert |
|---|---:|---:|---:|---:|
| i dag | 38 | 35 | 36 | 33 |
| kandidat | 45 | 35 | 43 | 26 |
| kandidat + akademiets 1/3 | 35 | 27 | 32 | 21 |
| negativ-test (offFocusMult 0,97) | 46 | 42 | 43 | 39 |

## Andel af taget naaet (median) — beslutning 6

| Model | spids | rotation | standard | forkert |
|---|---:|---:|---:|---:|
| i dag | 0.97 | 1 | 0.97 | 0.96 |
| kandidat | 0.45 | 0.55 | 0.44 | 0.45 |
| kandidat + akademiets 1/3 | 0.34 | 0.4 | 0.32 | 0.32 |
| negativ-test (offFocusMult 0,97) | 0.73 | 0.75 | 0.72 | 0.72 |

## Evnesum ved 30 aar (median)

| Model | spids | rotation | standard | forkert |
|---|---:|---:|---:|---:|
| i dag | 309 | 310 | 305 | 299 |
| kandidat | 264 | 276 | 250 | 218 |
| kandidat + akademiets 1/3 | 208 | 211 | 196 | 165 |
| negativ-test (offFocusMult 0,97) | 351 | 353 | 344 | 335 |

## Markedsvaerdi ved 30 aar (hul 6) — `predictBaseValue` paa de simulerede evner

Trin 4 flytter INGEN markedsvaerdier ved deploy: modellen laeser `abilities`, og de er
urortt. Tabellen her er den LANGE effekt — hvor evnerne lander efter en hel karriere.

| Model | spids | rotation | standard | forkert |
|---|---:|---:|---:|---:|
| i dag | 27096 | 27096 | 25595 | 23272 |
| kandidat | 22193 | 22338 | 24355 | 9447 |
| kandidat + akademiets 1/3 | 10940 | 10586 | 12348 | 5316 |
| negativ-test (offFocusMult 0,97) | 51845 | 50001 | 46359 | 40062 |

**Delta ved bedste spil: -18.1 %** (median, 27096 → 22193).
**Delta ved standard-spil: -4.8 %** (median, 25595 → 24355) — det er tallet oekonomien reelt vil se.

## ⚠ Mål med REKONSTRUEREDE definitioner

Specen opgiver tal for de to nedenfor, men ikke formlerne — trin 0's harness blev
aldrig committet. Definitionerne her er MINE. **Retningen** kan sammenlignes med
specen; de **absolutte tal** kan ikke.

- *Arketype-skarphed*: rytterens rating i SIN EGEN rolle / hans bedste rating i nogen rolle.
- *Feltets forskellighed*: gennemsnitlig parvis cosinus-afstand mellem normaliserede evne-vektorer.

| Model | skarphed spids | skarphed rotation | skarphed forkert | skarphed-spaend | forskellighed (bedste) |
|---|---:|---:|---:|---:|---:|
| i dag | 0.99 | 0.99 | 0.99 | **0.00** | 0.12 |
| kandidat | 0.93 | 0.97 | 0.97 | **-0.04** | 0.26 |
| kandidat + akademiets 1/3 | 0.91 | 0.97 | 0.93 | **-0.02** | 0.27 |
| negativ-test (offFocusMult 0,97) | 0.98 | 0.98 | 0.98 | **0.00** | 0.17 |

## Gates

| # | Gate | Resultat |
|---|---|---|
| G1 | agens-spaend paa rating stiger markant | ✅ i dag 1 → kandidat 7 |
| G2 | ankeret holder: bedste strategi >= dagens bedste rating | ❌ i dag 29 → kandidat 27 |
| G3 | ryttere naar IKKE deres lofter (beslutning 6) | ✅ i dag 0.97 → kandidat 0.45 |
| G4 | NEGATIV-TEST: kun offFocusMult uaendret SKAL give markant mindre agens | ✅ kandidat 7 → negativ-test 2 |
| G5 | ATTRIBUTION: akademiets 1/3 beholdt SKAL koste rating (trin 5 er baerende) | ✅ kandidat 27 → med 1/3 21 |

❌ 1 gate(s) fejlede — intet maa muteres.
