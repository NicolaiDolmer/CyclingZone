# Late-fill-måling (#5246)

> Opfølger til assistent-flip-målingen 14/9 ([#5136](https://github.com/NicolaiDolmer/CyclingZone/issues/5136)).
> D-034 (hvornår assistenten skal træde ind på en tom trup) er beskrevet i
> [`docs/ASSISTANT_RULES.md`](ASSISTANT_RULES.md) §1b. Denne fil dækker KUN
> målingen: skemaet #5246 tilføjede + færdige forespørgsler, i samme stil
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
| `race_entry_generator_runs` | Én række pr. faktiske sweep-kørsel (flag ON + aktiv sæson fundet), OGSÅ ved 0 fyld. `started_at`, `finished_at`, `mode` (den EFFEKTIVE tilstand generatoren kørte med), `late_fill_hours`, `races_considered`, `teams_filled` (hold der fik mindst én NY række, ikke alle behandlede), `entries_written`, `error`. |
| `race_entries.auto_filled_at` | `NULL` = manuelt. Sat af en TRIGGER (`race_entries_stamp_auto_fill_trg`) på ethvert insert/update der (gen-)sætter `is_auto_filled`, ryddet når `is_auto_filled=false`. |
| `race_entries.auto_filled_source` | Hvem skrev auto-rækken, se §3 (CHECK-constraint). Sættes eksplicit af skriveren; triggeren giver INGEN default. |
| `race_entry_overrides` | Én række pr. (løb, hold) som et gem erstatter: `replace_race_selection` (ét løb) og `replace_race_selection_bulk` (sæsonmatrixens "Gem plan", én række pr. løb i gemmet). Skrevet FØR delete+insert. `had_auto_filled`, `auto_source` (en kilde fra §3, `'unknown'`, `'mixed'` eller NULL). |

## 3. Kilder

| Kilde | Hvem | Hvor |
|---|---|---|
| `late_fill` | Assistenten fylder et menneskeholds tomme trup kort før start (`assistant_selection_mode=late_fill`) | `raceEntryGeneratorSweep.js` → `raceEntryGenerator.js` |
| `opt_in` | Assistenten fylder et menneskehold der selv har slået den til (`assistant_selection_mode=opt_in`) | Samme sti |
| `start_rescue` | Redning ved løbsstart (hel trup fra nul eller op til gulvet), ikke mode-gated | `raceRunner.js` `fillMissingTeamEntries` |
| `manager_auto` | Managerens egen knap | `POST /races/:raceId/selection/auto` og Race Hubs `POST /races/distribution/regenerate` |
| `ai_generator` | Generatoren fylder et AI-hold (sweep i alle tilstande, sæsonskifte, admin-genvejen) | `raceEntryGenerator.js` |

**`unknown` (NULL-kilde):** alle auto-rækker fra før #5246 har ingen kilde, og det
samme gælder rækker skrevet i vinduet mellem backend-deploy og migrationen (backend
skriver da uden feltet i stedet for at fejle). De tælles som `unknown`, aldrig som
`late_fill`. I `race_entry_overrides` giver erstattede auto-rækker uden kilde
`auto_source='unknown'`; `'mixed'` betyder mindst to forskellige værdier (en kendt
kilde og `unknown` tæller som to).

**Kendt grænse:** managerens egen `POST /races/:raceId/selection/auto` sletter og
genindsætter uden om `replace_race_selection`, så en overskrivning af en late-fill-
trup med knappen giver ingen `race_entry_overrides`-række. Det samme gælder
bulk-gemmets #2637-frigivelser (en auto-udtaget rytter fjernet fra et ANDET løb end
dem gemmet handler om): de logges ikke som selvrettelser.

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

### 4.2 Auto-fyldte menneskehold pr. kilde (direkte — afløser #5136 §1's `created_at`-heuristik)

Kun menneskehold (`teams.user_id IS NOT NULL`): AI-holdenes `ai_generator`-rækker
og `start_rescue` af AI-hold er ikke assistentens arbejde for en manager.

```sql
SELECT COALESCE(e.auto_filled_source, 'unknown') AS source,
       count(*) AS entries,
       count(DISTINCT e.team_id) AS teams,
       count(DISTINCT e.race_id) AS races
  FROM public.race_entries e
  JOIN public.teams t ON t.id = e.team_id
 WHERE e.is_auto_filled = true
   AND t.user_id IS NOT NULL
   AND e.auto_filled_at >= '<vindue-start>'
 GROUP BY 1
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
  count(*) FILTER (WHERE auto_source = 'opt_in') AS from_opt_in,
  count(*) FILTER (WHERE auto_source = 'start_rescue') AS from_start_rescue,
  count(*) FILTER (WHERE auto_source = 'manager_auto') AS from_manager_auto,
  count(*) FILTER (WHERE auto_source = 'unknown') AS from_unknown,
  count(*) FILTER (WHERE auto_source = 'mixed') AS from_mixed
FROM public.race_entry_overrides
WHERE overridden_at >= '<vindue-start>';
```

Assistentens egen selvrettelsesrate pr. enhed (løb, hold). En overskrevet enhed har
ikke længere auto-rækker i `race_entries`, så nævneren er de enheder der STADIG står
som late-fill PLUS de overskrevne (ellers tæller de rettede kun i tælleren, og raten
kan overstige 100 %). Samme forespørgsel med `'opt_in'` giver opt_in-raten.

```sql
WITH remaining AS (
  SELECT count(DISTINCT (e.race_id, e.team_id)) AS n
    FROM public.race_entries e
    JOIN public.teams t ON t.id = e.team_id
   WHERE e.is_auto_filled = true
     AND e.auto_filled_source = 'late_fill'
     AND t.user_id IS NOT NULL
     AND e.auto_filled_at >= '<vindue-start>'
), corrected AS (
  SELECT count(DISTINCT (race_id, team_id)) AS n
    FROM public.race_entry_overrides
   WHERE auto_source = 'late_fill'
     AND overridden_at >= '<vindue-start>'
)
SELECT c.n AS self_corrected_units,
       c.n + r.n AS late_fill_units,
       round(100.0 * c.n / NULLIF(c.n + r.n, 0), 1) AS late_fill_self_correction_pct
  FROM corrected c, remaining r;
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

Kun menneskehold (`teams.user_id IS NOT NULL`), samme grund som 4.2.

```sql
SELECT
  count(*) FILTER (WHERE e.auto_filled_source = 'late_fill') AS late_fill_entries,
  count(*) FILTER (WHERE e.auto_filled_source = 'start_rescue') AS start_rescue_entries,
  count(DISTINCT e.team_id) FILTER (WHERE e.auto_filled_source = 'late_fill') AS late_fill_teams,
  count(DISTINCT e.team_id) FILTER (WHERE e.auto_filled_source = 'start_rescue') AS start_rescue_teams
FROM public.race_entries e
JOIN public.teams t ON t.id = e.team_id
WHERE e.is_auto_filled = true
  AND t.user_id IS NOT NULL
  AND e.auto_filled_at >= '<vindue-start>';
```
