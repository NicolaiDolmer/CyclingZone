# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (22/6 sen): kalender-wiring → final rehearsal → PROMPT-2-relaunch.** Dagens session merged til main: #1703 (div-3 manager-entry + AI-fyld-coverage + phantom-AI-fix) · #1704 (per-division kalender-foundation — **migration LIVE i prod**) · #1705 (altid-åben handel, intet transfervindue) · #1706 (Class 1/2-løb seedet) · #1707 (ruteprofiler synlige før-løb). Patch-notes **v5.93** = PR #1708 (ejer voicer prosa + merger; går live MED reset). **Afgjort:** økonomi #10/#11 = INGEN ændring (harness-bevist: sænkning = konkurser); #1137 progression = flip ON, peakAge=28 ved relaunch; squad-cap = hard-cap ved handel.
> - **KRITISK VEJ:** (1) **kalender-WIRING**: kobl `materializeSeasonCalendar` ind i `relaunchOrchestrator` (efter AI-fyld+0→1) + `transitionToNextSeason` (forever) + `auto_calendar_enabled`-flag — moduler+migration på main; bekræft per-tier-klasse-mix (`DEFAULT_TIER_RACE_CLASSES`). (2) **final rehearsal** på main (`run-relaunch-rehearsal.mjs` mod disposabel klon) → verificér per-division-kalender materialiserer + accept-checks. (3) **PROMPT-2 destruktiv relaunch** (`docs/runbooks/2026-06-22-forever-relaunch-prompts.md`): backup → `seedRacePool --prune` (nu m. Class 1/2) → dry-run → reset (clearAllAiTeams+AI-fyld+kalender) → backfill → flags ON (+ **#1137 peakAge=28**) → post-verify → comms (merge #1708 + Discord).
> - **FAST-FOLLOW efter reset** (ejer: "småting stille og roligt"): Discord #7/#13/#14/#15 · frontend de-slop #3/#4/#8 · ægte højdeprofiler #1021. **Åbne ejer:** #1276 PCM-IP · #929 leaked-pw · #691 key-rotation · #940 NPS. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

> **✅ 18/6-relaunch:** frisk uafhængig sæson 1 LIVE (22 hold, fiktive ryttere, race_engine_v2/daily_training/academy on). Forever-relaunch (epic #1105) = ét sidste reset → permanent; fundamentet er klar. Postmortems: `.claude/learnings/2026-06-18-*`.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701; (a) op/nedrykning gated sæson 3).
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
