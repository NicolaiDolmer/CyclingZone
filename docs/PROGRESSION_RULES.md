# Rytterudviklingens regler — SSOT

> **Læs denne FØR enhver opgave der rører rytterudvikling, træning, potentiale, lofter, rating eller ryttertyper.** Ejer-direktiv 25/8 ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)):
> *"Det må ALDRIG NOGENSINDE ske, at du ikke bruger et SSOT-dokument, når vi rent faktisk har lavet et. Der skal nogle hardcore regler på det her."*
>
> Reglerne lå spredt over fem+ design-specs i `docs/superpowers/specs/` med hver sin dato, og der er lavet parallelle planer om det samme. Ejer-direktiv 24/8 ([#4192](https://github.com/NicolaiDolmer/CyclingZone/issues/4192)): *"lav en single source of truth angående træning, find alt vi har lavet og planlagt, stil spørgsmålstegn ved alt."* Denne fil er kilden til REGLERNE. **Kilden til hvad der faktisk er BYGGET er `docs/audits/2026-08-24-4192-traening-beslutningsliste.md`** — 38 beslutninger krydset mod koden og prod. Duplikér den ikke, læs den.
>
> **Præcise vægte, rater, eksponenter og tærskler står IKKE i denne fil** (repoet er offentligt, hard rule 17, [#3436](https://github.com/NicolaiDolmer/CyclingZone/issues/3436)). Hvor et tal hører til, står der "se `<fil>`".

---

## 0. Potentiale styrer FARTEN, ikke længere HØJDEN (den hyppigste fejlkilde)

Indtil trin 7 (PR #3798, merged 20/8) betød `potentiale` (1-6, ét tal pr. rytter) **to ting på én gang**: hvor HØJT en evne kunne ende (loftet, `loftByPotential`) OG hvor HURTIGT den voksede dertil (`rateByPotential`). Trin 7 skilte dem ad.

| | Før trin 7 | Efter trin 7 (nu) |
|---|---|---|
| Loftet (hvor højt) | `loftByPotential` × rolle-faktor | `roleTags` / `ROLE_CLASS_TAG` — **uafhængig af potentiale** |
| Farten (hvor hurtigt) | samme potentiale-tal | `rateByPotential` — potentialets ENESTE rolle nu |

`loftByPotential` findes stadig i koden, markeret eksplicit **"SUPERSEDERET AF roleTags — LÆSES IKKE AF MOTOREN"** (`riderProgression.js`, kommentar ved `YOUTH_PROGRESSION_CONFIG`). Bruger du den i ny kode, bruger du den døde model.

**En rytters HØJDE afhænger i dag af rolleklasse (§1), ikke af potentiale.** Potentiale afgør kun hvor hurtigt rytteren når derhen.

---

## 1. De to knapper: tag (højde) og rate (fart)

Hver (rytter, evne)-kombination hører til én af fem rolleklasser, afgjort af `abilityRoleClass()` i `backend/lib/riderProgression.js`.

| Rolleklasse | Styrer | Konstant (tag = højde) | Konstant (rate = fart) |
|---|---|---|---|
| signatur | rytterens primære type-evner | `ROLE_CLASS_TAG.signatur` | `ROLE_CLASS_RATE.signatur` — **ankeret** til dagens ratingniveau, se §6 |
| sekundær | rytterens sekundære type-evner | `ROLE_CLASS_TAG.sekundaer` | `ROLE_CLASS_RATE.sekundaer` |
| håndværk | KUN `positioning` + `tactics` (`CRAFT_ABILITIES`) | `craftFactor`-løftet tag | `ROLE_CLASS_RATE.haandvaerk` |
| anden rolle | evner uden for rytterens type | `neutralFactor` | `ROLE_CLASS_RATE.andenRolle` |
| svaghed | evner rytterens type er dårlig til | `oppositeFactor` | `ROLE_CLASS_RATE.svaghed` |

Låst 14/8 (spec `2026-08-14-3659-rytterudvikling-og-traening-design.md`, beslutning 14). Rolleklassens tag afgøres af `WEIGHTS_BY_TYPE`, ikke af klassens navn — en sprinter med positioning som "reelt" håndværk kan alligevel ende i `haandvaerk` hvis håndværks-taget ligger over hans egen sekundær-klasses tag (gulv-løft, aldrig sænkning; se kommentar ved `abilityRoleClass`).

> ⚠ **Status er 🟡, ikke ✅.** Trin 4's rolle-tag blev leveret 14/8 og RULLET TILBAGE 15/8 (PR #3791), fordi 748 ryttere brød loftet. Nuværende `ROLE_CLASS_TAG` er en genopbygning via #3709/#3798, og er ikke genmålt mod de oprindelige success-kriterier siden. Se audit-filen §C1, §C6.

---

## 2. Ryttertyper (8 arketyper)

`RIDER_TYPE_KEYS` i `backend/lib/riderTypes.js`: climber, rouleur, sprinter, puncheur, baroudeur, brosten, gc, tt. Låst i spec `2026-08-06-ryttertype-fundament-v2-design.md` (6/8), mål-fordelingen er afledt af kalenderens efterspørgselsprofil (§3295), ikke en fast kvote.

| Regel | Hvad den betyder | Fil |
|---|---|---|
| Typen skal OPDAGES, ikke pålægges | klassifikatoren skal selv finde typen fra de trukne evner (arketype-prior styrer generatoren, ikke facit) | `riderTypes.js` |
| `GUARDS.highSpeciality` | tærskel for hvornår en rytter IKKE er hjælperytter (rouleur-guard) — GC-guarden blev slettet #3570 fase 2 | `riderTypes.js` |
| To ryttere af samme type skal kunne blive forskellige | ❌ ikke bygget — `archetype_draw` har kun `{primary, secondary}`, ingen pr.-evne-hældning | audit §B10 |
| Medfødt hældning + spillerfokus | ❌ kun fokus-siden bygget | audit §B11 |

---

## 3. Potentialets skala og overskuddet

Ejer-beslutning 13/8, "tredje vej": potentiale forbliver **1-6 internt**, UI viser potentiel RATING i evnernes point-skala. Den oprindelige plan om at migrere potentiale til 1-99 i DB (spec `2026-08-09-3564-progressionskaede-samlet-design.md`, beslutning 1) blev droppet af ejeren og er **overhalet** — spec'en er ikke rettet.

| Regel | Konstant | Fil | Status |
|---|---|---|---|
| Potentiale → farts-multiplikator | `rateByPotential` (lineær interpolation via `youthRateForPotential`) | `riderProgression.js` | ✅ |
| Potentiale-overskuddet i bestanden udlignes | (udligningsplan hang på migrationen) | — | ⛔ bortfaldt, overskuddet består i prod |
| Potentiale-leddet fjernes fra PUBLICERET værdi for unge uden handelsevidens | #2798 | — | ❌ åben `needs-decision` |

---

## 4. Loft-aftrapning med alder (peak og decline)

| Regel | Konstant | Fil |
|---|---|---|
| Absolut loft aftrappes efter `peakAge` | `taperedAbsoluteCap`, `CAP_TAPER_CONFIG` | `riderProgression.js` |
| Peak-alder pr. type | `PROGRESSION_CONFIG.peakAge`, `peakAgeForType` | `riderProgression.js` |
| Uden alder angivet → uændret loft (sikker default) | `taperedAbsoluteCap(cap, age=null)` returnerer `cap` | `riderProgression.js` |

> ⚠ **Kendt hul (spec 14/8, hul nr. 4, stadig åbent):** arvede ryttere over deres FORMEL-loft rammes ikke af aftrapningen. Se audit §C6.

---

## 5. Løbsdags-motoren: træning og løb på samme dag

| Regel | Konstant | Fil | Status |
|---|---|---|---|
| Løb udvikler mere end det pas det erstatter, kun i løbets relevante evner | `RACE_DEV_CONFIG.devMult` | `backend/lib/dailyTraining.js` | ✅ |
| Løbsprofil → hvilke evner der udvikles | `RACE_PROFILE_ABILITY_MAP` | `dailyTrainingEngine.js` | ✅ |
| Restitution + AI-paritet (D3+D4) er styret af feature-flag | `race_day_engine_enabled` i `app_config` | — | ✅ on siden 7/8 |
| Løbsdags-UDVIKLINGEN (D1+D2) er styret af sit EGET flag | `race_day_development_enabled` i `app_config` | `backend/lib/raceDayDevelopmentFlag.js` | ⛔ off for S3 (#4277), tilbage til S4 |
| Restitution justeres når `race_day_engine_enabled` er on | `RACE_DAY_ENGINE_RECOVERY_CONFIG` | `backend/lib/riderCondition.js` | ✅ |
| Trænings-UI'ets løbsdags-badge følger UDVIKLINGS-flaget, ikke motor-flaget | `racingToday` i `GET /api/training/me` | `backend/routes/api.js` | ✅ rettet i #4375 |
| `rest`-intensitet giver ingen udvikling | `abilityMult(ability, {intensity:"rest"})` → 0 | `dailyTraining.js` | ✅ |

> ⚠ **Kendt afvigelse fra spec (A4, ikke rettet endnu).** Spec 6/8 siger det planlagte pas ikke udføres på en løbsdag. Koden bruger i stedet det planlagte pas × `devMult` som løbets udbytte (`applyRaceDevelopmentTick`) — planen ER stadig input. Konsekvens: en rytter sat til Hvile eller Aktiv restitution som alligevel tilmeldes et løb får NUL udvikling af at køre, og disse to indstillinger har de højeste løbsandele af alle. Ejerens dom 24/8, ordret: *"Hvis man kører løb eller træner, så kan man ikke begge dele."* Hvad der SKAL bestemme udbyttet i stedet er en åben beslutning — se audit-fil, afsnit "Det vigtigste at kigge på" nr. 1.

---

## 6. Rating og scouting

| Regel | Fil | Status |
|---|---|---|
| Rating har historisk kørt to skalaer samtidig (ukalibreret og kalibreret) på forskellige flader | `weights/displayRecipes.js`, `scoutingReport.js` | se spec `2026-08-13-rating-fundament-v3-design.md` §1.1 — verificér nuværende status i koden før du regner med den er løst |
| Signatur-raten (§1) er ANKERET til dagens ratingniveau, ikke til spidsen | `ROLE_CLASS_RATE.signatur`, kommentar i `riderProgression.js` | ✅ ejer-ramme 15/8 (audit §C17): alle ender lidt lavere i snit, men agens-spændet (det manageren kan påvirke) vokser |
| Scouting-bånd maskeres FØR bias/halvbredde lægges på (rækkefølgen må ikke byttes) | `scoutingReport.js`, `scoutingInversionHarness.js` | ✅ |
| Trænings-scorens dagsstøj skal hæves mod en privatlivs-gate (median ≥ X dage før potentiale kan aflæses) | `noiseSpan` i `dailyTraining.js` | ❌ gaten findes ikke |
| Scouting afslører kun RETNINGEN, aldrig niveauet | — | ❌ ikke bygget, afhænger af trænings-scorens privatliv ovenfor |

---

## 7. Specialiserings-gabet mellem bedste og næstbedste evne

Ejeren har et mål for hvor stort gabet mellem en rytters bedste og næstbedste evne bør være ved 28 år, og fravalgte eksplicit et højere niveau fordi det gør ryttere skrøbelige og straffer små trupper (kolliderer med [[project_no_punishment_for_strength]]). **Målt i prod 24/8 er gabet et flercifret multiplum af målet** fra midt-20'erne og op — se audit-filens §B13 for de faktiske tal. Verifikations-kravet fra 11/8 (kør harnesset mod ægte population + race-motoren FØR konstanterne låses) er aldrig indfriet.

> ⚠ **Forbehold fra spec'en selv:** de 28-33-årige i prod voksede ikke op under nuværende rater — de er i vid udstrækning seedet ved lancering (stock, ikke flow). Tallene beviser derfor ikke at dagens motor PRODUCERER det gab, kun at det er hvad spilleren ser i dag.

---

## 8. Hvad der håndhæver hvad

| Niveau | Hvad det fanger | Hvor |
|---|---|---|
| **Unit-tests (required CI-check `backend-tests`)** | regressioner i selve funktionerne (rate/tag-opslag, evne-registrets konsistens) | `riderProgression.test.js`, `dailyTrainingEngine.test.js`, `abilityRegistryGuards.test.js`, `scoutingReport.test.js` |
| **Engangs-harness (kørt manuelt, IKKE i CI)** | sim-scorecard før ship af én ændring | `rytterudviklingScorecard.js`, `curveHarness3564.mjs`, `measureBestType3372.js` + søskende, `scoutingInversionHarness.js` |
| **Spillervendte gates (kørt manuelt, IKKE i CI)** | de tal SPILLEREN faktisk ser (tag-fordeling, spring pr. dag, fart-forløb) mod ejerens egne grænser fra 15/8 | `backend/scripts/spillervendteGates3709.mjs` |
| **Tilbagevendende måling mod prod** | intet i dag | — |

Det sidste niveau er nøjagtig det hul kalenderen havde før [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176). `spillervendteGates3709.mjs` blev bygget netop fordi et fund uden gate ikke stopper noget — gates-rapporten 14/8 MÅLTE at 751 ryttere fik en evne over den lovede tærskel, men skrev det som "nyt fund" ved siden af fem grønne gates i stedet for at være en sjette gate der fejlede. Ingen af de tre kildespecs' succeskriterier (G1-G6, portene pr. trin, S1-S5) kører tilbagevendende mod prod i dag. Der er intet natligt workflow der måler progression/træning, i modsætning til kalenderens `.github/workflows/calendar-invariant-audit.yml`.

---

## 9. Kendte åbne modsigelser

| # | Modsigelse | Kilde |
|---|---|---|
| 1 | Spec 9/8's trin 1 (potentiale migreres 1-99) er overhalet af "tredje vej" (13/8), men spec'en er ikke rettet | audit §B1, §B2, §B7 |
| 2 | Rolle-taget blev leveret 14/8, rullet tilbage 15/8, genopbygget via #3709/#3798 — ikke genmålt mod de oprindelige kriterier | audit §C1, §B4 |
| 3 | Planen er stadig input på en løbsdag, selvom spec 6/8 og ejerens dom 24/8 siger den ikke skal være det (A4) | denne fil §5, audit "Det vigtigste at kigge på" nr. 1 |
| 4 | Specialiserings-gabet er langt over det ejeren eksplicit fravalgte, verifikationskravet er aldrig indfriet | denne fil §7, audit §B13 |
| 5 | "8 type-loftprofiler" (spec 9/8) findes ikke — der er én fælles rolleklasse-tabel for alle 8 typer | audit §B4 |
| 6 | Toprytterens form ("mesterlig i primæren, jævn i resten") er princip, ikke kalibreret profil pr. type | audit §B9 |
| 7 | Ingen af de tre kildespecs' succeskriterier er en tilbagevendende gate | denne fil §8, audit "Det vigtigste at kigge på" nr. 5 |
| 8 | Staff- og facilitets-stien (spec 14/8's eget hul nr. 7) er stadig åben, ikke undersøgt i denne fil | audit, sidste linje |

---

## 10. Kildedokumenter

**Primær status-kilde (byg intet uden at læse den først):** `docs/audits/2026-08-24-4192-traening-beslutningsliste.md` — 38 beslutninger, hver med bygget-status verificeret mod kode og prod 24/8.

**Design-specs (hensigt, ikke facit — kryds altid mod audit-filen og koden):**
- `docs/superpowers/specs/2026-08-06-loebsdags-model-design.md` (Løbsdags-modellen)
- `docs/superpowers/specs/2026-08-09-3564-progressionskaede-samlet-design.md` (Progressionskæden)
- `docs/superpowers/specs/2026-08-13-rating-fundament-v3-design.md` (Rating-fundamentet)
- `docs/superpowers/specs/2026-08-14-3659-rytterudvikling-og-traening-design.md` (Rytterudvikling og træning)
- `docs/superpowers/specs/2026-08-06-ryttertype-fundament-v2-design.md` (Ryttertype-fundamentet)
- `docs/superpowers/specs/2026-07-16-traening-ungdom-verdensklasse-addendum-design.md` (Ungdoms-addendum)

**Kode (verificér altid mod denne, aldrig mod en spec alene):**
`backend/lib/riderProgression.js` · `backend/lib/dailyTraining.js` · `backend/lib/dailyTrainingEngine.js` · `backend/lib/riderCondition.js` · `backend/lib/riderTypes.js` · `backend/lib/scoutingReport.js` · `backend/lib/abilityRegistry.js` · `backend/lib/weights/displayRecipes.js` · `backend/scripts/spillervendteGates3709.mjs`
