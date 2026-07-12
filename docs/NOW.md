# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [docs/MASTERPLAN.md](MASTERPLAN.md). **Vision (ejer 10/7):** verdensklasse-managerspil + økonomisk levebrød — prioritering vejer begge.

## Aktiv styring

> **Flip-bølge #2357 (ejer-go 11/7 aften, ejer så admin-preview først):** talentspejder (`scout_system_enabled`) + faciliteter (`facilities_enabled`) sat live for ALLE — patch note v6.93; flip-PR'en fixer også sæson-cost-wiring (chargeFacilityCosts fulgte compile-konstanten, ikke app_config → drift/staff-løn ville aldrig blive opkrævet). Vi holder øje live første døgn (Sentry + Discord). CZ Pro/Alunta: **ejer gør det 13/7** (#1903). **Arbejdsform (ejer 10/7):** Fable = arkitekt, udførende subagenter på sonnet i worktrees; PR der afventer aftalt justering = draft.

> **Rest fra 10/7:** Sentry CYCLINGZONE-28/29 → 13/7-triage · TdF #2080: ejer vælger dag · #2276 (Div 4-kaskade repareret live) åben til rest-verify · #2288-dashboard ejer-verify som alm. bruger.

> **Ejer-verify-kø:** #2100 loft-projektion (v6.68) på en ung rytter · scouting-fanen #2243 (v6.67) · #2206 rangliste+holdstilling · #2081 slice 1 (PR #2225). **Ejer-klikliste:** #2076 uptime-rest · #2085 mail-kapacitet · #1784 spend-cap · #929 · Alunta-tokens · #1903 CZ Pro testkøb.

