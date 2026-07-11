# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [docs/MASTERPLAN.md](MASTERPLAN.md). **Vision (ejer 10/7):** verdensklasse-managerspil + økonomisk levebrød — prioritering vejer begge.

## Aktiv styring

> **Flip-bølge #2357 (ejer-go 11/7 aften, ejer så admin-preview først):** talentspejder (`scout_system_enabled`) + faciliteter (`facilities_enabled`) sat live for ALLE — patch note v6.93; flip-PR'en fixer også sæson-cost-wiring (chargeFacilityCosts fulgte compile-konstanten, ikke app_config → drift/staff-løn ville aldrig blive opkrævet). Vi holder øje live første døgn (Sentry + Discord). CZ Pro/Alunta: **ejer gør det 13/7** (#1903). **Arbejdsform (ejer 10/7):** Fable = arkitekt, udførende subagenter på sonnet i worktrees; PR der afventer aftalt justering = draft.

> **Rest fra 10/7:** Sentry CYCLINGZONE-28/29 → 13/7-triage · TdF #2080: ejer vælger dag · #2276 (Div 4-kaskade repareret live) åben til rest-verify · #2288-dashboard ejer-verify som alm. bruger.

> **Ejer-verify-kø:** #2100 loft-projektion (v6.68) på en ung rytter · scouting-fanen #2243 (v6.67) · #2206 rangliste+holdstilling · #2081 slice 1 (PR #2225). **Ejer-klikliste:** #2076 uptime-rest · #2085 mail-kapacitet · #1784 spend-cap · #929 · Alunta-tokens · #1903 CZ Pro testkøb.

