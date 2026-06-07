# Rider Ability System v2 — redesign af evner + ryttertyper (#1101-kæden)

> **Status: DESIGN-FORSLAG til review.** Besluttet i fællesskab 2026-06-07 (Nicolai + Claude Code).
> Evne-beregnings-formlerne (physiology → evne) er Claudes forslag og **rettes i en senere session**.
> Implementeres IKKE før Nicolai har godkendt dette dokument.
>
> Afløser ability-model v1 (`backend/lib/abilityDerivation.js`, `FORMULA_VERSION=1`) og
> ryttertype-fase-1 (`backend/lib/riderTypes.js`, legacy-stat z-score). Forudsætning for
> at #1101-værdisystemet bliver realistisk.

## 1. Problem (verificeret mod prod 2026-06-07, 8.994 ryttere)

Tre rod-årsager til at evnerne er "ramt dårligt og urealistisk":

1. **Manglende specialisering** — fysisk stærke ryttere er høje i *alt*. Mads Pedersen
   (classics/sprinter) har climbing 87; de bedste rigtige ryttere ligger 85-99 på tværs af
   næsten alle evner. Årsag: mange evner deler samme physiology-driver (`ftp_wkg` driver
   både climbing og tt; `pmax` driver både sprint og acceleration), så ét stærkt motor-tal
   løfter alle evner samtidig. Der findes ingen trade-off-mekanik.
2. **Mætning i toppen** — for mange rammer 96-99; climbing-toppen er fem ryttere på 99.
   Percentil-skaleringen differentierer ikke eliten.
3. **Døde evner + forkerte typer** — `tactics`/`positioning` har sd=5 (alle ~62, ubrugelige).
   Typerne (legacy z-score) er nonsens: tidskørere har ikke høj tt, sprintere klassificeres
   som leadout, "goat" er svagest. Bekræfter at typer skal udledes fra (rettede) evner.

## 2. Låste beslutninger

- **Type-score = vægtet gennemsnit:** Σ(evne × vægt) / Σ(vægt). Alle typer på samme 0-99-skala,
  rangerbare direkte mod hinanden.
- **Typer udledes fra de nye EVNER**, ikke legacy stats.
- **Goat** og **domestique** udgår som typer.
- **Brosten ≠ klassiker:** `cobblestone` er en selvstændig evne; typen hedder **brostensrytter**
  (ingen "classics"-kobling i hverken evne- eller type-navn).
- **Specialisering er målet:** en ren specialist skal være tydeligt svag i de modsatte discipliner.
- **Kalibrering: top-tung** — kun de reelt bedste i deres *speciale* rammer 90+.
- **Lagring:** primær type i `primary_type`, sekundær i `secondary_type`. ALDRIG i status-/badge-kolonnen
  (nuværende frontend-fejl der skal rettes).
- **Evne-systemet skal være udvideligt** — flere evner + skjulte evner kommer senere. Kategorier:
  fysiske / tekniske / taktisk-mentale / skjulte.

## 3. Evne-liste (16 synlige + 2 skjulte)

| Kategori | Evne | Kilde (legacy) | Foreslået physiology-formel (RETTES SENERE) |
|---|---|---|---|
| Fysisk | `climbing` | Bj | 0.50 ftp_wkg + 0.20 power_5m_wkg + 0.15 fatigue_resistance + 0.15 lightness |
| | `time_trial` | Tt | 0.35 ftp_watts + 0.30 ftp_wkg + 0.20 tte_ftp + 0.15 aero |
| | `prolog` ⭐ | Prl | 0.40 power_5m_wkg + 0.30 ftp_watts + 0.20 power_1m_wkg + 0.10 aero |
| | `flat` ↻ | Fl | 0.45 ftp_watts + 0.25 pmax_watts + 0.20 aero + 0.10 zone2_power_wkg |
| | `tempo` ⭐ | Kb | 0.45 ftp_wkg + 0.30 power_5m_wkg + 0.15 tte_ftp + 0.10 fatigue_resistance |
| | `sprint` | Sp | 0.35 pmax_watts + 0.25 power_5s_wkg + 0.20 power_15s_wkg + 0.10 positioning + 0.10 recovery_rate |
| | `acceleration` | Acc | 0.60 pmax_watts + 0.40 power_5s_wkg |
| | `punch` | Bk | 0.35 power_1m_wkg + 0.25 power_5m_wkg + 0.20 high_intensity_energy + 0.20 recovery_rate |
| | `endurance` | Udh | 0.35 zone2_power_wkg + 0.30 tte_ftp + 0.25 fatigue_resistance + 0.10 recovery_rate |
| | `recovery` | Res | 0.60 recovery_rate + 0.40 fatigue_resistance |
| | `durability` ⭐ | Mod | 0.45 fatigue_resistance + 0.30 tte_ftp + 0.25 high_intensity_energy |
| Teknisk | `descending` ⭐ | Ned | 0.70 norm(stat_ned) + 0.30 norm(stat_bro) |
| | `cobblestone` ↻ | Bro | 0.25 ftp_watts + 0.20 power_1m_wkg + 0.20 fatigue_resistance + 0.20 norm(stat_bro) + 0.15 weight_stability |
| | `positioning` ↻ | Fl + Ned | 0.50 norm(stat_fl) + 0.30 norm(stat_ned) + 0.20 norm(stat_ftr) |
| Taktisk/mental | `aggression` ⭐ | Ftr | 0.80 norm(stat_ftr) + 0.20 (eksplosivitet/ungdom) |
| | `tactics` ↻ | (afledt) | ÅBEN — fx erfaring(alder) + aggression. Mod bruges IKKE her (nu durability) |
| Skjult | `potentiale` | findes | eksisterende kolonne, skjult |
| | `hidden_potential` ⭐ | — | afledt af potentiale + ung alder + seeded støj |

