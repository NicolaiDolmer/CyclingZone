# To loft-semantikker tildelt ved møntkast — "skriv kun når NULL" gjorde en race til data

**Dato:** 2026-07-15 · **Issue:** [#2471](https://github.com/NicolaiDolmer/CyclingZone/issues/2471) · **Fundet af:** ejeren, ved at kigge på to ryttere

## Hvad skete der

En rytter med potentiale 4,5 havde et højere livstidsloft (loft-sum 813) end den bedste potentiale-6-rytter i spillet (737). Potentiale — spillets centrale talent-valuta — styrede ikke hvor god en rytter kunne blive.

Rod-årsagen var ikke en forkert formel. Begge formler var rigtige, hver for sig:

- `buildYouthCaps` = **absolut** loft (potentiale bestemmer slutniveauet)
- `buildCaps` = **headroom over baseline** (potentiale bestemmer forbedringen)

Fejlen var at **hvilken formel en rytter fik var et møntkast**. `ability_caps` blev kun skrevet når feltet var NULL og blev aldrig genopbygget. Den kodesti der tilfældigt ramte rytteren først, frøs sin semantik ned i data for evigt:

- motorerne (`dailyTrainingEngine`, `riderProgressionEngine`) lazy-initede med `buildCaps` **uanset alder**
- backfill-stien brugte den alders-bevidste `buildCapsForRider` → ungdoms-loft for 16-21

Resultat i prod: 261 af 570 ryttere i akademi-alder havde den forkerte semantik ift. den godkendte spec, og 351 var allerede *over* deres eget livstidsloft og dermed permanent frosne.

## Lektionerne

### 1. "Skriv kun når NULL" gør en race condition til permanent data

Lazy-init er et cache-mønster, men `ability_caps` var ikke en cache — det var en **afledt værdi** (ren funktion af potentiale + anlæg + evne). Når man persisterer noget afledt og kun skriver det én gang, bliver "hvem kom først" til en forretningsregel. Der er ingen fejl, ingen log, intet symptom — bare to ryttere der opfører sig forskelligt for evigt.

**Forward-guard:** afledte værdier genberegnes hver tick og skrives når de ændrer sig. Hvis en værdi kan udledes af data du allerede har indlæst, så *udled den* — persistér kun for læse-flader, aldrig som sandhed. Samme mønster gjaldt `deriveForRiderIds`, som "bevarede eksisterende caps" ved re-derive; den bevarede dermed også fejlen.

### 2. Bevidst teknisk gæld skal have en tripwire, ikke kun en kommentar

Specen fra 23/6 (§10) skrev eksplicit: *"To loft-formler i koden … er bevidst teknisk gæld for at holde scope; dokumentér tydeligt, så de ikke drifter."* Dokumentationen fandtes. Gælden driftede alligevel — inden for tre uger, i 261 ryttere — fordi intet i koden håndhævede kohorte-grænsen. En kommentar er ikke en guard.

**Forward-guard:** når to formler bevidst må sameksistere, skal tildelingen være eksplicit og testet (en `cap_model`-kolonne, en assertion, en invariant-test), ikke implicit i hvilken kodesti der kalder hvad.

### 3. Verificér briefingens tal, også når briefingen er grundig og har ret

Analysen jeg fik var solid og fik rod-årsagen rigtig. Men to tal holdt ikke:

- **Fordelingen 351/219 (61,6%/38,4%) var forkert** — den er 447/123 (78,4%/21,6%). De 351 var i virkeligheden "ryttere over eget loft", en anden metrik der tilfældigt havde samme størrelsesorden. Metrikken var fejletiketteret, ikke fejlberegnet.
- **"De voksen-loftede er de stærke starter-squad-ryttere"** holdt ikke: 239 ikke-akademi-ryttere havde ungdoms-lofter og 22 akademi-ryttere havde voksen-lofter. Det var et rent møntkast, ikke en kohorte-effekt.

### 4. Postgres regner eksakt, JS regner i flydende komma

Min første klassifikator gav 396 i stedet for 447 og fandt 51 "mystiske" ryttere med en tredje semantik. Der var ingen tredje semantik: `0.82 * 75` giver 61,4999… i IEEE754 → `Math.round` → **61**, mens Postgres' `numeric` giver præcis 61,50 → `round` → **62**. Jeg var ét skridt fra at rapportere et fantom-fund.

**Forward-guard:** når SQL skal reproducere JS-motorens tal, cast til `float8` og emulér `Math.round` som `floor(x + 0.5)`. Eller endnu bedre: kør de ægte motor-funktioner mod prod-data i et read-only Node-script i stedet for at re-implementere dem i SQL. Det gjorde jeg til sidst — og det var også dét der fangede min egen næste fejl (se 5).

### 5. En metrik der måler ryttere der aldrig vokser, måler ingenting

Mit første scorecard påstod at model A tredoblede voksnes udviklingsrum. Et spot-check på én ægte rytter afslørede hvorfor: Adrián Fuentes er 29 — forbi `peakAge` 28 — så han *falder* uanset loft. Hans "342 point tilbage" var fiktion. Loftet binder kun før peak; metrikken skulle splittes ved 28.

**Forward-guard:** før du rapporterer et aggregat, spot-check én ægte række og spørg om tallet overhovedet kan være sandt for *den* række.

## Hvad blev ændret

- `buildCapsForRider` er nu **ét loft for alle aldre**: `max(absolut_loft(potentiale, anlæg), nuværende evne)`. Gulvet er det der gør konsolideringen mulig — spec-§4.2's indvending mod én formel var netop "en voksen ville få et loft under sin current".
- Motorerne **genberegner** loftet hver tick og skriver kun når det flyttede sig (`sameCaps`). Lazy-init er væk.
- `deriveForRiderIds` genberegner caps, bevarer `progress` (det ER akkumuleret træning).
- Død kode fjernet: `computeYouthCapsForRider`, `ageOf` (+ nu ubrugte imports).
- Alders-gaten er væk → 21→22-bomben kan ikke detonere.
- Spec-§4.2/§8/§10 markeret som superseded (slettet ikke — ejer-regel).

## Kommer ikke igen

- Test: "loftet er alders-uafhængigt", "loftet er aldrig under nuværende evne", "højere potentiale giver aldrig lavere loft", "pot 6 slår pot 4,5".
- Test: "stale caps overlever ikke en re-derive".
- `backend/scripts/capSemanticsComparison.js` — read-only scorecard mod ægte population, kalder de ægte motor-funktioner (ikke en kopi), så det måler hvad koden faktisk gør.
