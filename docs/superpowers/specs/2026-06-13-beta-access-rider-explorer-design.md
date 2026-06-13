# Beta-adgangssystem + Rider Explorer — design

- **Dato:** 2026-06-13
- **Status:** Godkendt (ejer-go på design 2026-06-13)
- **Relaterede issues:** #1105 (relaunch-epic, flag-flip 20/6), #1308 (academy), #1305 (daily training), #1102 (race engine v2). Enabler for #1364 (værdimodel — egen spec).
- **Type:** Infra-enabler (ikke launch-blocker, men gør beta-funktioner testbare før 20/6).

## 1. Problem

Tre kernesystemer er merged men bag feature-flags `OFF`: `academy_enabled`, `daily_training_enabled`, `race_engine_v2_enabled`. I dag kan flagene **kun** flippes globalt (alle brugere) eller vente til relaunch 20/6. Der er ingen måde for ejeren — eller en lille gruppe beta-testere — at se og afprøve beta-funktioner før de rulles ud til alle spillere.

**Mål:** En genbrugelig beta-adgangs-mekanik der lader en defineret gruppe testere (+ ejer/admin) få tidlig adgang til et flag-styret system, mens det forbliver skjult for almindelige spillere. Plus et trofast preview af de 800 fiktive relaunch-ryttere til indholds-feedback.

**Non-goals:**
- Ikke et per-bruger-per-flag override-system (over-bygget — vi vil styre *en gruppe* mod *beta-funktioner*).
- Ikke data-isolation pr. funktion (beta-flaget styrer adgang, ikke effekter — se §6).
- Ikke et separat staging-miljø (afvist; for tungt før 20/6).
- Ikke admin-UI til kohorte-styring i denne runde (SQL/admin nu; UI = fast-follow).

## 2. Mekanik-valg

**Én beta-tester-kohorte + tre-tilstands-flags**, der spejler det eksisterende `is_admin()`/survey-banner-mønster (`database/2026-05-15-founder-supporter-waitlist.sql`, `frontend/src/components/SurveyBanner.jsx`).

Hvert feature-flag får en livscyklus: `off` → `beta` → `on`.

| Stage | Hvem ser funktionen |
|-------|---------------------|
| `off` | Ingen (fail-safe default) |
| `beta` | Beta-testere + admins |
| `on`  | Alle authenticated brugere |

Fravalgt alternativ: en generisk `feature_flag_overrides(user_id, flag_key, value)`-tabel. Mere finkornet, men over-bygget for behovet (kohorte, ikke individ-mikrostyring) og dyrere at administrere.

## 3. Enhed A — Beta-adgangssystem

### 3.1 Datamodel

