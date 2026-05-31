# NOW — Aktuel arbejdsstatus

> **🟢 Seneste close-outs** (detaljer i git-historik + issues/PRs): **31. maj** — **[#669](https://github.com/NicolaiDolmer/CyclingZone/issues/669) fiktive ryttere V1 + admin-gated live-test** (generator PR [#847](https://github.com/NicolaiDolmer/CyclingZone/pull/847) + admin-gate PR [#850](https://github.com/NicolaiDolmer/CyclingZone/pull/850)): deterministisk generator (seeded PRNG, rolle-arketyper, `pcm_id` NULL = egen-markør), bevist via PGlite-integrationstest; **25 fiktive ryttere live i prod, RLS-gated** (`pcm_id IS NOT NULL OR is_admin()`) så kun admin ser dem — verificeret via rolle-impersonation (anon/ikke-admin: 0, admin: 25, alle ser stadig 8.699 PCM). Ejer-verify: ser fine ud ✅, auktion-test pending. Slice-doc: `docs/slices/669-fictional-riders.md`. · **[#19](https://github.com/NicolaiDolmer/CyclingZone/issues/19) Del A** handel udenfor transfervinduet (offers+swaps+listing, "betal nu, registrér ved åbning") — PR [#851](https://github.com/NicolaiDolmer/CyclingZone/pull/851), v4.30, **afventer review+merge**; epic forbliver åbent til Del B (loans, kræver migration). Desuden tre lette backlog-bugs merged + live (egne squash-PRs, prod HTTP 200): **[#777](https://github.com/NicolaiDolmer/CyclingZone/issues/777)** ejer-filter på rytter-rangliste — fri-agenter er nu egen kategori (ikke "Manager-ejede") + nyt "Fri agenter"-filter (PR [#840](https://github.com/NicolaiDolmer/CyclingZone/pull/840), v4.25) · **[#823](https://github.com/NicolaiDolmer/CyclingZone/issues/823)** Sæson Snapshot-kalender dato-sorteret i stedet for alfabetisk + pointudviklings-graf synkroniseret (PR [#841](https://github.com/NicolaiDolmer/CyclingZone/pull/841), v4.26) · **[#825](https://github.com/NicolaiDolmer/CyclingZone/issues/825)** rangliste-kontrast — promotion-zone + eget-hold-guld bruger nu tema-tokens i stedet for hardkodede farver (PR [#842](https://github.com/NicolaiDolmer/CyclingZone/pull/842), v4.27, **afventer ejer-visuel-verify i begge temaer**). Alle øvrige `claude:done`. · Tidligere 31. maj: **[#834](https://github.com/NicolaiDolmer/CyclingZone/pull/834)** Discord-triage dedupe-fix + **[#768](https://github.com/NicolaiDolmer/CyclingZone/pull/768)** dependabot `fast-xml-parser` 4.5.6→5.7.0. **30. maj** — **[#718](https://github.com/NicolaiDolmer/CyclingZone/issues/718)** Node 24 pinnet end-to-end (lokal+CI+Vercel/Railway, PR [#807](https://github.com/NicolaiDolmer/CyclingZone/pull/807)) · #796 navn/nation/hold i separate kolonner (v4.19) · #780 rytter-resultathistorik (v4.17) · #793 sæson-historik = spil-sæson (v4.18) · #668 PCM-resultatpipeline (v4.15) · #678 HallOfFame EN · #800 holdnavn klikbart (v4.21) · #799 sticky navnekolonne (v4.23) · #801 badges→ikon+tooltip (v4.24) · #805 board-test-mode/frosset økonomi (v4.22) · #804 sæson-race-days backfill (v4.20).

> **📚 Arkiv:** Ældre detaljer (≤29. maj) i git-historik (NOW.md pr. dato) + `docs/archive/NOW-2026-05-22.md`→`-26.md` + GitHub issues/PRs.

## Aktiv styring

> **🎯 Next action:** **[#792](https://github.com/NicolaiDolmer/CyclingZone/issues/792) test-konto-blokade** — test-konto går i stå ved opret hold/manager (hypotese: konto har allerede team-row). Åbner test-/preview-verify-loopet. Alternativ: lette Discord-bugs (#776 zombie market-status, #781/#782 sejr-klassifikation, #822, #830) eller TdF-launch high-prio (#672 landing, #671 brand-minimum; #670 UI/UX-audit leveret + quick-wins merged PR #862, datadrevet halvdel + tunge fund = follow-up #863 når Clarity er connected).
>
> _(31. maj close-out: **[#670](https://github.com/NicolaiDolmer/CyclingZone/issues/670) UI/UX-audit** leveret — kode/flow-forankret audit (Clarity MCP ikke connected, så ingen rage/dead-click-data; afventer din hånd). 10 fund posted på #670. 3 quick-wins **merged** PR [#862](https://github.com/NicolaiDolmer/CyclingZone/pull/862), v4.34: auktion-saldo-fejl + auktionshistorik-tid EN-leak lukket, reset-password 2s→5s polling. Datadrevet halvdel (Clarity) + tunge fund (RacesPage/RacePointsPage fuld i18n, alert→toast, mit-hold-markering) = follow-up [#864](https://github.com/NicolaiDolmer/CyclingZone/issues/864). Lokal verify grøn: 138 frontend-tests, build, playwright core-smoke ×3, i18n-checks.)_
>
> _(31. maj close-out: **[#837](https://github.com/NicolaiDolmer/CyclingZone/issues/837) rytter-badges v2** færdig — PR [#857](https://github.com/NicolaiDolmer/CyclingZone/pull/857), v4.32, afventer review+merge. Tekst-labels i egen "Status"-kolonne på 5 sider, fælles `riderAge.js` for U23/U25 fra birthdate. Verificeret inkl. umasket visuel kontrol.)_
>
> **🗓️ Brugerens plan (30. maj):** (1) backlog-nedbringning — få de mange åbne opgaver lavet + fulgt op på ALLE · (2) workflow-professionalisering · (3) løbende prioritér det mest værdiskabende mod **test + launch**.
>
> **Afventer ejer-verify på live** (logget-ind sider, test-password er secret) → så lukkes de: **#670** UI/UX quick-wins (PR #862, v4.34, **merged+live** — EN-mode: byd over balance → engelsk fejl; /auctions/history tid = "Just now/5m ago"; reset-password på langsom forbindelse afviser ikke gyldigt link) · **#826** Head-to-Head Top5 viser nu optjente løb-point ikke statisk UCI-rating (PR #858, v4.33 — vælg to hold m. ryttere der har scoret; tal ≠ 0) · **#837** rytter-badges v2 (PR #857, v4.32 — tjek Status-kolonne med U23/U25/AI/IND/UD på /riders /watchlist /team /rankings + EGEN/KØBT/SOLGT på /auctions/history, **begge temaer**; skift til EN → IN/OUT) · **#855** evne-farve-gradient (PR #856, v4.31 — tjek samme værdi = samme farve på /riders /team /transfers /auctions /watchlist + rytter-side + /compare i **begge temaer**) · **#777** ejer-filter · **#823** kalender-sort · **#825** rangliste-kontrast (tjek begge temaer) · #799 sticky navnekolonne · #801 badges · #800 holdnavn · #796 kolonner · #780 resultat-fane · #793 sæson-fane · #804 sæson-fremgang (dashboard viser 22/60) · #805 board-test-mode (allerede prod-verificeret).
>
> **Backlog-kandidater:** **[#19](https://github.com/NicolaiDolmer/CyclingZone/issues/19) Del B** loans+buyout udenfor transfervinduet (kræver `window_pending`-migration på `loan_agreements` + AskUserQuestion om migrations-timing — følge-PR til #851) · **[#792](https://github.com/NicolaiDolmer/CyclingZone/issues/792)** test-konto går i stå ved opret hold/manager (top — hypotese: konto har allerede team-row) · flere lette Discord-bugs #775-788 (#776 zombie market-status, #781/#782 sejr-klassifikation, #822 rytter på transferliste efter auktion, #830 notif-badge ulæste) · **[#794](https://github.com/NicolaiDolmer/CyclingZone/issues/794)** RiderStatsPage rework (`needs-decision`). **TdF-launch high-prio:** #670 UI/UX-audit · #672 landing · #671 brand-minimum · #669 fiktive ryttere V1.
>
> **⚠️ Secret-leak 30. maj → plan i [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691).** `infisical secrets --plain` lækkede `SUPABASE_SERVICE_KEY` + `TEST_ACCOUNT_PASSWORD` (3. leak efter #296/#620). Hook-hul lukket samme dag (`block-dangerous-secret-commands` blokerer nu kategorisk `infisical secrets/export`; postmortem i `.claude/learnings/`). **DIN HÅND afventer:** regenerér SERVICE_KEY i Supabase-dashboard når du orker (Del A); Del B (strukturelt deny→allow) + Del C (stale anon-key) kan automatiseres.
>
> **Verify-kø (#627, baggrund — kræver DIN hånd):** **#505** race_points editor (mangler 60-sek admin-klik i prod) · **#449** Discord-DM: rotér webhooks + verificér `DISCORD_BOT_TOKEN` på Railway · **#563** OneDrive secret-decommission `needs-decision` · **#327** secret mgmt Phase 2 `manual:user`.
>
> **🤖 Working agent:** _Ingen aktiv session._ **Afventer din hånd:** (1) **[#669](https://github.com/NicolaiDolmer/CyclingZone/issues/669) fiktive ryttere** — test bud på en af de 25 admin-gatede ryttere i prod (auktion-gate skal afvise ikke-admin med 403); ved feedback justeres generator-kalibrering (star-rate/rolle-svagheder, noteret i slice-doc). Fjern alle med ét `DELETE FROM riders WHERE pcm_id IS NULL`. · (2) Admin → Økonomi → Præmieudbetaling — **11.899.500 CZ$ udestående til ejede hold, 0 udbetalt** (med confirm-dialog). **i18n-spor:** kun Race/Results-klynge (~320 strenge) tilbage, bevidst udskudt til race-engine [#676](https://github.com/NicolaiDolmer/CyclingZone/issues/676); #678 forbliver åben.


---

## 🚀 Prioriteret Plan for de Næste 7 Dage (1. juni – 7. juni)

Denne plan fokuserer på at lukke de sidste tekniske huller og gøre klar til Tour de France-kampagnen.

| Dag | Fokus | Opgaver |
| :--- | :--- | :--- |
| **1 - 2** | **Stabilitet & Sikkerhed** | Fix af test-konto blokade ([#792](https://github.com/NicolaiDolmer/CyclingZone/issues/792)). Regenerering af Supabase-nøgler ([#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691)). Gennemførsel af udestående præmieudbetalinger via Admin-panel. |
| **3 - 4** | **Handelsflow (Del B)** | Implementering af lejeaftaler (loans) uden for transfervinduet ([#19](https://github.com/NicolaiDolmer/CyclingZone/issues/19)). Test af auktioner med de nye fiktive ryttere ([#669](https://github.com/NicolaiDolmer/CyclingZone/issues/669)). |
| **5 - 6** | **TdF Launch Prep** | Udvikling af ny Landing Page ([#672](https://github.com/NicolaiDolmer/CyclingZone/issues/672)) og opdatering af branding ([#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671)). Opfølgning på UI/UX-audit fund ([#864](https://github.com/NicolaiDolmer/CyclingZone/issues/864)). |
| **7** | **Triage & Polish** | Gennemgang af Discord-bugs ([#775](https://github.com/NicolaiDolmer/CyclingZone/issues/775)-[#788](https://github.com/NicolaiDolmer/CyclingZone/issues/788)). Beslutning om rework af RiderStatsPage ([#794](https://github.com/NicolaiDolmer/CyclingZone/issues/794)). |

### 🚨 Vigtigste Prioriteter:

1.  **Kritiske her-og-nu (Stabilitet & Sikkerhed):**
    *   **#691: SUPABASE_SERVICE_KEY Rotation:** Kritisk for backend-sikkerhed.
    *   **#792: Onboarding-blokade:** Blokerer nye brugere.
    *   **#863 / #848: Lockfile drift:** Skaber ustabilitet i builds.

2.  **TdF Launch-kritiske (Deadline 20. juni):**
    *   **#676: Race Engine V1 Implementation:** Hjertet i spillet, stor teknisk risiko.
    *   **#672: Landing Page Polish:** Første indtryk for nye brugere.
    *   **#864: UI/UX-audit (Clarity data):** Fjerner friktion for brugere.
    *   **#671: Brand Minimum:** Professionelt indtryk ved launch.

3.  **Gameplay & Brugeroplevelse (Vigtige fejl):**
    *   **#820: Bestyrelses-DNA mismatch:** Frustrerende for managers.
    *   **#775: Hall of Fame mangler data:** Vigtig social feature.
    *   **#776: Rytter-status "stuck":** Skaber forvirring på markedet.

---

_Opdateret af Manus AI den 1. juni 2026._
