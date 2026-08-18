# #3592 — Designkandidater (KUN caps-formning; classifierWeights + signatureFactor's
# fortegns-kontrakt for valuation/decline er FROSSET)

## Kritisk fund FØR kandidaterne: `signatureFactor`/`abilityCap` er IKKE kun caps

Grep af alle call-sites (`buildCapsForRider(`, `signatureFactor(`, `buildYouthCaps(`,
`youthRoleFactor(`, `abilityRoleClass(`, `roleRateFactor(`, `abilityCap(`, `buildCaps(` i
`backend/lib/*.js`, ekskl. tests/scripts):

| funktion | LIVE runtime-forbrugere | betyder for scope |
|---|---|---|
| `buildCapsForRider` → `buildYouthCaps` → `youthRoleFactor`/`abilityRoleClass` (TAG) | `backend/lib/riderProgressionEngine.js:181` (sæson-transition), `backend/lib/dailyTrainingEngine.js:313` (daglig caps-refresh), `backend/lib/backfillCores.js:319` (init), `backend/lib/starterSquadAllocator.js:249` (nyt hold/rytter) | **DETTE er "caps-formningen"** — den moderne, alders-uafhængige sti. Trygt at ændre. |
| `roleRateFactor` (RATEN, samme `abilityRoleClass`-klasse) | `backend/lib/dailyTraining.js:132` (træningsfokus-multiplikator) | Rører kun hvis KLASSE-grænserne (fortegn) ændres — ikke hvis kun TAGGET inden for en klasse graderes. |
| `signatureFactor` (fortegns-test alene) | `backend/lib/riderCareerNpv.js:67` (`expectedNextAbilities`, del af **VALUERINGS-model v4, LIVE base_value**), `backend/lib/riderProgression.js:399` (`developRiderSeason`'s `isSig` → **fald-hastighed** for ALLE ryttere, ikke kun unge) | **UDENFOR SCOPE.** Ændres dennes formel, flytter det markedsværdi OG fald-hastighed — præcis det #3592/brugeren siger må IKKE røres. |
| `abilityCap`/`buildCaps` (den ÆLDRE "voksen"-formel, bruger `signatureFactor` direkte) | `backend/lib/riderCareerNpv.js:68,107` (**primær caps-builder i valuation V4**), `backend/lib/riderProgression.js:400` (`developRiderSeason`-fallback) | **UDENFOR SCOPE** — dette ER valuation i dag, ikke "caps-formning" i brugerens forstand. `buildCapsForRider` (den nye, alle-aldre-sti) kalder IKKE denne. |
| `abilityRoleClass` (KLASSE, ikke tag) | `backend/lib/training.js:268` (`focusTrainability` — UI "styrke/begrænset/blokeret"-labels) | Uændret hvis kun TAGGET (magnitude) inden for `signatur`/`sekundaer` graderes — klasse-grænsen (fortegn) er urørt. |
| `legacyPrimaryTypeTier` (egen frossen kopi, bruger `signatureFactor`) | `backend/lib/training.js:294` → `smartDefaultFocus` (**live valg af standard-træningsfokus for utrænede ryttere**) | Bevidst frosset af egen kommentar (#3195) — rører `signatureFactor` slet ikke hvis den er urørt. |

**Konsekvens for design:** enhver kandidat der ændrer `signatureFactor`s formel eller
`abilityCap`/`buildCaps` rammer valuation (`riderCareerNpv.js`) og fald-hastighed
(`developRiderSeason`). Det er en hård grænse. De kandidater der overholder den, må KUN
røre `youthRoleFactor`/`abilityRoleClass`'s TAG-beregning (den funktion der reelt fodrer
`buildYouthCaps` → `buildCapsForRider`), og skal lade klasse-grænsen (fortegns-testen,
altså `roleRateFactor`s RATE og `training.js`s labels) være urørt.

---

## Kandidat 1 (ANBEFALET) — global per-evne-ejerskab, magnitude-gradueret TAG

**Hvad ændres:** én ny, caps-only funktion i `riderProgression.js`, brugt KUN inde i
`youthRoleFactor` (ikke i `signatureFactor`, ikke i `abilityCap`):

```js
// NY — global maks-positiv-vægt PR. EVNE på tværs af alle 8 typer i CAPS_SHAPING_WEIGHTS.
function globalMaxPositiveByAbility() {
  const out = {};
  for (const weights of Object.values(WEIGHTS_BY_TYPE)) {
    for (const [ability, w] of Object.entries(weights)) {
      if (w > 0) out[ability] = Math.max(out[ability] || 0, w);
    }
  }
  return out; // kan caches modul-globalt, tabellen er frozen
}

// NY — caps-only. w<=0 => 0 (uændret). w>0 => w / (global maks for DENNE evne).
// En type der EJER en evne ALENE (fx brostensrytters cobblestone=6) beholder 1.0
// uanset andre typers vægte. Kun evner der er DELT med en type der vægter dem
// højere skaleres ned.
function capsSignatureFraction(primaryType, ability) {
  const w = WEIGHTS_BY_TYPE[primaryType]?.[ability];
  if (w == null || w <= 0) return 0;
  const gmax = GLOBAL_MAX_POSITIVE_BY_ABILITY[ability] || 0;
  return gmax > 0 ? w / gmax : 0;
}

// youthRoleFactor — PATCHED: kun signatur/sekundaer-TAGGET ganges med fraction.
// haandvaerk/svaghed/andenRolle uændret. abilityRoleClass (klassen) er 100% urørt.
export function youthRoleFactor(primaryType, secondaryType, ability, cfg = YOUTH_PROGRESSION_CONFIG) {
  const klasse = abilityRoleClass(primaryType, secondaryType, ability, cfg);
  const baseTag = tagForClass(klasse, cfg);
  if (klasse === "signatur") return baseTag * capsSignatureFraction(primaryType, ability);
  if (klasse === "sekundaer") return baseTag * capsSignatureFraction(secondaryType, ability);
  return baseTag;
}
```

Plus ÉN magnitude-only tal-ændring i `capsShapingWeights.js` (intet fortegn skifter):

```
gc: time_trial 3 → 2   // eneste ændring — tt forbliver time_trial's stærkeste ejer
```

(rouleur/brostensrytter-parret kræver INGEN tabel-ændring — formlen alene løser det,
fordi rouleur allerede ejer `flat` stærkest (4 mod brostens' 2), se scorecard.md.)

**Hvorfor dette er sikkert ift. grænsen ovenfor:** `signatureFactor` (sign-only) og
`abilityCap`/`buildCaps` rører jeg IKKE — de forbliver bit-identiske funktioner. Kun
`youthRoleFactor`s interne udregning ændres, og den fodrer udelukkende
`buildYouthCaps`/`buildCapsForRider`. `abilityRoleClass` (klassen/fortegnet) er også urørt,
så `roleRateFactor` (RATEN) og `training.js`s labels/`smartDefaultFocus` er bit-identiske.

**Forventet effekt (målt, se scorecard.md):** gc-siden går fra 63,8 % → 0,0 % uafgjort mod
tt; brostensrytter-siden fra 74,1 % → 0,0 % mod rouleur. Bivirkning: andre typers EGEN
caps-score falder moderat, fordi de "låner" evner der ejes stærkere af andre typer
(baroudeur −20 point i median egen-score, brostensrytter −12, climber/sprinter/gc −5 til −8;
tt/puncheur/rouleur upåvirket = 0 delta). Ingen type kollapser (laveste median efter
ændringen er 63,9, højeste 84 — se scorecard.md for fuld tabel).

**Simuleres via:** `scorecard.mjs` i denne mappe (kører allerede, se scorecard.md).

**Test-payload der skal opdateres ved implementering (ikke gjort her):**
`riderProgression.test.js` linje 291-357 (`youthRoleFactor`-assertions, forventer i dag
fladt 1,0/0,82/0,45/0,12 uanset magnitude) og `archetypeGenerationGates.test.js` (bruger
`buildYouthCaps` i dens forventede facit).

---

## Kandidat 2 — tabel-medlemsskabs-rettelse (SAMME teknik som displayRecipes.js's fix)

**Hvad ændres:** tilføj en ny positiv evne til `tt` (eller fjern en delt evne fra `gc`'s
positive sæt), præcis som `displayRecipes.js` løste `climber ⊆ gc` ved at tilføje `punch: 1`
til climber (se dens kommentar 13/8, "vagt 3"). Fx:

```
tt: { time_trial: 3, durability: 1, climbing: -2, sprint: -1, punch: -1 }  // + durability
```

**Forventet effekt:** bryder delmængden strukturelt (samme metode som beviseligt virkede for
`climber/gc` i displayRecipes) — burde give lignende 0 %-resultater som kandidat 1.

**Risiko — DETTE ER DEN AFGØRENDE FORSKEL TIL KANDIDAT 1:** `durability` bliver POSITIV for
`tt` for FØRSTE gang → `signatureFactor("tt", "durability")` skifter fra 0 til 1,0. Det
propagerer DIREKTE til:
- `riderCareerNpv.js:67` (`isSig` i valuation v4's `expectedNextAbilities`) → **ændrer
  forventet fremtidig durability-vækst for alle tt-ryttere i NPV-modellen → flytter
  markedsværdi.**
- `developRiderSeason` (`riderProgression.js:399`) → **ændrer fald-hastigheden** for
  durability hos ALLE tt-ryttere (ikke kun unge) efter peak-alder.
- `abilityCap`/`buildCaps` (`riderCareerNpv.js:107`) → samme durability-loft-ændring i
  valuerings-modellens egen caps-builder.

Denne kandidat overtræder derfor eksplicit brugerens grænse ("kun caps-formningen må
ændres" / classifierWeights-parallellen for valuation). Den kræver en SEPARAT
ejer-beslutning der accepterer at røre valuation+fald-hastighed samtidig — IKKE anbefalet
til dette issue uden det tilvalg.

---

## Kandidat 3 — rangering i stedet for absolut rating (issuets egen kandidat 3, defensiv)

**Hvad ændres:** intet i caps-formningen. Loft-båndene (`buildTypeCeilingBands`) viser
rytterens rangering blandt sine egne 8 type-scores i stedet for det absolutte tal
("bedst egnet: GC, dernæst TT" i stedet for "GC 99, TT 99").

**Forventet effekt:** skjuler symptomet (spilleren kan ikke længere LÆSE de to identiske
99-tal side om side), men **løser intet på caps-niveau** — de 64 %/74 % uafgjorte
gc-/brostensrytter-ryttere er stadig uafgjorte i selve tallene, bare ikke synlige. Scouting-
rapportens `ceilTruth`-beregning (der allerede læser `displayRecipes` — se
`scoutingReport.js:86`) er delvist afhjulpet af #3664/#3666's vagt 3 (ingen
`DISPLAY_RECIPES`-sæt er længere delmængder af hinanden), så den akutte spiller-synlige
symptomatik er faktisk allerede reduceret — men caps-objektet (`ability_caps` i DB, det
akademi/scouting/progression rent faktisk regner videre på) er stadig det uafgjorte,
udelte grundlag.

**Risiko:** lav (ren visning), men efterlader grundproblemet — anbefales KUN som
supplement til kandidat 1, ikke som erstatning, jf. issuets egen ordlyd ("Grundproblemet
er...").

---

## Anbefaling

**Kandidat 1.** Den er den eneste af de tre der (a) faktisk fjerner uafgjortheden PÅ
CAPS-NIVEAU (0,0 % målt, se scorecard.md), (b) er formelt bevist isoleret fra valuation
(`riderCareerNpv.js`) og fald-hastighed (`developRiderSeason`s `isSig`) fordi den aldrig
kalder `signatureFactor`/`abilityCap`, og (c) ikke kræver at nogen ANDEN type mister sit
eget signatur-tag (ingen fortegn skifter i tabellen — kun ét tal, gc.time_trial 3→2,
justeres, og selv det er valgfrit da rouleur/brostensrytter-parret løses af formlen alene).
Prisen er en moderat nedtoning af "lånte" sekundær-evner hos typer med mange delte
signaturer (især baroudeur) — det bør vises til ejeren som en eksplicit, målt bivirkning
før ship, ikke skjules.