> **Økonomi Fase 3 (#1441):** A1+A2+A3+A4b+Plan B merged; faciliteter admin-only bag `app_config.facilities_enabled=false`. **FLIPPET 11/7 aften** (gate #2287 var grøn 10/7; ejer-go efter admin-preview): `facilities_enabled='on'`, announce jf. #2357. Opfølgninger: #2217 staff-kontrakter · #2218 pension→staff · #2219 audit-whitelist. **Klub-UX pre-flip (10/7):** jargon-copy → spiller-sprog (#2289) + Slice 1 (#2292: intro, låste Coming-soon-teasers, ROI i klartekst, sæson-økonomi) MERGED, preview-verificeret EN+DA; **Slice 2 = [#2311](https://github.com/NicolaiDolmer/CyclingZone/issues/2311) (claude:todo, pick-up-klar): tier-preview før køb + facilitets-help/FAQ**. Vercel-preview har ikke mock (#1834) → ejer-gennemklik = lokal dev-server.

> **Talentspejder (spec låst 7/7):** Fase 1+2 merged · **Fase 3 (#2244) SHIPPED til prod 10/7 aften** (#2280+#2281+#2283 merged, migration verificeret applied; gates grønne — audit `docs/audits/2026-07-10-talentspejder-gates.md`); **flag `scout_system_enabled` FLIPPET til 'on' 11/7 aften** — Scouting-central live for alle (v6.93, #2357). #2284 delvist løst via chips (jobConfig-API + batch-navne shippet). Fase 4 gemte filtre #27. Kendt problem: test-konti wipes (#2245, bug/high).

> **Session 11/7 (komprimeret):** #2311, #2328, #2329, #2264, #1894, #1895 m.fl. merged (v6.81-6.87 + v6.89-6.92); detaljer i git-log/issues. **Ejer-verify samlet:** /training i prod (trænbarheds-markører, ugerytme, individuel plan) · dashboard-punkterne i #2328 · #2263 afventer rytter-ID.

> **NATBØLGE 11-12/7 (Fable + 9 sonnet-agenter): 10 grønne PR'er #2365-#2374, 0 merged (aftalt morgen-salve).** Fuld rækkefølge + ejer-beslutninger: [docs/audits/night-wave-2026-07-12.md](audits/night-wave-2026-07-12.md). 🔴 FØRST: PR #2372 (security — 11 RPC'er var reelt PUBLIC-kaldbare trods #2345; merge+apply STRAKS). Race v3: S1 #2369 kalibreret+reviewet klar; S2 #2370 draft m. beslutningsgrundlag (probe: τ=0.5-kompression rammer favorit-båndet, ren varians kan ikke — anbefaling option 2). Palmarès #2368 draft m. screenshots. Sentry 28/29 resolved; #2149 lukket; NYT #2375 (kapacitets-gate, needs-decision).

> **Narrativ design 11/7 (Fable):** spec + content-batch leveret — [specs/2026-07-11-narrative-systems-design.md](superpowers/specs/2026-07-11-narrative-systems-design.md) + [drafts/2026-07-11-narrative-content-batch.md](superpowers/drafts/2026-07-11-narrative-content-batch.md) (recap v2, karrieremål/traits, verdenshistorik+klubmuseum som HoF-afløser, feed). Design-delen af MASTERPLAN-punkt 7 (#1145/#1147); ejer vælger slices (anbefalet S1 palmarès + S2 recap v2). Tier 2-vokabular koordinerer med race-engine-dybde-spec'en.

> **Race-engine-dybde 11/7 (Fable): spec EJER-GODKENDT, klar til pick-up** — [specs/2026-07-11-race-engine-depth-credibility-design.md](superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md). Evidens (#2224): felt-favoritter vinder 82-88 %, 25 % af løb har 4+ samme hold i top 10. Alle 5 §16-beslutninger låst (work-cost A markant; salt A omgående). **Rækkefølge: salt-PR → S0 harness+baseline → S1 work-cost → S2 dagsform → S3 roller/etape #2034 → S4 styrt #1176 → S5 peaks → S6 why-rapport.** Udføres i separate sessions (ejer 11/7).

> **Træning+ungdom-dybde 11/7 (Fable): spec leveret, runde-1-beslutninger LÅST** — [specs/2026-07-11-training-youth-depth-design.md](superpowers/specs/2026-07-11-training-youth-depth-design.md). Kerne: gap-til-loft-drevet vækst (fixer #2262/#1974/#1922 som ét problem), fokus=budget, form 8-12% i race (§11: type-peak NEJ; form-mål låst, tal via harness). 6 faser, alle bag sim+scorecard; eksekvering i separate sessions. Issue-kommentarer postet (#2262/#1922/#1974/#2064/#932/#1137/#958/#1138).

> **Gap-memo 11/7: ALLE 7 §9-beslutninger LÅST (A) samme aften** — [memo m. §10-eksekverings-log](superpowers/specs/2026-07-11-verdensklasse-gap-analyse-strategisk-memo.md). MASTERPLAN omskrevet (ny kø-SSOT). 11 issues oprettet (#2351-#2361); #2224/#2034/#1176/#1997 scopet ind; #2217/#2218 frosset (claude:blocked). Session-disciplin: ≥2 ugentlige v3-sessions indtil S3 live.

> **Race v3 status 11/7 aften:** salt (#2351) ✅ lukket (verify næste løbsdag: nye runs har `salt_version=1`). **S0 harness+baseline (#2224) ✅ MERGED** (PR #2364, Fable-arkitekt + 3 sonnet-subagenter i worktree): dominans-metrik-lib + prod-population-snapshot (committet, 368 hold/5.650 ryttere) + sektion F-scorecard (`--enforce-dominance` = gate fra S1). **Baseline dokumenteret:** [docs/audits/2026-07-11-race-v3-s0-baseline.md](audits/2026-07-11-race-v3-s0-baseline.md) — max sæson-win-rate 87-89 % (bånd ≤45), hjælper-tab 0 (mål 10-30); reproducerer prod-symptomet. Issue #2224 åben (S1+S2 løser det). Sidefix: stale audit-whitelist `training_week_plans` fjernet (chore på main).
>
> **🎯 Next action:** **MORGEN-SALVE:** merge nattens 10 PR'er i rækkefølgen fra [night-wave-artifact'en](audits/night-wave-2026-07-12.md) — #2372 security FØRST (apply migration straks), migrations-PR'er (#2365/#2369/#2371/#2372) applies manuelt af ejer, done-flip pr. merge. **Ejer-beslutninger:** S2 varians-vej (anbefalet: τ=0.5) · palmarès-undraft efter visuelt kig · #2375/#1996-valg. Derefter: Alunta+testkøb 13/7 (#1903) · flip-bølge-verify (#2357) · /training-verify.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil: redesign LIVE 2/7 (#2000); rest = hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 10/7 (session-close); fuld historik i git-log + issue-tråde._
