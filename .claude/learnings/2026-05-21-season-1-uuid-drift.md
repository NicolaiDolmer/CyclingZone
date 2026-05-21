# 2026-05-21 — Sæson 1 UUID-drift fanget før 1→2-transition

## Symptom

Under deadline-check inden sæson 1 launch kl 23:00 (Europe/Copenhagen) opdagede
jeg at sæson 1's row i `seasons` havde UUID `ab2b110e-0422-45e4-b5a9-60e57f3593d9`
— en non-deterministisk UUID. Slice 08's `computeSeasonUuid(N)` (i
`backend/lib/seasonTransition.js`) bygger derimod en deterministisk UUID-pattern:

```
sæson 0 → 00000000-0000-0000-0000-000000000000
sæson 1 → 00000000-0000-0000-0000-000000000001
sæson 2 → 00000000-0000-0000-0000-000000000002
```

Sæson 0's row havde korrekt deterministisk UUID. Kun sæson 1 var drevet ud.

## Hvorfor var det farligt?

`SeasonCycleSection.executeTransition` på admin-siden kalder
`POST /api/admin/season-transition` som internt kører
`transitionToNextSeason()` → `insertSeasonIfMissing(seasonId, ...)` med
**det deterministiske ID**. Eksistens-check sker via `eq("id", toSeasonId)`,
ikke via `eq("number", toSeasonNumber)`.

Konsekvens hvis vi havde ladet drift'en stå:

1. Bruger trykker `Udfør sæson-skifte` ved 1→2-overgang
2. Engine søger efter `id = 00000000-...002` → finder intet
3. INSERT `{ id: 00000000-...002, number: 2, status: 'active' }` — OK
4. Engine markerer FROM-sæson (sæson 1, id `ab2b110e-...`) som `completed`
5. **Sponsor-payout sker for sæson 2** — men board_profiles, transfer_windows
   m.fl. for sæson 1 sidder stadig med `ab2b110e-...` referencer
6. Hvis brugeren senere prøver at oprette en ny sæson manuelt via legacy
   `POST /admin/seasons` med `number=1`, vil:
   - før forward-guard: lykkes (ingen UNIQUE constraint), skabende en
     duplikat sæson 1-row med en TREDJE UUID
   - efter forward-guard: fejle på `seasons_number_unique`

Med drift'en i live OG ingen UNIQUE constraint var der altså 2 forskellige
INSERT-paths der kunne producere kollision uden DB-fejl.

## Root cause

`POST /admin/seasons` (legacy endpoint i `backend/routes/api.js:3215`) blev
skrevet **før** Slice 08 season-transition-engine. Det inserter uden eksplicit
`id`, hvilket lader Supabase auto-generere en UUID. Da bruger oprettede sæson
1-row manuelt via det endpoint, fik den ikke den deterministiske UUID som
seasonTransition.js senere forventede.

To-paths-til-samme-data-mønster: når en engine kommer **efter** et legacy
endpoint, skal legacy endpoint **patches** for at producere data der matcher
engine'ns invariants. Ellers driver de to paths fra hinanden.

## Fix

**1. Reaktiv UUID-repair** (migration `repair_season_1_deterministic_uuid`):

```sql
ALTER TABLE races DROP CONSTRAINT races_season_id_fkey;
UPDATE seasons SET id = '00000000-0000-0000-0000-000000000001'::uuid
  WHERE id = 'ab2b110e-0422-45e4-b5a9-60e57f3593d9'::uuid;
UPDATE races SET season_id = '00000000-0000-0000-0000-000000000001'::uuid
  WHERE season_id = 'ab2b110e-0422-45e4-b5a9-60e57f3593d9'::uuid;
ALTER TABLE races ADD CONSTRAINT races_season_id_fkey
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
```

Kører i én TX. FK `races_season_id_fkey` har `update_rule = NO ACTION`, så
direct `UPDATE seasons.id` ville fejle. Drop→update→recreate er den
simplest robuste vej. Andre 9 FK-tabeller havde 0 referencer (verificeret
med `COUNT(*) WHERE season_id = old_uuid` for hver tabel).

**2. Forward-guard lag 1 — DB constraint** (migration
`add_seasons_number_unique_constraint`):

```sql
ALTER TABLE seasons ADD CONSTRAINT seasons_number_unique UNIQUE (number);
```

