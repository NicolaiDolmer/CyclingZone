# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [docs/MASTERPLAN.md](MASTERPLAN.md). **Vision (ejer 10/7):** verdensklasse-managerspil + økonomisk levebrød — prioritering vejer begge.

## Aktiv styring

> **Flip-bølge #2357 (ejer-go 11/7 aften, ejer så admin-preview først):** talentspejder (`scout_system_enabled`) + faciliteter (`facilities_enabled`) sat live for ALLE — patch note v6.93; flip-PR'en fixer også sæson-cost-wiring (chargeFacilityCosts fulgte compile-konstanten, ikke app_config → drift/staff-løn ville aldrig blive opkrævet). Vi holder øje live første døgn (Sentry + Discord). CZ Pro/Alunta: **ejer gør det 13/7** (#1903). **Arbejdsform (ejer 10/7):** Fable = arkitekt, udførende subagenter på sonnet i worktrees; PR der afventer aftalt justering = draft.

> **Rest fra 10/7:** Sentry CYCLINGZONE-28/29 → 13/7-triage · TdF #2080: ejer vælger dag · #2276 (Div 4-kaskade repareret live) åben til rest-verify · #2288-dashboard ejer-verify som alm. bruger.

> **Ejer-verify-kø:** #2100 loft-projektion (v6.68) på en ung rytter · scouting-fanen #2243 (v6.67) · #2206 rangliste+holdstilling · #2081 slice 1 (PR #2225). **Ejer-klikliste:** #2076 uptime-rest · #2085 mail-kapacitet · #1784 spend-cap · #929 · Alunta-tokens · #1903 CZ Pro testkøb.