> **Økonomi Fase 3 (#1441):** A1+A2+A3+A4b+Plan B merged; faciliteter admin-only bag `app_config.facilities_enabled=false`. **FLIPPET 11/7 aften** (gate #2287 var grøn 10/7; ejer-go efter admin-preview): `facilities_enabled='on'`, announce jf. #2357. Opfølgninger: #2217 staff-kontrakter · #2218 pension→staff · #2219 audit-whitelist. **Klub-UX pre-flip (10/7):** jargon-copy → spiller-sprog (#2289) + Slice 1 (#2292: intro, låste Coming-soon-teasers, ROI i klartekst, sæson-økonomi) MERGED, preview-verificeret EN+DA; **Slice 2 = [#2311](https://github.com/NicolaiDolmer/CyclingZone/issues/2311) (claude:todo, pick-up-klar): tier-preview før køb + facilitets-help/FAQ**. Vercel-preview har ikke mock (#1834) → ejer-gennemklik = lokal dev-server.

> **Talentspejder (spec låst 7/7):** Fase 1+2 merged · **Fase 3 (#2244) SHIPPED til prod 10/7 aften** (#2280+#2281+#2283 merged, migration verificeret applied; gates grønne — audit `docs/audits/2026-07-10-talentspejder-gates.md`); **flag `scout_system_enabled` FLIPPET til 'on' 11/7 aften** — Scouting-central live for alle (v6.93, #2357). #2284 delvist løst via chips (jobConfig-API + batch-navne shippet). Fase 4 gemte filtre #27. Kendt problem: test-konti wipes (#2245, bug/high).

> **Session 11/7 (komprimeret):** Formiddag: #2311 Klub-Slice 2 merged (PR #2331) · #2328 dashboard-opfølgninger merged (PR #2330, v6.81; ejer-verify udestår, 5 punkter i issue). Eftermiddag: #2329 transfermarked-sortering merged (PR #2332, v6.82) · patch note-audit → v6.83 (PR #2333) · #2264 akademi-frie-agenter løst m. datareparation (ejer-go, PR #2334, v6.84). Aften: #1974-slice trænbarhedssignal (PR #2335, v6.85; issue åben — rest: #1138 + GT/bakke-klassificering) · #1894 smart default-fokus merged+lukket (PR #2336, v6.86) · #1895 ugerytme + individuel ugeplan SHIPPET+LUKKET (PR #2338+#2339, v6.87; migration applied i prod før merge, ejer-go) · FK-hul fixet (PR #2340) · opfølgning #2337. #2262 urørt per ejer-ønske. **Ejer-verify samlet:** /training i prod (trænbarheds-markører, auto-hint, bulk-smart, Weekly rhythm-panel, individuel plan + "Egen plan"-badge).

> **Session 11/7 (autonom aften, 2t+):** Lukket: #2266 (PR #2346, v6.89) · #2293 (PR #2347, v6.90) · #2284, #2245, #2265 (verificeret allerede shippet — PR #2246/#2275). Merged+**migrationer applied & verificeret i prod**: PR #2345 (#2327 security RPC-grant-revoke) + PR #2348 (#2326 lån-split, v6.91) — begge lukket. #2275-binding-guard bekræftet allerede applied. #2254 delvist fixet (PR #2350, v6.92: landing-badge af-signaleret + compare-tap-target 44px; åben for RaceHub/training/board-findings der kræver DOM-verify) · #2263 undersøgt (ingen bred nulstilling; mangler rytter-ID fra ejer-DM).

> **Narrativ design 11/7 (Fable):** spec + content-batch leveret — [specs/2026-07-11-narrative-systems-design.md](superpowers/specs/2026-07-11-narrative-systems-design.md) + [drafts/2026-07-11-narrative-content-batch.md](superpowers/drafts/2026-07-11-narrative-content-batch.md) (recap v2, karrieremål/traits, verdenshistorik+klubmuseum som HoF-afløser, feed). Design-delen af MASTERPLAN-punkt 7 (#1145/#1147); ejer vælger slices (anbefalet S1 palmarès + S2 recap v2). Tier 2-vokabular koordinerer med race-engine-dybde-spec'en.

> **Race-engine-dybde 11/7 (Fable): spec EJER-GODKENDT, klar til pick-up** — [specs/2026-07-11-race-engine-depth-credibility-design.md](superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md). Evidens (#2224): felt-favoritter vinder 82-88 %, 25 % af løb har 4+ samme hold i top 10. Alle 5 §16-beslutninger låst (work-cost A markant; salt A omgående). **Rækkefølge: salt-PR → S0 harness+baseline → S1 work-cost → S2 dagsform → S3 roller/etape #2034 → S4 styrt #1176 → S5 peaks → S6 why-rapport.** Udføres i separate sessions (ejer 11/7).

> **Træning+ungdom-dybde 11/7 (Fable): spec leveret, runde-1-beslutninger LÅST** — [specs/2026-07-11-training-youth-depth-design.md](superpowers/specs/2026-07-11-training-youth-depth-design.md). Kerne: gap-til-loft-drevet vækst (fixer #2262/#1974/#1922 som ét problem), fokus=budget, form 8-12% i race (§11: type-peak NEJ; form-mål låst, tal via harness). 6 faser, alle bag sim+scorecard; eksekvering i separate sessions. Issue-kommentarer postet (#2262/#1922/#1974/#2064/#932/#1137/#958/#1138).

> **Gap-memo 11/7: ALLE 7 §9-beslutninger LÅST (A) samme aften** — [memo m. §10-eksekverings-log](superpowers/specs/2026-07-11-verdensklasse-gap-analyse-strategisk-memo.md). MASTERPLAN omskrevet (ny kø-SSOT). 11 issues oprettet (#2351-#2361); #2224/#2034/#1176/#1997 scopet ind; #2217/#2218 frosset (claude:blocked). Session-disciplin: ≥2 ugentlige v3-sessions indtil S3 live.

> **🎯 Next action:** Pick-up-klar UDEN ejer: [#2351](https://github.com/NicolaiDolmer/CyclingZone/issues/2351) v3 salt-PR → [#2224](https://github.com/NicolaiDolmer/CyclingZone/issues/2224) S0 harness+baseline; parallelt [#1997](https://github.com/NicolaiDolmer/CyclingZone/issues/1997) palmarès (worktree). **Ejer:** Alunta+testkøb **13/7** (#1903) → Claude åbner salg · verify flip-bølgen live som alm. bruger (Klub + Scouting-central, #2357) · /training (#1894+#1895) + v6.89-6.91-punkterne. Eftersend rytter-ID til #2263.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil: redesign LIVE 2/7 (#2000); rest = hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 10/7 (session-close); fuld historik i git-log + issue-tråde._
