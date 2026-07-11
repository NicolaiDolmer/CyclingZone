# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [docs/MASTERPLAN.md](MASTERPLAN.md). **Vision (ejer 10/7):** verdensklasse-managerspil + økonomisk levebrød — prioritering vejer begge.

## Aktiv styring

> **Ejer-admin-test-kø (bag #1895):** talentspejder-flip (\`scout_system_enabled\`) + faciliteter-flip (\`facilities_enabled\`, pre-flip-gate #2287 grøn) + #1894 smart default-fokus. **Arbejdsform (ejer 10/7):** Fable = arkitekt, udførende subagenter på sonnet i worktrees; PR der afventer aftalt justering = draft.

> **Session 10/7 (komprimeret):** #2288 dashboard-UX-pakke merged (PR #2296, v6.75; ejer-verify: dashboard som alm. bruger). #2275 merged (v6.71). #2276 Div 4-kaskadebrud repareret live (ejer-godkendt; PR #2277-#2279, 2 postmortems); issue åben til rest-verify. Sentry CYCLINGZONE-28/29 → 13/7-triage. TdF #2080: ejer vælger dag.

> **Ejer-verify-kø:** #2100 loft-projektion (v6.68) på en ung rytter · scouting-fanen #2243 (v6.67) · #2206 rangliste+holdstilling · #2081 slice 1 (PR #2225). **Ejer-klikliste:** #2076 uptime-rest · #2085 mail-kapacitet · #1784 spend-cap · #929 · Alunta-tokens · #1903 CZ Pro testkøb.

> **Økonomi Fase 3 (#1441):** A1+A2+A3+A4b+Plan B merged; faciliteter admin-only bag `app_config.facilities_enabled=false`. **Pre-flip-gaten (#2287) er GRØN (verificeret 10/7:** wiring shippet i PR #2235, harness genkørt grøn efter Fase 3, ingen scouting-dobbeltregning, flag flip-klar) — **flip afventer kun ejer-go:** test som admin → `UPDATE app_config` → staged announce (`docs/superpowers/drafts/2026-07-05-facilities-flip-announce.md`). Opfølgninger: #2217 staff-kontrakter · #2218 pension→staff · #2219 audit-whitelist. **Klub-UX pre-flip (10/7):** jargon-copy → spiller-sprog (#2289) + Slice 1 (#2292: intro, låste Coming-soon-teasers, ROI i klartekst, sæson-økonomi) MERGED, preview-verificeret EN+DA; **Slice 2 = [#2311](https://github.com/NicolaiDolmer/CyclingZone/issues/2311) (claude:todo, pick-up-klar): tier-preview før køb + facilitets-help/FAQ**. Vercel-preview har ikke mock (#1834) → ejer-gennemklik = lokal dev-server.

> **Talentspejder (spec låst 7/7):** Fase 1+2 merged · **Fase 3 (#2244) SHIPPED til prod 10/7 aften** (#2280+#2281+#2283 merged, migration verificeret applied; gates grønne — audit `docs/audits/2026-07-10-talentspejder-gates.md`); flag `scout_system_enabled` off = spillere ser slots; admin-preview on. #2284 delvist løst via chips (jobConfig-API + batch-navne shippet). Fase 4 gemte filtre #27. Kendt problem: test-konti wipes (#2245, bug/high).

> **Session 11/7 (komprimeret):** Formiddag: #2311 Klub-Slice 2 merged (PR #2331) · #2328 dashboard-opfølgninger merged (PR #2330, v6.81; ejer-verify udestår, 5 punkter i issue). Eftermiddag: #2329 transfermarked-sortering merged (PR #2332, v6.82) · patch note-audit → v6.83 (PR #2333) · #2264 akademi-frie-agenter løst m. datareparation (ejer-go, PR #2334, v6.84). Aften: #1974-slice trænbarhedssignal (PR #2335, v6.85; issue åben — rest: #1138 + GT/bakke-klassificering) · #1894 smart default-fokus merged+lukket (PR #2336, v6.86) · #1895 ugerytme + individuel ugeplan SHIPPET+LUKKET (PR #2338+#2339, v6.87; migration applied i prod før merge, ejer-go) · FK-hul fixet (PR #2340) · opfølgning #2337. #2262 urørt per ejer-ønske. **Ejer-verify samlet:** /training i prod (trænbarheds-markører, auto-hint, bulk-smart, Weekly rhythm-panel, individuel plan + "Egen plan"-badge).

> **Session 11/7 (autonom aften, 2t+):** Lukket: #2266 (PR #2346, v6.89) · #2293 (PR #2347, v6.90) · #2284, #2245, #2265 (verificeret allerede shippet — PR #2246/#2275). Merged+**migrationer applied & verificeret i prod**: PR #2345 (#2327 security RPC-grant-revoke) + PR #2348 (#2326 lån-split, v6.91) — begge lukket. #2275-binding-guard bekræftet allerede applied. #2254 delvist fixet (PR #2350, v6.92: landing-badge af-signaleret + compare-tap-target 44px; åben for RaceHub/training/board-findings der kræver DOM-verify) · #2263 undersøgt (ingen bred nulstilling; mangler rytter-ID fra ejer-DM).

> **Narrativ design 11/7 (Fable):** spec + content-batch leveret — [specs/2026-07-11-narrative-systems-design.md](superpowers/specs/2026-07-11-narrative-systems-design.md) + [drafts/2026-07-11-narrative-content-batch.md](superpowers/drafts/2026-07-11-narrative-content-batch.md) (recap v2, karrieremål/traits, verdenshistorik+klubmuseum som HoF-afløser, feed). Design-delen af MASTERPLAN-punkt 7 (#1145/#1147); ejer vælger slices (anbefalet S1 palmarès + S2 recap v2). Tier 2-vokabular koordinerer med race-engine-dybde-spec'en.

> **🎯 Next action:** Ejer-verify i prod: /training (#1894+#1895), rytterprofil højde/vægt+⇄Sammenlign (v6.89), auktions-historik-sort (v6.90), lån-split (v6.91 — lav en delbetaling, se Interest/Principal i Finance-historik). Eftersend rytter-ID til #2263. Åbne fix-kandidater: #2254-rest (RaceHub live-stage klikbar — kræver DOM-verify), #2270/#2274, admin-test-køen (talentspejder/faciliteter-flip).

> **🤖 Working agent:** Claude Code (Fable) — race-engine v2-dybde design-spec (#2224 dominans + #1021/#1176/#2034), startet 11/7 aften.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil: redesign LIVE 2/7 (#2000); rest = hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 10/7 (session-close); fuld historik i git-log + issue-tråde._