> **Økonomi Fase 3 (#1441):** A1+A2+A3+A4b+Plan B merged; faciliteter admin-only bag `app_config.facilities_enabled=false`. **FLIPPET 11/7 aften** (gate #2287 var grøn 10/7; ejer-go efter admin-preview): `facilities_enabled='on'`, announce jf. #2357. Opfølgninger: #2217 staff-kontrakter · #2218 pension→staff · #2219 audit-whitelist. **Klub-UX pre-flip (10/7):** jargon-copy → spiller-sprog (#2289) + Slice 1 (#2292: intro, låste Coming-soon-teasers, ROI i klartekst, sæson-økonomi) MERGED, preview-verificeret EN+DA; **Slice 2 = [#2311](https://github.com/NicolaiDolmer/CyclingZone/issues/2311) (claude:todo, pick-up-klar): tier-preview før køb + facilitets-help/FAQ**. Vercel-preview har ikke mock (#1834) → ejer-gennemklik = lokal dev-server.

> **Talentspejder (spec låst 7/7):** Fase 1+2 merged · **Fase 3 (#2244) SHIPPED til prod 10/7 aften** (#2280+#2281+#2283 merged, migration verificeret applied; gates grønne — audit `docs/audits/2026-07-10-talentspejder-gates.md`); **flag `scout_system_enabled` FLIPPET til 'on' 11/7 aften** — Scouting-central live for alle (v6.93, #2357). #2284 delvist løst via chips (jobConfig-API + batch-navne shippet). Fase 4 gemte filtre #27. Kendt problem: test-konti wipes (#2245, bug/high).

> **Session 11/7 (komprimeret):** #2311, #2328, #2329, #2264, #1894, #1895 m.fl. merged (v6.81-6.87 + v6.89-6.92); detaljer i git-log/issues. **Ejer-verify samlet:** /training i prod (trænbarheds-markører, ugerytme, individuel plan) · dashboard-punkterne i #2328 · #2263 afventer rytter-ID.

> **11-12/7 samlet: natbølge + salve + eftermiddag = 16 PR'er merged (#2365-#2374, #2378-#2382, #2384), 6 migrationer applied & verificeret** ([nat-artifact](audits/night-wave-2026-07-12.md)). Race v3 S1+S2 i prod bag flag off (τ=0.5, alle bånd grønne). **24-holds-invarianten:** rod-årsag fixet (#2187 lukket, selvhelende trim), daglig vagt live (#2379), reparation kørt — 11/15 grupper på 24, resten auto-fuldføres. **Entry-generator:** kører hver time (#2375 lukket efter 2 hotfixes: idempotent diff-skrivning + vacate-før-insert; tomme løb 132→9, resten = bindings-udtømning). Patch note v6.96 live. NYT: #2383 (NotificationsPage-crash, 1 spiller, triage).

> **Race v3 flip-pakke (#2376):** patch note v6.97 + help/FAQ (dagsform, roller-koster, fri rolle, etape-taktik) klar i draft-PR — ejer merger SAMMEN med flip af `race_engine_v3_scoring` (justér version/dato ved flip).

> **📌 Ejer-påmindelser (næste session):** (1) Supabase-dashboard-klik ~5 min: OTP-expiry <1t + leaked password protection — vejledning i #2258-kommentar; lukker #2258+#929. (2) Palmarès-småvalg (#1997-kommentar: win-rate-def, værdi-kurve-slice) — ejer bad om at blive spurgt senere. (3) #1996 del 2 = kort fælles session (plan + dagsorden ligger på issuet, claude:blocked). (4) v3-flip-forudsætninger #2376 = anden session (pick-up-klar).

> **Narrativ design 11/7 (Fable):** spec + content-batch leveret — [specs/2026-07-11-narrative-systems-design.md](superpowers/specs/2026-07-11-narrative-systems-design.md) + [drafts/2026-07-11-narrative-content-batch.md](superpowers/drafts/2026-07-11-narrative-content-batch.md) (recap v2, karrieremål/traits, verdenshistorik+klubmuseum som HoF-afløser, feed). Design-delen af MASTERPLAN-punkt 7 (#1145/#1147); ejer vælger slices (anbefalet S1 palmarès + S2 recap v2). Tier 2-vokabular koordinerer med race-engine-dybde-spec'en.

> **Race-engine-dybde 11/7 (Fable): spec EJER-GODKENDT, klar til pick-up** — [specs/2026-07-11-race-engine-depth-credibility-design.md](superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md). Evidens (#2224): felt-favoritter vinder 82-88 %, 25 % af løb har 4+ samme hold i top 10. Alle 5 §16-beslutninger låst (work-cost A markant; salt A omgående). **Rækkefølge: salt-PR → S0 harness+baseline → S1 work-cost → S2 dagsform → S3 roller/etape #2034 → S4 styrt #1176 → S5 peaks → S6 why-rapport.** Udføres i separate sessions (ejer 11/7).

> **Træning+ungdom-dybde 11/7 (Fable): spec leveret, runde-1-beslutninger LÅST** — [specs/2026-07-11-training-youth-depth-design.md](superpowers/specs/2026-07-11-training-youth-depth-design.md). Kerne: gap-til-loft-drevet vækst (fixer #2262/#1974/#1922 som ét problem), fokus=budget, form 8-12% i race (§11: type-peak NEJ; form-mål låst, tal via harness). 6 faser, alle bag sim+scorecard; eksekvering i separate sessions. Issue-kommentarer postet (#2262/#1922/#1974/#2064/#932/#1137/#958/#1138).

> **Gap-memo 11/7: ALLE 7 §9-beslutninger LÅST (A) samme aften** — [memo m. §10-eksekverings-log](superpowers/specs/2026-07-11-verdensklasse-gap-analyse-strategisk-memo.md). MASTERPLAN omskrevet (ny kø-SSOT). 11 issues oprettet (#2351-#2361); #2224/#2034/#1176/#1997 scopet ind; #2217/#2218 frosset (claude:blocked). Session-disciplin: ≥2 ugentlige v3-sessions indtil S3 live.

> **Race v3 status 12/7 aften:** S3 (#2034) + free_role-UI (#2376) ✅ MERGED (PR #2387/#2386); salt-verify (#2351) ✅. **S4 styrt/DNF (#1176) ✅ BYGGET (session 3, Fable + 3 sonnet-workers): PR [#2393](https://github.com/NicolaiDolmer/CyclingZone/pull/2393) afventer EJER-merge** (indeholder migration `race_incidents` — anvend FØR v3-flip; med flag off rører runtime aldrig tabellen). Kalibreret 3 seeds: DNF 0.39-0.41 %/etape (bånd 0.3-1.5 %), incident-bounds-oracle grøn, flag-off bit-identisk, playwright 27/27. Sample-recaps vist ejer 12/7; patch note/help bundles med flip. Kendt præ-eksisterende rødt bånd (itt) uændret.
>
> **🎯 Next action:** Ejer: **flip-beslutning** (`race_engine_v3_scoring`, mellem to løbsdage) — merge draft-PR [#2385](https://github.com/NicolaiDolmer/CyclingZone/pull/2385) (patch note v6.97 + help + Discord-udkast) SAMMEN med flippet + godkend Discord-tekst ordret; **merge også S4-PR [#2393](https://github.com/NicolaiDolmer/CyclingZone/pull/2393) + anvend migrationen før flippet** (så flipper S1-S4 samlet). Næste Claude-session: **v3 S5 peak-planer** (spec §10). Selvkørende: AI-trim heal-sweep (#2377) · entry-generator hver time. Ejer 13/7: Alunta+CZ Pro (#1903) · flip-bølge-verify (#2357) · /training-verify · 📌 ovenfor.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil: redesign LIVE 2/7 (#2000); rest = hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 10/7 (session-close); fuld historik i git-log + issue-tråde._
