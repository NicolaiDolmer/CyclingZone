# NOW — Aktuel arbejdsstatus

## Aktiv styring
**Masterplan landed 2026-05-19:** `docs/MASTER_PLAN.md` er styringskontrakten for CyclingZone på tværs af Manus, Claude Code og Codex. Frem til sprinten slutter 2026-06-17 har **Monetization Validation** forrang over brand-polish, bot-polish og post-Go betalingsimplementation. Brand Phase 1 er låst, men Brand Phase 2 må ikke trumfe feedback-loopet.

> **Næste session starter med (vælg én):**
> 1. **Bruger-actions før sæson 1 starter Thu 2026-05-21 23:00** (deadline-kritisk, må gøres af bruger):
>    - Sæson 1 prioritets-lister + kalender låses via /admin → Race-katalog
>    - Edition_year for 26 sæson 1-løb (per #502): /admin → Race-katalog → rediger hver række
> 2. **Brand Phase 2 P2 pick** ([#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481), brand-design): start preview-server `brand` (port 4173) → `/logo-explorations.html` → vælg blandt 4 cycling-DNA-koncepter. P1 dark canvas LOCKED på `#0e0f15`. Full state i [`DECISIONS_LOG.md`](docs/brand/DECISIONS_LOG.md).

## Senest leveret
- 2026-05-20: **Admin race-katalog edit (v3.72 — IKKE verificeret end, Refs [#515](https://github.com/NicolaiDolmer/CyclingZone/issues/515)).** Backend PUT /admin/races/:raceId + frontend refactor pushed (commits 5e6fb23 + 8b5d0cb). Frontend live på Vercel. **Railway backend stadig 404 ved session-end (~25 min efter push)** — auto-deploy hænger eller mangler at trigge. Næste session: verificer Railway-endpoint med `curl -X PUT https://cyclingzone-production.up.railway.app/api/admin/races/test` (skal returnere 401, ikke 404), tjek Railway-dashboard for failed deploys. Try/catch i frontend (8b5d0cb) sikrer Gem-knap ikke længere loader uendeligt — viser nu "Endpoint ikke deployet endnu — vent 1-2 min og prøv igen" ved 404. Pre-flight v3.72: 674/674 backend tests grøn, build OK, postmortem i `.claude/learnings/2026-05-20-rls-silent-update-races.md`.
