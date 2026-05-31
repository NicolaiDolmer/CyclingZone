# Slice — Lande-system ([#844](https://github.com/NicolaiDolmer/CyclingZone/issues/844))

> **Status:** Fase 0 (plan/SSOT) — afventer ejer-gate før Fase 1 (kode på branch).
> Single source of truth for opgaven. Alt state, beslutninger og næste skridt lever her + i issue #844.

## Mål

Indfør **lande som førsteklasses-entitet**: en kanonisk `countries`-tabel der gør nationalitet til mere end en løs ISO2-streng på `riders`, og som driver fire spiller-vendte effekter:

1. **Forskellig fødselsrate** per land — store cykelnationer producerer flere nye (fiktive) ryttere.
2. **Talent-loft** per land — store nationer har større sandsynlighed for topryttere.
3. **Dynamisk omdømme** der udvikler sig med landets resultater over sæsoner.
4. **Landshold** — nationale konkurrencer/mesterskaber (kobler til [#266](https://github.com/NicolaiDolmer/CyclingZone/issues/266); venter på egen race-engine [#676](https://github.com/NicolaiDolmer/CyclingZone/issues/676)).

Lande-systemet bygger ovenpå eksisterende infrastruktur frem for at duplikere den (se §Genbrug).

## Trufne beslutninger (ejer, 2026-05-31)

| Valg | Beslutning |
|------|-----------|
| Styrke-model | **Tre akser:** størrelse (`birth_weight`) · talent-loft (`talent_ceiling`) · dynamisk omdømme (`reputation` + `reputation_seed`) |
| Feedback-loop | **Blødt koblet (dæmpet):** omdømme nudger fødselsrate/talent svagt, med gulv+loft + mean-reversion mod seed → ingen rich-get-richer |
| Indførsel af feedback | **Mål-før-kobl:** omdømme-motoren bygges read-only først (3a); feedback aktiveres først efter observation over et par sæsoner (3b) |
| Arbejdsform | Gated som #669 — ejer godkender hver fase-overgang |

## Fase-plan (gated)

| Fase | Indhold | Gate |
|------|---------|------|
| 0 | Denne doc (plan/SSOT) | ✅ → **ejer-gate (her nu)** |
| 1 | Slice 1 — `countries`-tabel + seed (migration på branch) | — |
| 2 | Slice 2 — fødselsrate + talent-loft i #669-generatoren | ejer-gate · kræver #669 merged |
| 3a | Slice 3a — omdømme-motor (read-only) + rangliste | ejer-gate |
| 3b | Slice 3b — aktivér blød feedback (omdømme → generering) | ejer-gate · kræver observation |
| 4a | Slice 4a — national-trup-visning | ejer-gate |
| 4b | Slice 4b — landshold-LØB (VM/nationale) | ejer-gate · kræver race-engine #676 |

---

## Datamodel — `countries`-tabel (Slice 1)

```sql
CREATE TABLE countries (
  iso2              TEXT PRIMARY KEY,             -- matcher riders.nationality_code (ISO 3166-1 alpha-2, uppercase)
  name_en           TEXT NOT NULL,               -- EN-first (player-facing copy-regel)
  name_da           TEXT,
  ioc_code          TEXT,                         -- 3-bogstav (DEN/FRA) — jf. countryCodes.js ISO2_TO_IOC
  continent         TEXT,
  -- Akse 1 · størrelse/volumen
  birth_weight      NUMERIC NOT NULL DEFAULT 0,   -- relativ sandsynlighed for ny rytter herfra (0 = producerer ingen)
  -- Akse 2 · talent-loft
  talent_ceiling    NUMERIC NOT NULL DEFAULT 1.0, -- ~0.6–1.5; skubber tier-fordelingen op/ned (1.0 = neutral)
  -- Akse 3 · dynamisk omdømme
  reputation        NUMERIC NOT NULL DEFAULT 50,  -- 0–100, opdateres fra resultater (Slice 3)
  reputation_seed   NUMERIC NOT NULL DEFAULT 50,  -- baseline: reset-anker + mean-reversion-mål
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,-- om landet producerer nye ryttere
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Seed-strategi (intet i den kørende beta må brydes):**
1. Indsæt **alle** `DISTINCT nationality_code FROM riders` (60+ koder) → garanterer at hver eksisterende rytter har et land.
2. `name_en` / `ioc_code` / `continent` fyldes fra frontend-referencerne der allerede findes (`frontend/src/lib/countryCodes.js` har `ISO2_TO_IOC`; `Intl.DisplayNames` giver navne).
3. `birth_weight` / `talent_ceiling` / `reputation_seed` sættes **redaktionelt** via kuraterede cykel-prestige-tiers (BE/FR/IT/ES/NL/SI tungt; lang hale lavt), krydstjekket mod det nuværende rytterfelt som sanity-check (ikke som kilde — PCM-feltet er skævt).

**FK-beslutning:** **Blød reference i V1** (ingen hård `FOREIGN KEY` fra `riders.nationality_code` endnu) — samme mønster som `founder_supporter_waitlist.country` bruger i dag. Hård FK kan tilføjes når tabellen er bevist komplet mod alle distinct koder (åbent punkt).

---

## Slice 2 — Fødselsrate + talent-loft (udvider #669)

> Afhænger af at [#669](https://github.com/NicolaiDolmer/CyclingZone/issues/669) er merged til main. Generatoren findes i dag på `feat/669-fictional-riders-generator` (commit `18d2f3d`).

Generatoren er allerede arkitektonisk klar til den ene akse og kræver én veldefineret ændring for den anden.

### Akse 1 (fødselsrate) — datakilde-swap, ingen generator-ændring

`generateFictionalRiders({ ..., nationalityWeights })` tager **allerede** vægte som parameter ([fictionalRiderGenerator.js:172-178](../../backend/lib/fictionalRiderGenerator.js)). I dag fodres den med den hardcodede `DEFAULT_NATIONALITY_WEIGHTS`. Slice 2 lader i stedet oprettelses-scriptet ([generateFictionalRiders.js](../../backend/scripts/generateFictionalRiders.js)) hente vægtene fra DB:

```sql
SELECT iso2 AS value, birth_weight AS weight
FROM countries
WHERE is_active AND birth_weight > 0;
```

→ fodres direkte som `nationalityWeights`. **Generatoren behøver ingen ændring for akse 1.**

### Akse 2 (talent-loft) — ny mekanik i generatoren

I dag vælges tier (`star`/`strong`/`average`/`domestique`) med **globale** vægte 4/16/40/40 ([fictionalRiderGenerator.js:77-82](../../backend/lib/fictionalRiderGenerator.js), linje 214). Konsekvens: en lille nation har **præcis samme** chance for en "star" som Frankrig. Det er det "store lande → store talenter" skal ændre.

**Ændring:** gør tier-valget nationalitets-bevidst. Udvid `nationalityWeights`-items til at bære landets loft: `{ value, weight, talentCeiling }`. Ved per-rytter tier-valg moduleres TIERS-vægtene af den valgte nationalitets `talentCeiling`:

```
modulateTierWeights(TIERS, ceiling):
  for hver tier i: ny_vægt_i = base_vægt_i × ceiling^(rank_i)
  // rank: star=+2, strong=+1, average=0, domestique=−1  → ceiling>1 løfter toppen, <1 sænker den
  renormalisér
```

Eksempel: `ceiling 1.4` (stor cykelnation) flytter masse mod star/strong; `ceiling 0.7` (lille nation) mod average/domestique. Den præcise kurve tunes i Fase 2 og dækkes med `node --test`.

### Determinisme bevares

Lande-vægtene kommer fra en muterende tabel, så reproducerbarhed = **seed + countries-snapshot**. Snapshottet (iso2 → birth_weight, talent_ceiling) skrives ind i audit-filen sammen med `seed`, præcis som #669 allerede committer en audit-fil. Samme seed + samme snapshot → identisk output.

### "Store lande → store talenter" — to mekanismer (begge med)

1. **Volumen** (`birth_weight`): flere ryttere fra landet → flere talenter i absolutte tal.
2. **Loft** (`talent_ceiling`): højere andel star/strong per rytter → bedre talenter, ikke bare flere.

---

## Slice 3 — Dynamisk omdømme (akse 3)

### 3a — omdømme-motor, read-only

Aggregér `race_results` per nationalitet ved sæson-skift (join `riders` på `rider_id` → `nationality_code`), og opdatér `countries.reputation` med dæmpning:

```
raw_nation   = Σ(points_earned for nationens ryttere denne sæson)     // normaliseret mod feltet
target       = skalér(raw_nation → 0..100)
reputation_new = reputation_old
               + α · (target − reputation_old)          // lærings-rate: gode resultater rykker
               + β · (reputation_seed − reputation_old) // mean-reversion: træk mod baseline
```

`α`, `β` små (dæmpet) → ét godt år flytter ikke balancen permanent; kun vedvarende dominans rykker meget. **Krog:** `backend/lib/seasonTransition.js` (kører allerede ved sæson-skift) — ingen ny cron.

**Read-only i 3a:** beregn + vis en "stærkeste cykelnationer"-rangliste. `reputation` påvirker **ikke** generering endnu.

### 3b — aktivér blød feedback (gated separat)

Når omdømme-tallene er observeret som fornuftige, kobl dem ind som en **transformation af generatorens input** (ikke en generator-ændring):

```
effective_birth_weight   = birth_weight   × (1 + k_b · norm(reputation − reputation_seed))   clamp [floor_b, ceil_b]
effective_talent_ceiling = talent_ceiling × (1 + k_t · norm(reputation − reputation_seed))   clamp [floor_t, ceil_t]
```

- `k_b`, `k_t` små (fx 0.15–0.20) → omdømme flytter højst vægtene ~±20 %.
- `norm(...)` skalerer `(reputation − seed)` til ca. `[−1, 1]`.
- **floor/ceil** garanterer: en udsultet nation uddør aldrig (chance > 0), en dominerende nation æder ikke feltet.

Fordi det blot transformerer det input slice 2 allerede fodrer generatoren, rører 3b ikke generator-koden.

---

## Slice 4 — Landshold

- **4a — national-trup-visning:** gruppér ryttere efter `nationality_code` → "Danmarks bedste" (top-N efter rating/uci_points eller en gemt udvælgelse). Genbruger `countries` (flag/navn). Kræver ikke race-engine.
- **4b — landshold-LØB:** nationale mesterskaber + VM hvor landshold konkurrerer. Kræver egen race-engine ([#676](https://github.com/NicolaiDolmer/CyclingZone/issues/676)) og kobler til mester-trøjer ([#266](https://github.com/NicolaiDolmer/CyclingZone/issues/266)). Post-launch.

---

## Genbrug (byg ovenpå, ikke duplikér)

| Eksisterende | Hvordan lande-systemet bruger det |
|--------------|-----------------------------------|
| `riders.nationality_code` (ISO2) | Join-nøgle mod `countries.iso2` |
| `frontend/src/lib/countryCodes.js` (`ISO2_TO_IOC`) + `countryUtils.js` | Kilde til `ioc_code`/flag/navn ved seed; uændret i frontend |
| `fictionalRiderGenerator.js` (`nationalityWeights`, `TIERS`) | Integrations-punkt for akse 1+2 (Slice 2) |
| `fictionalRiderNames.js` (`ISO_TO_CLUSTER`, ~80 koder) | De-facto lande-reference; `countries` holdes konsistent med den |
| `seasonTransition.js` | Krog for omdømme-opdatering (Slice 3a) |
| `boardIdentity.calculateNationalCore`, Club DNA `national_affinity`, `min_national_riders`-mål | `countries` bliver kanonisk kilde disse kan referere (blød kobling; ikke et V1-krav) |

---

## Risici + mitigering

| Risiko | Mitigering |
|--------|-----------|
| `countries` dækker ikke alle eksisterende koder → FK-violation / land uden metadata | Seed alle `DISTINCT nationality_code` først; blød reference i V1 |
| Talent-feedback skævvrider feltet over tid (rich-get-richer) | Mål-før-kobl (3a/3b) + clamp (floor/ceil) + mean-reversion mod seed |
| Generatorens determinisme brydes af muterende vægte | Audit-fil indeholder countries-snapshot + seed |
| Slice 2 blokeret indtil #669 merges | Slice 1 + 3a + 4a kan gå parallelt; kun slice 2 venter |
| `birth_weight = 0` for et eksisterende land stopper nye ryttere derfra utilsigtet | Seed alle aktive nationer med `birth_weight > 0`; nul er et bevidst valg |

## Åbne punkter (ikke-blokerende — afklares ved relevant fase)

- Navne-cluster: behold `ISO_TO_CLUSTER` i kode (V1) vs. flyt til `countries.name_cluster` (DB som kilde).
- Hård FK på `riders.nationality_code` → `countries.iso2`: hvornår.
- Præcis prestige-tier-tabel (hvilke lande i hvilke tiers) — kuraterings-opgave for ejer.
- Omdømme-skala + `α`/`β`/`k`-konstanter — tunes mod faktiske resultat-data i Slice 3.
- Skal board-features (national_core m.fl.) migreres til at læse `countries`, eller forblive på rå ISO2.

## Beslutnings-log

- **2026-05-31** — Styrke-model: **tre akser** (størrelse · talent-loft · dynamisk omdømme). (ejer)
- **2026-05-31** — Feedback-loop: **blødt koblet, dæmpet** (clamp + mean-reversion). (ejer)
- **2026-05-31** — Indførsel: **mål-før-kobl** (3a read-only → 3b feedback). (ejer-implikation af blød kobling)
- **2026-05-31** — Fødselsrate foldes ind i #669-generatoren (allerede `nationalityWeights`-parametriseret), ikke separat generator. (Claude — godkendes med planen)
