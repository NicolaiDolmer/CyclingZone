# Rider derived-ability history → Development-tab væk fra PCM (#2000 Part 2)

> Design — 2026-06-29. EPIC #2000, surface 2 af 2. Slice 1 migrerede hoved-evnevisningen;
> [PR #2005](https://github.com/NicolaiDolmer/CyclingZone/pull/2005) (Part 1) migrerede type-badge-fallbacken.
> Denne spec dækker den sidste PCM-flade på rytter-siden: **Development-tabben**.
>
> **Ejer-beslutninger (2026-06-29):** (1) finere granularitet end season-snapshot → **ny dedikeret
> historik-tabel** (ikke genbrug af `rider_development_log`). (2) Cadence = **dagligt for trænede
> ryttere + ét snapshot pr. season-transition for ALLE ryttere**.
>
> **Hard constraints:** abilityDerivation-kernen (`backend/lib/abilityDerivation.js`,
> `riderProgression.js`-kurver) røres IKKE — kun engine-*orchestratorerne* får en additiv,
> best-effort snapshot-write. Migration er additiv (ny tabel, ingen drop). `database/*.sql` →
> **ejer merger** (auto-applies i prod). PCM `rider_stat_history`-tabellen droppes IKKE her
> (separat follow-up).

## Baggrund / verificeret nuværende tilstand

- **Development-tabben er PCM-baseret.** `RiderStatsPage.loadDevelopmentHistory()` læser
  `rider_stat_history` (synced_at + 14 PCM `stat_*`-kolonner); `RiderDevelopmentTab.jsx` tegner en
  Recharts-linje + "recent"-tabel over den valgte PCM-stat. `localizedSkills`/`STATS`/
  `buildSkillsLocalized` i `RiderStatsPage.jsx` lever kun for at fodre denne tab.
- **PCM-feeden er reelt død post-relaunch.** `rider_stat_history` blev fodret af UCI/sheets-sync
  (`sheetsSync.js` slettet 2026-06-12 #1207; scraper = pensions-kandidat). Relaunch-ryttere får
  derfor ingen nye punkter → tabben er i praksis tom/frossen i dag.
- **De udledte evner muteres to steder over tid:**
  1. `dailyTrainingEngine.runTeamTrainingDay()` — pr. menneske-hold, pr. dag. Kørt af
     `trainingSweep.runTrainingSweep()` efter kl. 22 CET. **Kun rigtige hold** (is_ai/is_bank/
     is_frozen/is_test_account = false). Opdaterer `rider_derived_abilities` med dagens gevinster.
  2. `riderProgressionEngine.developRidersForSeason()` — ÉN gang pr. (rytter, sæson) i
     `processSeasonStart`, for **alle** ryttere. Bygger allerede `logRows` med den fulde post-
     udviklings-evnevektor (`abilities: next`).
- **Eksisterende mønstre at spejle:** `rider_development_log` (RLS-lukket, service-role-only,
  JSONB `abilities`) + read via backend-API; rytter-sub-endpoints `GET /api/riders/:id/bid-timeline`
  / `/view-count` (`requireAuth`, service-role-client).
- i18n: `frontend/public/locales/{en,da}/rider.json` — `development.*` findes (empty/statsTitle/
  statsSubtitle/recentTitle/table.date/fallbackDash); evne-navne via `racePreview.derived.<key>`
  (alle 15 findes). `abilities.js` er SSOT for `ABILITY_KEYS`/`ABILITY_SELECT`.

## Mål

Development-tabben viser en **rytters udledte CZ-evner over tid** — fin daglig kurve for ryttere
manageren træner, season-punkter for alle — og læser INGEN PCM-kolonner. Efter denne ændring er
`RiderStatsPage.jsx` PCM-fri.

## Arkitektur — 4 enheder

### 1. Migration — `database/2026-06-29-rider-derived-ability-history.sql` (additiv, ejer-merger)

```sql
CREATE TABLE IF NOT EXISTS rider_derived_ability_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id      UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,                 -- logisk dag (tick_date / transition-dato); x-akse + dedup
  source        TEXT NOT NULL                  -- 'daily_training' | 'season_transition'
                  CHECK (source IN ('daily_training','season_transition')),
  season_number INTEGER,                        -- sat for season-snapshots (kontekst)
  abilities     JSONB NOT NULL,                 -- fulde 15-evne-vektor (post-tick/post-udvikling)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rider_id, snapshot_date, source)      -- idempotens: re-run skriver ikke dubletter
);
CREATE INDEX IF NOT EXISTS idx_rider_ability_history_rider
  ON rider_derived_ability_history (rider_id, snapshot_date);
ALTER TABLE rider_derived_ability_history ENABLE ROW LEVEL SECURITY;
-- Ingen public policy → kun service-role (spejler rider_derived_abilities/rider_development_log).
```

- **JSONB `abilities`** (ikke 15 kolonner): matcher `rider_development_log`s bevist mønster;
  grafen henter alle rækker for én rytter og vælger `abilities[key]` klient-side (samme form som i
  dag). Fremtidssikret mod evne-sæt-ændringer.
- **UNIQUE(rider_id, snapshot_date, source)** + `ON CONFLICT DO NOTHING` gør writes idempotente
  (sweep + progression er begge re-run-sikre; samme rytter kan have både en daily- og en
  season-række samme dag uden kollision).

### 2. Write-hook A: daglig snapshot (`dailyTrainingEngine.runTeamTrainingDay`, Phase 2)

I Phase-1-loopet, hvor `abilityPatch` bygges (linje ~214-229): når en rytter fik en evne-gevinst i
dag (`abilityPatch` har mindst én ændret evne-nøgle), saml en history-række med rytterens **fulde
post-tick evnevektor** — `tickResult.abilities` (15-nøgle-objekt), IKKE den partielle patch.
`source='daily_training'`, `snapshot_date=tickDate`, `season_number=seasonNumber`. Flade dage (ingen
gevinst) får intet punkt — Recharts `connectNulls` bygger bro, så kurven ser sammenhængende ud; den
valgfri baseline-seed + season-punkter sikrer at selv ryttere uden gevinst har ≥1 punkt. I Phase 2,
efter `rider_derived_abilities`-updates (linje ~287-293), insert via
`.upsert(rows, { onConflict: 'rider_id,snapshot_date,source', ignoreDuplicates: true })`.
**Best-effort:** wrap i try/catch der logger men ikke kaster — en historik-fejl må aldrig rulle en
træningsdag tilbage (historik er afledt visning, ikke spil-state).

### 3. Write-hook B: season snapshot (`riderProgressionEngine.developRidersForSeason`)

`logRows` har allerede `{ rider_id, season_number, abilities: next }`. Byg parallelle history-rækker
fra samme data: `source='season_transition'`, `snapshot_date` = transition-datoen (sæsonstart),
`abilities=next`. Upsert med samme onConflict. Samme best-effort-wrap. Dækker AI/free-agents +
giver ejede ryttere et rent sæson-grænsepunkt.

### 4. Read-endpoint + frontend

- **`GET /api/riders/:id/development`** (`requireAuth`, service-role-client; spejler
  `/riders/:id/bid-timeline`). Returnerer `[{ snapshot_date, season_number, source, abilities }]`
  sorteret `snapshot_date` asc, `.limit(200)` (≈ ½ sæsons daglige punkter; nok til kurven). RLS-
  lukket tabel ⇒ læsning SKAL gå via dette endpoint, ikke direkte supabase-from.
- **`RiderStatsPage.loadDevelopmentHistory()`**: kald endpointet (authHeaders) i stedet for
  `rider_stat_history`; sæt `statHistory` = rækker med `abilities`-objekter + `snapshot_date`.
- **`RiderDevelopmentTab.jsx`**: selector over de 15 udledte evner (`DERIVED_ABILITIES` +
  `t('racePreview.derived.<key>')`-labels) i stedet for PCM-`stats`-prop; chart x-akse =
  `snapshot_date`; punkt-værdi = `row.abilities[selectedKey]`. "Recent"-tabel tilsvarende.
  Bevar empty-state (`development.empty`).
- **Cleanup** (`RiderStatsPage.jsx`): fjern `STATS`, `buildSkillsLocalized`, `localizedSkills` og
  `rider_stat_history`-queryen. Efter dette er filen PCM-fri.

## Data flow

```
[daglig sweep >22 CET]  runTeamTrainingDay → rider_derived_abilities.update
                                           → rider_derived_ability_history.upsert (source=daily_training)
[season-transition]     developRidersForSeason → rider_derived_abilities.update + rider_development_log
                                              → rider_derived_ability_history.upsert (source=season_transition)
[rytter-profil]         RiderStatsPage → GET /api/riders/:id/development (service-role)
                                       → RiderDevelopmentTab (linje/tabel pr. valgt evne)
```

## Tom-til-at-begynde-med / backfill

Tabellen starter tom og akkumulerer fremad: første sweep efter deploy fylder ejede ryttere; første
season-transition fylder alle. Det er ikke en regression — PCM-feeden er allerede tom for relaunch-
ryttere. **Valgfrit seed (anbefales):** migrationen kan indsætte ét `source='season_transition'`-
baseline-punkt pr. rytter fra nuværende `rider_derived_abilities` (snapshot_date = i dag,
season_number = aktiv sæson), så hver rytter har ≥1 punkt straks i stedet for en tom tab indtil
første tick. Holder tabben meningsfuld fra dag 1.

## Error handling

- Begge write-hooks er best-effort (try/catch + log), aldrig blokerende for spil-state.
- Endpoint: 404 hvis rytter ikke findes; tom liste hvis ingen historik (frontend viser
  `development.empty`).
- Idempotens via UNIQUE + onConflict-ignore.

## Testing

- **Backend unit:** `rider_derived_ability_history`-rækker bygges korrekt fra daily-tick (post-tick
  abilities, source/snapshot_date) og fra progression-logRows; idempotent (re-run → ingen dubletter);
  history-fejl kaster ikke fra `runTeamTrainingDay`/`developRidersForSeason` (best-effort). Mock-
  supabase som i `dailyTrainingEngine.test.js`/`riderProgressionEngine.test.js`.
- **Endpoint:** returnerer sorterede rækker for rytter; tom for ukendt; kræver auth.
- **Frontend `node --test`:** i18n-parity (`development.*` + `racePreview.derived.*` i en+da); ingen
  hardcodede danske strenge i `RiderDevelopmentTab.jsx`; selector itererer ABILITY_KEYS.
- **Build + `npx playwright test core-smoke.spec.js`** (alle 3 projekter).

## Levering — 2 PR'er

1. **PR A (backend, har `database/*.sql` → ejer merger):** migration + 2 write-hooks + endpoint +
   unit-tests. Bagudkompatibel: frontend læser stadig PCM indtil PR B.
2. **PR B (frontend, AI kan merge ved grøn CI):** `loadDevelopmentHistory` → endpoint;
   `RiderDevelopmentTab`-rewrite til udledte evner; cleanup af STATS/localizedSkills + PCM-query.
   Patch-note: Development-tab viser nu de 15 CZ-evners udvikling (kræver versions-bump +
   `patch-notes.png`-snapshot-refresh, alle 3 projekter).

## Out of scope (follow-ups)

- Drop af `rider_stat_history`-tabellen (destruktiv migration; egen ejer-godkendt PR efter PR B er
  live og verificeret).
- Daglig granularitet for ikke-ejede ryttere (de står stille mellem season-transitions per design).
