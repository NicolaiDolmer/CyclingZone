# UCI scraper decimal-points bug — 319 ryttere downgraded silent

**Dato:** 2026-05-27
**Symptom:** Scheduled UCI Rankings Sync downgraded 319 ryttere (inkl. Vingegaard, Evenepoel, Pidcock, Pedersen, Bernal, Almeida) til 5 UCI-point = 20.000 CZ$. High-value-safety-gate trigger ikke; spillerne måtte pause med at byde.
**PR/fix:** [#700](https://github.com/NicolaiDolmer/CyclingZone/pull/700) merged 2026-05-27 08:15 UTC.

## Hvad skete

1. PCS ændrede sandsynligvis displayformat for UCI individual ranking ~2026-05 — top-ryttere har nu decimaltal-points (Vingegaard 6885.1, Evenepoel 5717.9, etc.) hvor de før var heltal.
2. `procyclingstats` library (`>=0.2.0` i `scripts/requirements_uci.txt`) parser tilsyneladende kun heltal og returnerer `points: 0` silently for decimaltal-rækker. Crasher ikke, logger intet.
3. Vores `sync_supabase` matchede Vingegaard mod hans egen PCS-record → fik `points=0` → `max(MIN_UCI_POINTS, 0) = 5`.
4. **High-value-safety-gate fejlede ved root**: gaten beskytter kun ryttere der havner i `find_uci_match → None` branch (not_found). Da rytteren BLEV matched (bare med en 0-værdi), gik koden gennem `else: matched += 1` og overskrev til 5 uden beskyttelse.
5. 319 ryttere ramt, kun 1 enkelt blev faktisk high-value-protected. 21 blev restored (de ryttere libraryen håndterer korrekt — heltals-points).

## Hvorfor blev det ikke fanget tidligere

- **Forrige sync (2026-05-20)**: gav stadig korrekte tal — PCS ændringen er nyere end 7 dage gammel.
- **Coverage-gate**: kun fail på <2400 ryttere total. 3000 blev hentet, så gate passerede.
- **Mass-downgrade-gate**: 319 < downgrade_limit (869). Gate aktiveres kun ved >10% af DB-ryttere downgraded.
- **Manuel sandbox-test fra mig (Claude)**: jeg burde have flagget 3000-limit som risiko FØR jeg kørte manuel `gh workflow run` ovenpå GitHub's scheduled-delay. Jeg verificerede ikke library-output før jeg løb sync mod prod.

## Fix

Patch i [`scripts/uci_scraper.py:177-242`](../../scripts/uci_scraper.py): efter library-kald, hent samme page via `cloudscraper`, regex-parse `rank → points` fra rå HTML, overskriv library's værdi når HTML har højere tal. Graceful fallback hvis HTML-fetch fejler.

HTML-format: `<td><a href="rider.php?id=NNN&...">POINTS</a></td>` — POINTS er `[\d.]+` så både heltal og decimaler matches.

Forward-guard: 2 unit-tests i `scripts/uci_scraper_test.py`:
- `test_html_regex_extracts_integer_and_decimal_points`
- `test_fetch_page_from_pcs_overrides_library_zero_with_html_decimal`

## Verifikation

Efter fix-sync (workflow_dispatch på fix-branch):
- Vingegaard: 5 → 6885 ✓
- Evenepoel: 5 → 5717 ✓
- Pidcock: 5 → 4175 ✓
- Safety report: `matched=2569, restored_from_minimum=296, minimum_downgrades=0/869` (mod 319 broken downgrades før)
- 296 ryttere restored. 23 forskel er legitime downgrades (ryttere ude af PCS top 3000, alle med popularity=0).

## Læringer

1. **Pin upstream library-versioner**: `procyclingstats>=0.2.0` er en open range. Pin til specifik version (`==X.Y.Z`) og test før upgrade. Silent breaking changes som denne kan ikke fanges af range-pinning.
2. **Safety-gates skal ramme matched-with-zero, ikke kun not-found**: i `sync_supabase`, hvis match returnerer `points <= MIN_UCI_POINTS` for en rytter med `existing_uci_points > 100`, bør samme high-value-protection kicke ind. Match med 0 er sandsynligvis et parsing-problem, ikke en legitim downgrade.
3. **Schedule-events er upålidelige**: GitHub Actions `schedule` har historisk skipped flere onsdage på denne workflow (2026-04-29, 2026-05-06, 2026-05-13). Hvis værdier ikke flytter, antag IKKE at scheduled sync kørte. Tjek run-historik først.
4. **Verificér library-output mod live source FØR du stoler på det**: hvis library siger `points: 0` for en top-2-rytter, så er det utroligt. Vi havde ikke et sanity-check der sagde "rank 2 burde have points > 5000".

## Follow-up (separate issues)

- Backup-trigger til scheduled UCI sync + Discord-alert hvis sidste sync >8 dage gammel.
- Safety-gate udvidelse: matched-with-zero behandles som not_found for high-value ryttere.
- Library pinning + automated test der scraper top-5 og validerer decimal-parse.