Defense in depth: virker uafhængigt af kode-path. Selv hvis fremtidig kode
glemmer at sætte deterministisk UUID, vil DB blokere duplikat-INSERT.

**3. Forward-guard lag 2 — code patch** (`backend/routes/api.js:3215`):

```diff
 import {
   buildTransitionPlan,
+  computeSeasonUuid,
   transitionToNextSeason,
 } from "../lib/seasonTransition.js";

 // ...

 const { data: createdSeason, error: createError } = await supabase
   .from("seasons")
   .insert({
+    id: computeSeasonUuid(number),
     number,
     race_days_total: raceDaysTotal,
     status: "upcoming",
   })
```

Proaktiv konsistens: de to season-insert paths producerer nu identiske UUIDs.

## Backwards-check

Per memory `feedback_backwards_check_forward_guard` ("find alle eksisterende
forekomster"):

- `transfer_windows` for sæson 0: `00000000-0000-0000-0000-00000000aaaa` ✅
  deterministisk (matcher `computeTransferWindowUuid(0)`)
- `transfer_windows` for sæson 1: ingen rækker fundet i live-DB. Hvis bruger
  fortsætter med manual `⏹ Afslut sæson 0` + `▶ Start sæson 1` vil
  start-endpoint IKKE oprette transfer_window (det er kun
  `transitionToNextSeason` der gør det). Det er en separat bekymring at flagge,
  men ikke en UUID-drift-bug — det er bare en feature der mangler i
  start-endpoint vs. season-transition-endpoint.
- Grep efter `ab2b110e-0422-45e4-b5a9-60e57f3593d9` i kodebase: 0 hits.
- Grep efter `00000000-0000-0000-0000-000000000001` i kode: kun i
  `seasonTransition.test.js` (forventede UUIDs i mock-data — alle stadig
  gyldige).
- Andre season-insert paths i kode: kun `backend/lib/seasonTransition.js:175`
  som allerede bruger deterministisk UUID. Patched-versionen af api.js er nu
  konsistent.

## Detection

Drift'en blev fanget under en bevidst session-start-rutine ("verificér sæson 1
deadline-ready state"). Hvis jeg havde stoppet ved "✅ 26 races, edition_year
sat, kalender låst" og rapporteret klar-status, ville bug'en ikke være blevet
opdaget før den ramte 1→2-overgangen — i hvilket tilfælde fejlmøstret ville
være langt sværere at debugge (duplikate sæson-rows, ortografisk korrekt
sponsor-payout for forkert række).

**Generaliserbar lære:** Ved deadline-kritiske runtime-events, sammenlign DB
state ikke kun mod "har vi data?" men også mod "matcher data engine-kontrakten?".
Spørg om hver kolonne der har en deterministisk invariant.

## Tidslinje

- 2026-05-21 ~07:00 (start session): læste NOW.md, så "sæson 1 starter i aften
  23:00", begyndte deadline-check
- ~07:15: opdagede sæson 1 status `upcoming` + tomme priority-lister + sæson 0
  stadig `active`
- ~07:25: opdagede UUID `ab2b110e-...` afviger fra `computeSeasonUuid(1)` —
  først via at læse `seasonTransition.js`-kommentaren der definerer det
  deterministiske skema
- ~07:30: konfirmeret med bruger at vi fixer UUID nu før launch
- ~07:35: migration applied, 1 + 26 rows opdateret i én TX
- ~07:40: NOW.md commit `2f7ffdc` pushed
- ~07:50: forward-guard migration + code-patch commit `ec8df65` pushed, 674/674
  tests grøn
- ~08:00: postmortem skrevet (denne fil)

## Open follow-ups (ikke gjort denne session)

- **transfer_window for sæson 1 mangler.** Brugerens manual `▶ Start sæson 1`
  vil ikke oprette en transfer_window — der findes ingen kode-path til det
  uden at gå gennem `season-transition`. Spørg bruger om det er forventet
  eller et hul (#525-lignende issue).
- Sammenligning af `start`-endpoint vs `season-transition`-endpoint: ud over
  transfer_window-insert, hvad ellers gør sidstnævnte som førstnævnte ikke?
  Hvis svaret er "rigtig meget", er det en sti-divergens der skal lukkes.
- Audit-mekanisme: tilføj startup-check der sammenligner `seasons.id` mod
  `computeSeasonUuid(number)` for hver række. Logger advarsel ved drift.
  Måske som backwards-detector i `backend/scripts/`.
