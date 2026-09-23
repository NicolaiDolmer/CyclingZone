# Late-fill-måling (#5246)

> Opfølger til assistent-flip-målingen 14/9 ([#5136](https://github.com/NicolaiDolmer/CyclingZone/issues/5136)).
> D-034 (hvornår assistenten skal træde ind på en tom trup) er beskrevet i
> [`docs/ASSISTANT_RULES.md`](ASSISTANT_RULES.md) §1b. Denne fil dækker KUN
> målingen: skemaet #5246 tilføjede + fem færdige forespørgsler, i samme stil
> som [`docs/SURVEY_SYSTEM.md`](SURVEY_SYSTEM.md) §5.
>
> Migration: `database/2026-09-23-5246-late-fill-log.sql`.

## 1. Hvorfor

#5136's egen måling (14/9, se issuets kommentartråd) var en proxy på to punkter:

1. **Ingen log for sweepen.** `backend/lib/raceEntryGeneratorSweep.js` skrev intet
   til DB — kørselsantal kunne kun udledes indirekte af cron-kadencen
   (hver 60. min + ved boot). #5136 §5: *"Ingen målbar log."*
2. **Auto-flaget forsvandt sporløst ved manuelt gem.** `race_entries` havde kun
   `is_auto_filled` (ingen tidsstempel/kilde), og `replace_race_selection`
   sletter+genindsætter med `is_auto_filled=false` ved ethvert gem. #5136 §2
   målte derfor "selvrettelser" som et **tidsvindue-gæt** (manuelle gem i
   perioden mellem sweep og løbsstart) — fandt **1 hold**, med en eksplicit
   advarsel om at metoden er upræcis.

## 2. Skemaet

| Objekt | Hvad |
|---|---|
| `race_entry_generator_runs` | Én række pr. faktiske sweep-kørsel (flag ON + aktiv sæson fundet), OGSÅ ved 0 fyld. `started_at`, `finished_at`, `mode`, `late_fill_hours`, `races_considered`, `teams_filled`, `entries_written`, `error`. |
| `race_entries.auto_filled_at` | `NULL` = manuelt. Sat af en TRIGGER (`race_entries_stamp_auto_fill_trg`) på ethvert insert/update der (gen-)sætter `is_auto_filled`, ryddet når `is_auto_filled=false`. |
| `race_entries.auto_filled_source` | `'late_fill'` eller `'start_rescue'` (CHECK-constraint). Se §3 for hvordan de to skilles. |
| `race_entry_overrides` | Én række pr. `replace_race_selection`-kald (ethvert "Gem plan"-gem i sæsonmatrixen), skrevet FØR delete+insert. `had_auto_filled`, `auto_source` (`'late_fill'`/`'start_rescue'`/`'mixed'`/NULL). |

## 3. To auto-kilder — og en kendt grænse

Samme skelnen som #5136 §1 fandt manuelt (ved at sammenligne `race_entries.created_at`
mod `race_stage_schedule`'s starttidspunkt):

| Kilde | Hvornår | Hvor | Mode-gated? |
|---|---|---|---|
| `late_fill` | FØR løbsstart | `raceEntryGeneratorSweep.js` → `raceEntryGenerator.js` | Ja (`assistant_selection_mode`) |
| `start_rescue` | VED løbsstart | `raceRunner.js`'s `fillMissingTeamEntries` | Nej — uændret af flippet |

**Kendt, dokumenteret grænse:** `auto_filled_source` sættes præcist for
`start_rescue` (raceRunner.js sætter det eksplicit) og for `late_fill` via
sweepen — MEN triggeren giver samme `'late_fill'`-default til enhver
`is_auto_filled=true`-række uden et eksplicit source, og det gælder også
`raceEntryGenerator.js`'s to ANDRE kaldere (`seasonTransition.js` ved
sæsonskifte, admin-genvejen `POST /admin/seasons/:id/generate-entries`).
`raceEntryGenerator.js` er uden for denne lanes ejerskab (#5246-briefen), så de
tre kan ikke skelnes på `auto_filled_source` uden at ændre den fil. I praksis er
det sjældent støj: sæsonskifte/admin-regenerate rammer typisk tomme løb midt i
en sæsonoperation, ikke løb en manager aktivt spiller — men vær opmærksom på
det ved en måling lige efter et sæsonskifte.

## 4. Måle-SQL

Køres af Claude via Supabase MCP (`SELECT` er nok, ingen skrivning). Erstat
`<vindue-start>` med det relevante starttidspunkt (fx en flip's `app_config.updated_at`,
samme metode som #5136).

### 4.1 Sweep-kørsler: antal, fyld, fejl

```sql
SELECT
  count(*) AS runs,
  count(*) FILTER (WHERE error IS NOT NULL) AS failed_runs,
  sum(entries_written) AS entries_written_total,
  sum(teams_filled) AS teams_filled_total,
  round(avg(entries_written), 1) AS avg_entries_per_run
FROM public.race_entry_generator_runs
WHERE started_at >= '<vindue-start>';
```

Pr. kørsel (til at se 0-fyld-kørsler direkte — #5136 §5's hul):

```sql
SELECT started_at, finished_at, mode, late_fill_hours,
       races_considered, teams_filled, entries_written, error
  FROM public.race_entry_generator_runs
 WHERE started_at >= '<vindue-start>'
 ORDER BY started_at;
```

### 4.2 Auto-fyldte hold pr. kilde (direkte — afløser #5136 §1's `created_at`-heuristik)

```sql
SELECT auto_filled_source,
       count(*) AS entries,
       count(DISTINCT team_id) AS teams,
       count(DISTINCT race_id) AS races
  FROM public.race_entries
 WHERE is_auto_filled = true
   AND auto_filled_at >= '<vindue-start>'
 GROUP BY auto_filled_source
 ORDER BY entries DESC;
```

### 4.3 Selvrettelser — direkte, ikke proxy (afløser #5136 §2's "1 hold"-gæt)

```sql
SELECT
  count(*) AS total_saves,
  count(*) FILTER (WHERE had_auto_filled) AS self_corrections,
  round(100.0 * count(*) FILTER (WHERE had_auto_filled)
        / NULLIF(count(*), 0), 1) AS self_correction_pct,
  count(*) FILTER (WHERE auto_source = 'late_fill') AS from_late_fill,
  count(*) FILTER (WHERE auto_source = 'start_rescue') AS from_start_rescue,
  count(*) FILTER (WHERE auto_source = 'mixed') AS from_mixed
FROM public.race_entry_overrides
WHERE overridden_at >= '<vindue-start>';
```

Selvrettelser pr. løb (til at se om de klumper omkring bestemte startvinduer):

```sql
SELECT race_id, count(*) AS self_corrections,
       min(overridden_at) AS first, max(overridden_at) AS last
  FROM public.race_entry_overrides
 WHERE overridden_at >= '<vindue-start>' AND had_auto_filled = true
 GROUP BY race_id
 ORDER BY self_corrections DESC;
```

### 4.4 Redning ved start vs. late-fill — samme opdeling, nu uden gætteri

```sql
SELECT
  count(*) FILTER (WHERE auto_filled_source = 'late_fill') AS late_fill_entries,
  count(*) FILTER (WHERE auto_filled_source = 'start_rescue') AS start_rescue_entries,
  count(DISTINCT team_id) FILTER (WHERE auto_filled_source = 'late_fill') AS late_fill_teams,
  count(DISTINCT team_id) FILTER (WHERE auto_filled_source = 'start_rescue') AS start_rescue_teams
FROM public.race_entries
WHERE is_auto_filled = true AND auto_filled_at >= '<vindue-start>';
```