- **Ny kolonne:** `public.users.is_beta_tester boolean NOT NULL DEFAULT false`. Kohorte-medlemskab.
- **Ny RPC:** `public.is_beta_tester()` → returnerer `true` hvis `auth.uid()`-brugerens `role = 'admin'` ELLER `is_beta_tester = true`. Admins er implicit beta-testere. Spejler `is_admin()` 1:1: `SECURITY DEFINER`, `STABLE`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO anon, authenticated, service_role`.
- **Flag-værdier i `app_config`:** de tre feature-flags skifter fra JSONB-boolean til JSONB-streng `"off" | "beta" | "on"`. Migration sætter alle tre til `"off"` (svarer til nuværende `false`). `survey_banner_enabled` røres IKKE (forbliver boolean — den har sin egen admin-preview-logik).

### 3.2 Evaluering (delt helper)

Ny modul `backend/lib/featureStage.js`:

```js
// Returnerer effektiv adgang for ÉN bruger givet flag-værdi + beta-status.
// Bagudkompatibel: boolean true/false fra gammelt skema honoreres som on/off.
export function evaluateFlagStage(value, { isBetaTester = false } = {}) {
  if (value === true || value === "on") return true;
  if (value === "beta") return isBetaTester === true;
  return false; // false | "off" | null | undefined | ukendt
}
```

Tilsvarende frontend-helper (samme tre-tilstands-regel) i `frontend/src/lib/featureStage.js`.

### 3.3 Backend-ændringer (blast-radius)

De tre flag-funktioner får en valgfri options-parameter og delegerer til `evaluateFlagStage`:

```js
export async function isAcademyEnabled(supabase, { isBetaTester = false } = {}) {
  // ... læs app_config value som nu ...
  return evaluateFlagStage(value, { isBetaTester });
}
```

(samme for `isDailyTrainingEnabled`, `isRaceEngineV2Enabled`)

**Bruger-kontekst (skal sende beta-status):** beregnes ÉN gang pr. request fra `req.user` via en ny helper `getIsBetaTester(supabase, userId)` (ét opslag på `users.role, is_beta_tester`), og sendes til alle flag-kald i samme request.

| Fil | Linjer (ca.) | Kontekst | Sender beta-status? |
|-----|------|----------|---------------------|
| `backend/routes/api.js` | 1030, 1159 | daily training (status + handling) | Ja |
| `backend/routes/api.js` | 1191, 1213 | race engine v2 | Ja |
| `backend/routes/api.js` | 7930, 8058, 8093, 8118 | academy (4 endpoints) | Ja |
| `backend/lib/adminSimulateRace.js` | 22, 107 | admin race-sim (allerede admin-gated) | Nej — global (admin gør det bevidst) |

**System/cron-kontekst (ingen bruger → kun global `on`):** disse sender INTET (default `isBetaTester=false`), så kun `"on"` aktiverer dem. Korrekt: et beta-flag må ikke trigge en sweep for hele populationen.

| Fil | Linje (ca.) | Hvorfor global-only |
|-----|------|---------------------|
| `backend/lib/trainingSweep.js` | 60 | Sæson-sweep rammer alle hold |
| `backend/lib/riderProgressionEngine.js` | 88 | Progression-tick (har allerede ternær-override for sims) |
| `backend/lib/relaunchOrchestrator.js` | 136 | Relaunch-summary skal afspejle global tilstand |

### 3.4 Frontend-ændringer

- Tilføj `supabase.rpc("is_beta_tester")` ved siden af eksisterende `is_admin`-kald der gater beta-UI.
- Ny hook `useFeatureStage(key)`: læser `app_config.value` for `key` + beta-status, returnerer `{ enabled, viaBeta }`.
- Komponenter der i dag skjuler academy/training/race-UI bag flaget bruger hooken. Når adgang sker `viaBeta` vises et diskret **"Beta"-badge** (spejler `survey.adminPreviewHint`-mønsteret).
- Nye UI-strenge får i18n-nøgler i **både `en` og `da`** (CI-guard kræver det). Sandsynligt namespace: `common` (badge) — bekræftes ved impl.

### 3.5 Kohorte-styring (YAGNI nu)

Ejeren sætter `is_beta_tester = true` pr. bruger via SQL eller Supabase Studio. Admins er implicit med. Et admin-UI til at administrere gruppen er en **fast-follow** hvis det bliver tungt at gøre manuelt.

### 3.6 Bagudkompatibilitet

- Eksisterende flag-tests (`value: true` → enabled) består uændret (`true` → `"on"`).
- 20/6-flag-flippet virker uanset om orchestratoren skriver `true` eller `"on"`.
- `survey_banner_enabled` er urørt.

## 4. Enhed B — Rider Explorer (preview af de 800)

**Præmis:** vi kan ikke seede 800 fiktive ryttere ind i den *levende* sæson uden at lave selve relaunchet (kollision med nuværende PCM-sæson). Vi giver i stedet et trofast, read-only preview.

### 4.1 Backend

Nyt read-only endpoint (admin/beta-gated), fx `GET /api/admin/fictional-rider-preview`:
- Kører den eksisterende **deterministiske** kæde i hukommelsen — `backend/lib/fictionalRiderGenerator.js` → `abilityDerivation.js` → `riderTypes.js` → `riderValuation.js` — for launch-populationen (`fictionalLaunchPopulation.js`, seed 2026, 800 ryttere).
- **Rører IKKE databasen** (generatoren producerer records uden DB-skrivning).
- Returnerer JSON-array: `{ name, age, nationality, primaryType, secondaryType, abilities{16}, base_value, potentiale }`.
- Resultatet matcher præcist det relaunchet vil seede (samme seed + samme libs).

### 4.2 Frontend

Admin/beta-gated side **"Rider Explorer"** (matcher "inde i spillet" + dogfooder Enhed A's gate):
- Sorterbar/filtrerbar tabel: navn, alder, type, 16 evner, base_value.
- Filtre: rytter-type, alders-bånd, værdi-bånd. Sortér på enhver kolonne.
- Read-only — ingen handlinger, ingen mutation.
- i18n-nøgler (en+da) for sidens labels.

## 5. Test-strategi

- **Backend `node --test`:** `featureStage.test.js` (alle tre stages × beta/ikke-beta + bagud-kompat boolean). Udvid de tre eksisterende flag-tests med `"beta"`-cases. Test `getIsBetaTester`-helper.
- **RPC:** verificér `is_beta_tester()` mod PROD-klon (admin→true, beta→true, normal→false, anon→false). Spejl `is_admin()`-test-mønster.
- **Frontend:** unit-test `evaluateFlagStage` + hook-logik. Logget-ind-UI verificeres via Playwright-mocks (fixtures.js) — badge vises kun `viaBeta`.
- **Rider Explorer:** snapshot/antal-check at endpointet returnerer 800 og at pyramide-fordelingen (12/60/230/500) holder.
- **Pre-flight:** fuld CI-gate-sæt (build + warning-budget + i18n-keys + i18n-leak + tone + node --test + core-smoke alle 3 projekter) før push.

## 6. Caveats & ejer-ansvar

- **Data-effekt-caveat:** beta-flaget styrer *adgang*, ikke *data-isolation*. En beta-tester der bruger academy/training/race på prod skriver til **delte** tabeller — effekter kan ses af alle spillere. 20/6-resettet visker pre-launch-pollution væk, men i den levende sæson besluttes pr. funktion hvad der er trygt at beta'e på prod. Dette løses IKKE af infraen; det dokumenteres og er en bevidst pr.-funktion-beslutning.
- **Migration = ejer merger:** Enhed A tilføjer `users`-kolonne + RPC + ændrer `app_config`-værdier → `database/*.sql` auto-applies ved merge → **ejeren merger PR'en** (ikke auto-merge).
- **TypeScript-typer:** regenerér `frontend/src/types/database.types.ts` efter `users.is_beta_tester` tilføjes.
- **Kolonne-privilegier:** `users.is_beta_tester` skal kunne læses af `getIsBetaTester` (service-role i backend bypasser RLS; RPC'en er SECURITY DEFINER så frontend behøver ikke direkte kolonne-læseadgang).

## 7. Leverance-rækkefølge

1. Enhed A migration (kolonne + RPC + app_config tri-state) — ejer merger.
2. Enhed A backend (helper + flag-fn-signaturer + request-wiring).
3. Enhed A frontend (hook + badge).
4. Enhed B endpoint + Rider Explorer-side.
5. Patch notes? Nej — beta-infra er ikke brugerrettet for almindelige spillere (admins/beta ser badge). Dokumentér hvorfor i PR.

## 8. Åbne punkter (post-MVP)

- Admin-UI til kohorte-styring (sæt/fjern beta-tester).
- Eventuel "Beta-program"-side hvor testere kan se hvilke beta-funktioner de har adgang til.
- Per-funktion data-isolation hvis vi vil beta'e mutations-tunge features midt i en levende sæson.
