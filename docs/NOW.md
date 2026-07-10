# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT:** [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md). **Rækkefølge-SSOT:** [docs/MASTERPLAN.md](MASTERPLAN.md). **Vision (ejer 10/7):** verdensklasse-managerspil + økonomisk levebrød — prioritering vejer begge.

## Aktiv styring

> **🎯 Next action:** **Ejer: TO admin-tests i prod:** (1) talentspejder (cyclingzone.org → Scouting; beslut flip af \`scout_system_enabled\` — v6.73-patch-note er allerede offentlig! — + tone-session + sanity-tjek rejsepriser 1.000/step + 6.000/mission), (2) faciliteter (køb træningscenter → træningsdag → se løftet; pre-flip-gaten #2287 er grøn → beslut \`facilities_enabled\`-flip + staged announce). Derefter: #2270 eller #2274. **Arbejdsform (ejer 10/7):** Fable = arkitekt, udførende subagenter på sonnet i worktrees; PR der afventer aftalt justering = draft.

> **Session 10/7 sen aften:** #2288 dashboard-UX-pakke → **PR #2296 klar til ejer-review** (v6.74) — ægte onboarding-trin (bud/træning/udtagelse/bestyrelsesplan), banner-prioritering, empty-state CTA'er, "Næste træk"-udvidelse (inkl. "ikke trænet i dag"), holdudtagelse lander på panelet, seneste resultater kun egen division+gruppe. Gates grønne (backend 2972, frontend 1005, core-smoke 27/27). Ejer: review + gennemklik på lokal dev efter merge.

> **Session 10/7 aften:** #2275 merged (greying+save-guard, v6.71; RPC-guard verificeret i prod). **#2276 Div 4-kaskadebrud REPARERET LIVE (ejer-godkendt):** 146 løb slettet, 253 præmie-tilbageførsler (-3,37M, 0 hold i minus), ny identisk kalender i 8/8 puljer (20 løb, tæthed 3, slut 26/7), invarianter i materializer (PR #2277+#2278), 4 live-følgefixes + v6.72 i PR #2279, 2 postmortems. Sentry CYCLINGZONE-2A (transient) resolved; CYCLINGZONE-28/29 → 13/7-triage. #2274 oprettet (monument egen game day). TdF #2080: ejer vælger dag.

> **Ejer-verify-kø:** #2100 loft-projektion (v6.68) på en ung rytter · scouting-fanen #2243 (v6.67) · #2206 rangliste+holdstilling · #2081 slice 1 (PR #2225). **Ejer-klikliste:** #2076 uptime-rest · #2085 mail-kapacitet · #1784 spend-cap · #929 · Alunta-tokens · #1903 CZ Pro testkøb.

> **Økonomi Fase 3 (#1441):** A1+A2+A3+A4b+Plan B merged; faciliteter admin-only bag `app_config.facilities_enabled=false`. **Pre-flip-gaten (#2287) er GRØN (verificeret 10/7:** wiring shippet i PR #2235, harness genkørt grøn efter Fase 3, ingen scouting-dobbeltregning, flag flip-klar) — **flip afventer kun ejer-go:** test som admin → `UPDATE app_config` → staged announce (`docs/superpowers/drafts/2026-07-05-facilities-flip-announce.md`). Opfølgninger: #2217 staff-kontrakter · #2218 pension→staff · #2219 audit-whitelist. Vercel-preview har ikke mock (#1834) → ejer-gennemklik = lokal dev-server.

> **Talentspejder (spec låst 7/7):** Fase 1+2 merged · **Fase 3 (#2244) SHIPPED til prod 10/7 aften** (#2280+#2281+#2283 merged, migration verificeret applied; gates grønne — audit `docs/audits/2026-07-10-talentspejder-gates.md`); flag `scout_system_enabled` off = spillere ser slots; admin-preview on. #2284 delvist løst via chips (jobConfig-API + batch-navne shippet). Fase 4 gemte filtre #27. Kendt problem: test-konti wipes (#2245, bug/high).

> **Parallel PR 10/7:** [#2290](https://github.com/NicolaiDolmer/CyclingZone/issues/2290) tabel-sortering — 4 spiller-huller (træning-roster, manager-trup, løbs-bibliotek+verden) gjort sorterbare via delt `useTableSort`/`SortableTh`, + forward-guard (`tableSortIntent.test.js`: hver tabel skal erklære `data-sortable`/`data-sort-exempt`). v6.74. PR afventer ejer-merge.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: #1152 afventer godkendelse. Rytterprofil: redesign LIVE 2/7 (#2000); rest = hero/rating #2006 + højde/vægt+compare #2266.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 10/7 (session-close); fuld historik i git-log + issue-tråde._
