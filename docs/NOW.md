# NOW — Aktuel arbejdsstatus

## Aktiv styring
**Masterplan landed 2026-05-19:** `docs/MASTER_PLAN.md` er styringskontrakten for CyclingZone på tværs af Manus, Claude Code og Codex. Frem til sprinten slutter 2026-06-17 har **Monetization Validation** forrang over brand-polish, bot-polish og post-Go betalingsimplementation. Brand Phase 1 er låst, men Brand Phase 2 må ikke trumfe feedback-loopet.

> **Næste session starter med:** **Sæson 1 kalender-design** — brug det nye admin-panel under "🏁 Race-katalog" til at vælge klasser (ekskluder WT for sæson 1), race-days-target, og gennemgå løb individuelt for at sikre rigtigt antal brostens-/enkeltstart-/bjerg-etaper. Skal være låst INDEN torsdag 2026-05-21 23:00 (auto-transition starter sæson 1 med den kalender der ligger). Onsdag aften: kør dress-rehearsal via "🚦 Klar til deadline?"-panelet (dry-run preview + checks-status).

## Senest leveret
- 2026-05-19: **Deadline Day automation + admin readiness (v3.61).** C1 auto-close af transfer-window (cron flipper status open→closed når closes_at < now). C2 auto-transition (sponsor 240K lander ~10-15 min efter window-close). Backend: GET /admin/deadline-readiness + dryRun-mode på season-transition + replace-mode på race-selection. Frontend: ny DeadlineReadinessSection (live system-tjek + dry-run preview + squad violations + counts), RacePoolSection udvidet (race-type-filter + 'sprunget over'-panel + replace-mode). 4 nye FAQ (sæson 0→1 specials, deadline-tidslinje, squad enforcement, sæson 1 kalender). Tests: 22 nye backend, alle grønne. PatchNotes v3.61 EN+DA.
- 2026-05-19: **Session E (fase 1): #479 mobile-perf bundle-split delvist landet** (PatchNotes v3.60). Layout + Clarity SDK + Vercel Analytics + Speed Insights flyttet til lazy chunks. Main bundle 765.6 KB → 737.3 KB (-28 KB raw / -7.8 KB gz). Pre-flight: build + i18n-inline + i18n-keys + playwright core-smoke alle grøn. Issue forbliver open — Lighthouse 90+ target kræver i18n decoupling + standalone /founder-supporter entry som tages i fase 2.
- 2026-05-19: **Session D: #366 PatchNotes v3.59 deployed** (commit 4d54600). Player-facing entry annoncerer fair premium-konversationen til beta-spillere. EN + DA, ~145 ord per sprog, Discord-CTA til `https://discord.gg/ykysBrWUyC`. Pre-flight: build + i18n-namespace-inline + playwright core-smoke alle grøn. Acceptance criteria fra #366 verificeret; bruger laver visuel prod-verifikation efter Vercel-deploy lander.
- 2026-05-19: **Session C: Discord validation loop paste-klar.** `docs/decisions/session-c-discord-validation-loop.md` indeholder konkret `#fair-premium-feedback` channel-opener, første poll, top-player DM-skabelon, interview-flow, logging-template og 48-timers follow-up. PatchNotesPage er ikke opdateret i denne session, fordi ingen app-runtime eller release note blev deployed. #366 er fortsat næste tekniske PatchNotes-session.
- 2026-05-19: **Session B: Naming + premium copy gennemført.** `docs/decisions/session-b-naming-fair-premium-copy.md` låser Free Manager, Premium, Pro Analyst, Patron og Founder som waitlist-status. `BUSINESS_STRATEGY.md` og `TONE_OF_VOICE.md` er afstemt. #366 er klar til implementering uden ny naming-afklaring.
- 2026-05-19: **Status-synk gennemført (Session A, [#497](https://github.com/NicolaiDolmer/CyclingZone/issues/497)).** `SPRINT_DASHBOARD.md` issue-tabel afstemt mod GitHub. Åbne tekniske sprint-issues: #366, #472, #473, #476, #479.
- 2026-05-19: **Masterplan + AI-arbejdsmodel etableret.** `docs/MASTER_PLAN.md` definerer single source of truth, prioriteringsregel frem til 2026-06-17, agentroller og konkrete næste sessioner.
- 2026-05-19: **Brand Phase 1 LOCKED (Refs [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481)).** Final brand foundation: Bebas Neue wordmark, twin lines, dual-form favicon system og sibling-font system.

## Næste sessioner i rækkefølge
1. ~~**Session A: Status-synk og plan-landing ([#497](https://github.com/NicolaiDolmer/CyclingZone/issues/497), Claude Code):** Synkronisér `SPRINT_DASHBOARD.md`, `NOW.md` og relevante issues.~~ ✅ udført + closed 2026-05-19.
2. ~~**Session B: Naming + premium messaging (Manus):** Afgør tier-navne og skriv PatchNotes-, Discord-, survey- og landing-copy.~~ ✅ udført 2026-05-19.
3. ~~**Session C: Discord validation loop (Manus + bruger):** Opret/brug `#fair-premium-feedback`, første poll, top-player DM-skabelon og interview-flow.~~ ✅ paste-klar 2026-05-19.
4. **Session D: #366 PatchNotes implementation (Claude Code/Codex):** Implementér PatchNotes-entry ud fra godkendt copy.
5. ~~**Session E fase 1: #479 mobile-perf bundle-split (Claude Code):** Lazy load Layout + Clarity + Vercel SDK ud af main bundle.~~ ✅ landet 2026-05-19 (v3.60, -28 KB raw). **Fase 2 åben:** i18n provider lazy-load for public routes + evt. standalone /founder-supporter entry — nødvendigt for at hitte mobile Lighthouse 90+ target. Alternativt #500 priority:high naming-runtime-fix.
6. **Session F: Brand Phase 2 (Claude Code):** Kør kun color palette light/dark fra `docs/brand/HANDOFF_PROMPT.md`; genåbn ikke logo/typografi.
7. **Session G: i18n Fase 3.5 (Claude Code):** Status-afstem #412/#484, derefter high priority #485/#486 efter #482-pattern.

## Arbejdsregel
Hvis en agent foreslår arbejde uden for ovenstående rækkefølge, skal den først forklare hvilken P0/P1-sprintværdi eller blocker der retfærdiggør omprioriteringen. Ellers parkeres opgaven.
