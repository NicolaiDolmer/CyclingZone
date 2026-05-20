# NOW — Aktuel arbejdsstatus

## Aktiv styring
**Masterplan landed 2026-05-19:** `docs/MASTER_PLAN.md` er styringskontrakten for CyclingZone på tværs af Manus, Claude Code og Codex. Frem til sprinten slutter 2026-06-17 har **Monetization Validation** forrang over brand-polish, bot-polish og post-Go betalingsimplementation. Brand Phase 1 er låst, men Brand Phase 2 må ikke trumfe feedback-loopet.

> **Næste session starter med (vælg én):**
> 1. **Bruger-actions før sæson 1 starter Thu 2026-05-21 23:00** (deadline-kritisk, må gøres af bruger):
>    - Sæson 1 prioritets-lister + kalender låses via /admin → Race-katalog
>    - Edition_year for 26 sæson 1-løb (per #502): /admin → Race-katalog → rediger hver række
> 2. **Brand Phase 2 P2 pick** ([#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481), brand-design): start preview-server `brand` (port 4173) → `/logo-explorations.html` → vælg blandt 4 cycling-DNA-koncepter. P1 dark canvas LOCKED på `#0e0f15`. Full state i [`DECISIONS_LOG.md`](docs/brand/DECISIONS_LOG.md).

## Senest leveret
- 2026-05-20: **Admin race-katalog edit gemmer nu rigtigt (v3.72, Refs [#515](https://github.com/NicolaiDolmer/CyclingZone/issues/515)).** /admin → Løbskalender → ✏ Rediger smed lydløst ændringer væk (navn, klasse, type, etaper, edition_year) — UI'et viste "Løb gemt" men databasen var uændret. Rod-årsag: `AdminPage.jsx:saveRaceEdit` skrev direkte via `supabase.from("races").update()` fra klienten, og `races`-tabellen har KUN en SELECT-policy under RLS (verificeret via `pg_policies`). Fix: nyt `PUT /api/admin/races/:raceId` backend-endpoint (requireAdmin + adminWriteLimiter + race_edited audit-log med before/after); frontend refactored til at kalde det. Migration `2026-05-20-race-edited-admin-action.sql` applied til prod. Pre-flight: 674/674 backend tests grøn (op fra 667, +7 nye source-parsing tests i `raceEditAdminRoute.test.js`), build OK, lint 0 errors / 26 warnings (baseline), playwright 3/3 grøn, i18n keys OK. Fjerner blokeringen for bruger-flowet "fyld edition_year ind for 26 sæson 1-løb" inden sæson 1 starter 2026-05-21 23:00.