**Definitioner af de nye evner (Nicolais ord):**
- `durability` (Mod): ydelse sent i et hårdt løb — hvor længe kan du bruge din VO2max efter 200 km
  og mange dybe angreb.
- `tempo` (Kb): din effort i mellemlange perioder, fx hvor hurtigt du kan køre i 15-25 minutter.
- `descending` (Ned): teknik/nedkørsel + bike-handling.
- `aggression` (Ftr): angrebsiver — må også påvirke `tactics`.
- `prolog` (Prl): kort/eksplosiv enkeltstart, adskilt fra lang `time_trial`.

## 4. Ryttertyper (10) — vægtet gennemsnit af evner

| Type | Formel (÷ vægt-sum) |
|---|---|
| rouleur | (flat×2 + endurance) / 3 |
| tt | (time_trial×3 + prolog×2) / 5 |
| climber | (climbing×3 + tempo×2 + punch + endurance) / 7 |
| puncheur | (punch×3 + tempo×2 + flat×2 + durability×2 + climbing + endurance) / 11 |
| baroudeur | (aggression×3 + flat×2 + punch + endurance + recovery + durability + sprint + descending) / 11 |
| brostensrytter | (cobblestone×3 + flat×2 + endurance×2 + punch) / 8 |
| sprinter | (acceleration×3 + sprint×2 + flat + durability) / 7 |
| gc | (climbing×3 + recovery×3 + time_trial×2 + tempo×2 + durability + endurance + flat + prolog + punch) / 15 |
| leadout | (flat + sprint×3 + acceleration×2 + durability) / 7 |
| allrounder | (flat + time_trial + endurance×2 + punch + tempo) / 6 |

Primær = højeste type-score; sekundær = næsthøjeste. Deterministisk tie-break (stabil rækkefølge).

## 5. Specialiserings-mekanik (ÅBEN — vælges næste session)

Problemet i §1.1 løses ikke af top-tung kalibrering alene. To kandidater:

- **(A) Arketype-styret physiology-seeding** for de fiktive ryttere (relaunch-population, #669/#677):
  generér physiology *skævt* efter rytterens tiltænkte arketype (en sprinter får høj pmax, lav
  ftp_wkg). Specialisering bliver indbygget fra fødslen. Ren løsning — men virker kun på fiktive,
  ikke på de importerede PCM-ryttere.
- **(B) Specialiserings-kontrast i evne-beregningen:** efter rå evne, forstærk afstanden fra
  rytterens egen evne-median (spidskompetencer op, svagheder ned). Virker på alle ryttere, men
  skal kalibreres så absolut niveau ikke ødelægges.

Da relaunch går til fiktiv population, er (A) sandsynligvis primærvejen; (B) som supplement.

## 6. Kalibrering (top-tung)

- Behold percentil-skalering, men læg en kurve på toppen så 90+ bliver sjældent (kun ~top 2% i
  speciale). Konkrete anker-tal (elite vs. kontinental) gives af Nicolai næste session.
- Kombineret med specialisering: selv eliten er svag i sine ikke-specialer.

## 7. Kobling til #1101-værdi

`base_value` = model på (evner) + **rider_type** + **forventet-point-heuristik** som nye features.
Forventet point afledes som heuristik fra type + evne-niveau (lookup), uden fuld race-simulering
(besluttet: "heuristik nu"). Kan senere erstattes af simulerede point fra race-motoren (#1102).

## 8. Åbne punkter til næste session

1. Ret evne-beregnings-formlerne i §3 (Nicolais review).
2. Vælg specialiserings-mekanik (A / B / begge), §5.
3. `tactics`-driver uden Mod, §3.
4. `hidden_potential`-formel + endelig liste over hvilke evner der er skjulte.
5. Arketype-skæv physiology-seeding til fiktiv population (#669/#677).
6. Konkrete kalibrerings-ankre (elite = X, kontinental = Y).

## 9. Implementerings-rækkefølge (efter godkendelse)

1. Migration: udvid `rider_derived_abilities` med nye evne-kolonner (prolog, flat, tempo, durability,
   descending, cobblestone, positioning, aggression, tactics, hidden_potential).
2. Omskriv `abilityDerivation.js` (nye evner + specialisering + top-tung kalibrering), bump `FORMULA_VERSION`.
3. Re-derive abilities for hele pool + verificér fordelinger (sanity-checks).
4. Omskriv `riderTypes.js` → udled fra abilities (vægtet gennemsnit), fjern goat/domestique, brostensrytter.
5. Re-backfill `primary_type`/`secondary_type`.
6. Frontend: vis typer i egne kolonner (ikke status/badge-kolonnen).
7. `riderValuation.js` (#1101): tilføj rider_type + forventet-point-heuristik, re-fit modellen.
8. Senere: færdiggør de 25 fiktive rytteres evner (#669/#677).
