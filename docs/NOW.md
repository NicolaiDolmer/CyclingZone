# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [docs/MASTERPLAN.md](MASTERPLAN.md). **Vision (ejer 10/7):** verdensklasse-managerspil + økonomisk levebrød — prioritering vejer begge.

## Aktiv styring

> **🎯 Next action:** #2256+#2265 PR åben (draft — indeholder migration, ejer-merge-only): greying i race-selection-panelet + racehub-brættet (også uden-for-dagens-kolonner-bindinger) + TOCTOU-hærdet save-guard i `replace_race_selection`. Næste session: review + merge PR'en, derefter Div 4 entry-validering pr. tier (rest af #2256-scope). Prod-tal 10/7: 8 puljer à ~25 hold (2-3 ægte), 17 løb (pulje A: 27 — skævhed skal forklares), 0 GT'er efter #2251-fix. **Arbejdsform (ejer 10/7):** Fable = arkitekt, udførende subagenter på sonnet i worktrees; PR der afventer aftalt justering = draft.

> **Session 10/7 shipped (stabilitets-sporet):** #2251 verificeret rolig (watchdog-kø tom, tier 4 kører); #2252 lukket (allerede fixet juni — chunk-retry #883/#906/#1423; 3 Sentry-grupper resolved); #2253 løst (PR #2272 + #2273 merged, v6.70 — translate-guard indsnævret til 6 crash-udsatte sider, evidens = alle 14 Sentry-events); #2269 rytter-slet-friktion (PR #2271); **#2270 oprettet** (natlig game-day smoke-sim, ejer-godkendt — fanger #2251-klassen i CI); #2228 Sentry-connector verificeret OK → luk efter mandagens (13/7) triage. Known-issues-panel = fælles design-session senere. **TdF #2080: intet postes; ejer vælger dag.** RangeError CYCLINGZONE-27 parkeret (2 events, usymboliseret).

> **Ejer-verify-kø:** #2100 loft-projektion (v6.68) på en ung rytter · scouting-fanen #2243 (v6.67) · #2206 rangliste+holdstilling · #2081 slice 1 (PR #2225). **Ejer-klikliste:** #2076 uptime-rest · #2085 mail-kapacitet · #1784 spend-cap · #929 · Alunta-tokens · #1903 CZ Pro testkøb.

> **Økonomi Fase 3 (#1441):** A1+A2+A3+A4b merged; faciliteter admin-only bag `app_config.facilities_enabled=false`. **Pre-flip Plan B engine-slice (util-udvidelse + training-effekt-wiring + re-harness + flag-migration) skal være grøn FØR flip.** Staged announce: `docs/superpowers/drafts/2026-07-05-facilities-flip-announce.md`. Opfølgninger: #2217 staff-kontrakter · #2218 pension→staff · #2219 audit-whitelist. Vercel-preview har ikke mock (#1834) → ejer-gennemklik = lokal dev-server.

> **Talentspejder (design låst 7/7, spec `docs/superpowers/specs/2026-07-07-talentspejder-design.md`):** Fase 1 merged (#2243, v6.67) · Fase 2 loft-projektion merged (#2100, v6.68) · næste: Fase 3 spejder-system (#2244, m. #2216) · Fase 4 gemte filtre #27. Kendt problem: test-konti wipes i prod (#2245, bug/high).

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil: redesign LIVE 2/7 (#2000); rest = hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 10/7 (session-close); fuld historik i git-log + issue-tråde._
