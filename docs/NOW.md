# NOW — Aktuel arbejdsstatus

> **🟢 Seneste close-outs** (detaljer i git-historik + issues/PRs): **2. juni — GitHub-audit** lukkede 21 issues (8 backend/data + 10 user-feature efter AI-verify via Playwright-mock + 3 glemt-done #532/#719/#646); flyttede #793/#19/#896 til claude:done (dev-færdig, afventer ejer-verify). **Ny skill-kapabilitet:** github-housekeeping Kategori K (glemt-done cross-ref via `Refs #N`) + `crossref.py forgotten_done` ([PR #947](https://github.com/NicolaiDolmer/CyclingZone/pull/947), docs/skill — afventer merge). · **1. juni — Sundhedsaudit:** #876/#882/#878/#879 lukket; 18 rate-limit-alerts dismissed; #1-prod-fejl (`lazyWithRetry`, #883) + review-gate advisory (#884) fixet.

## Aktiv styring

> **🎯 Next action:** **Præmiepenge-audit epic [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893)** — [#898](https://github.com/NicolaiDolmer/CyclingZone/issues/898) datakvalitet ✅ i PR (PRIZE_PER_POINT single-source backend `economyConstants.js`/frontend `expectedPrizeCalculator.js`; result_type-ensretning sheet-sync `Klassiker`→`gc`; GAME_INVARIANTS-notering). **Prod-data var allerede ren:** 0 forældreløse præmie-rækker (FK `ON DELETE SET NULL` gør dem umulige — Fase 1's 4-rækker-fund ej reproducerbart), 0 inkonsistente single-race result_types → ingen migration. 3 under-issues tilbage: ~~[#894](https://github.com/NicolaiDolmer/CyclingZone/issues/894) R2 point-model~~ **✅ v1 merged ([PR #907](https://github.com/NicolaiDolmer/CyclingZone/pull/907), lukket 1. juni)** — kaskade-model (anker + per-kategori-kurveform + faktor pr. kategori×result-type); seed reproducerer dagens point bit-for-bit (bevist 900/900 mod prod); akse-1 ratio-editor udskilt til [#908](https://github.com/NicolaiDolmer/CyclingZone/issues/908) (R2 v1.1). Design: `docs/slices/prize-money-audit-r2-design.md` · ~~[#895](https://github.com/NicolaiDolmer/CyclingZone/issues/895) R3 værdi-ved-udbetaling~~ **✅ merged ([PR #909](https://github.com/NicolaiDolmer/CyclingZone/pull/909), lukket 1. juni)** — `updateRiderValues` genberegnes nu også ved `paySeasonPrizesToDate`; aktiv sæson vejer sin fremgang (`race_days_completed/race_days_total`), gulv `max(Σw,1)` mod annualisering i anker-løs sæson 1; bagudkompatibelt (ingen aktiv sæson → identisk med gammel snit-logik); 6 nye tests grønne. Design: `docs/slices/prize-money-audit-r3-design.md` · ~~[#896](https://github.com/NicolaiDolmer/CyclingZone/issues/896) preview~~ **Kerne merged til main ([PR #910](https://github.com/NicolaiDolmer/CyclingZone/pull/910), 1. juni) — afventer kun ejer-verifikation før close** — `getSeasonPrizePreview` udvidet med optjent-vs-udbetalbar-split (fri/AI synlig), reconciliation pr. betalt løb (Σresults vs Σfinance, ⚠️ ved mismatch) + sanity-warnings (`all_free_ai`/`no_prize_results`); admin-UI renderer dem. Ren additiv beregning, ingen nye queries. Prod-grundet: sæson 1 = optjent 31,3M/udbetalbar 23,1M/fri-AI 8,18M. **Ejer-verify:** admin → Økonomi → Præmieudbetaling → sæson 1 → "Se status" → tjek Sæson-total-boks. #2 forventet-vs-faktisk + #5/#6 udskudt (uden for Kerne-scope) · ~~[#897](https://github.com/NicolaiDolmer/CyclingZone/issues/897) ProSeries-tjek~~ **✅ lukket 1. juni** ([PR #902](https://github.com/NicolaiDolmer/CyclingZone/pull/902) docs): 61/61 seed-ProSeries matcher UCI 2026 1:1, 0 fejl/0 manglende; de 3 afvigelser (Maryland-reklassificering · Tour of Norway + Surf Coast aflyst 2026) passer ikke ind i spillet → ignoreres, ingen seed-rettelse. Plan: `docs/slices/prize-money-audit.md`. **Ingen kode/udbetaling før design godkendt.** Stabilitets-spor: [#792](https://github.com/NicolaiDolmer/CyclingZone/issues/792) test-konto-blokade ✅ **lukket 1. juni** (kerne fixet+live #859/#860, regressionstest grøn; admin-handlers-rest → [#903](https://github.com/NicolaiDolmer/CyclingZone/issues/903)) · [#767](https://github.com/NicolaiDolmer/CyclingZone/issues/767) preview-login ✅ **lukket 1. juni** (ny blocker: Supabase deaktiverede legacy anon-keys → re-enabled i dashboard, login verificeret grøn; prod var aldrig ramt; permanent publishable-key-migration → [#904](https://github.com/NicolaiDolmer/CyclingZone/issues/904)) · åbent: [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SUPABASE_SERVICE_KEY rotation.
>
> **🤖 Working agent:** Ingen aktiv session. **Bemærk:** præmieudbetalinger er bevidst sat på pause indtil præmie-auditen (epic [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893)) er færdig — udbetal IKKE før da.

---

## 🚀 Prioriteret Plan for de Næste 7 Dage (1. juni – 7. juni)

Denne plan fokuserer på at lukke de sidste tekniske huller og gøre klar til Tour de France-kampagnen.

| Dag | Fokus | Opgaver |
| :--- | :--- | :--- |
| **1 - 2** | **Stabilitet & Sikkerhed** | ✅ Test-konto-blokade ([#792](https://github.com/NicolaiDolmer/CyclingZone/issues/792)) + preview-login ([#767](https://github.com/NicolaiDolmer/CyclingZone/issues/767)) lukket 1. juni. Tilbage: regenerering af Supabase-nøgler ([#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691)). (Præmieudbetalinger forbliver på pause til præmie-auditen er færdig — se #893.) |
| **3 - 4** | **Handelsflow** | ✅ Lejeaftaler/buyout uden for transfervinduet ([#19](https://github.com/NicolaiDolmer/CyclingZone/issues/19) Del B) merged + live 1. juni (PR #891, migration kørt mod prod) — afventer kun ejer-verifikation i lukket vindue før close. Test af auktioner med de nye fiktive ryttere ([#669](https://github.com/NicolaiDolmer/CyclingZone/issues/669)). |
| **5 - 6** | **TdF Launch Prep** | Udvikling af ny Landing Page ([#672](https://github.com/NicolaiDolmer/CyclingZone/issues/672)) og opdatering af branding ([#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671)). Opfølgning på UI/UX-audit fund ([#864](https://github.com/NicolaiDolmer/CyclingZone/issues/864)). |
| **7** | **Triage & Polish** | Gennemgang af Discord-bugs ([#775](https://github.com/NicolaiDolmer/CyclingZone/issues/775)-[#788](https://github.com/NicolaiDolmer/CyclingZone/issues/788)). Beslutning om rework af RiderStatsPage ([#794](https://github.com/NicolaiDolmer/CyclingZone/issues/794)). |

### 🚨 Vigtigste Prioriteter:

1.  **Kritiske her-og-nu (Stabilitet & Sikkerhed):**
    *   **#691: SUPABASE_SERVICE_KEY Rotation:** Kritisk for backend-sikkerhed.
    *   **#792: Onboarding-blokade:** Blokerer nye brugere.
    *   ~~**#863 / #848: Lockfile drift**~~ ✅ Løst 1. juni (#876 — var false-positive fra agent-doctor JSON-parse, ikke reel drift).

2.  **TdF Launch-kritiske (Deadline 20. juni):**
    *   **#676: Race Engine V1 Implementation:** Hjertet i spillet, stor teknisk risiko.
    *   **#672: Landing Page Polish:** Første indtryk for nye brugere.
    *   **#864: UI/UX-audit (Clarity data):** Fjerner friktion for brugere.
    *   **#671: Brand Minimum:** Professionelt indtryk ved launch.

3.  **Gameplay & Brugeroplevelse (Vigtige fejl):**
    *   **#820: Bestyrelses-DNA mismatch:** Implementeret lokalt i v4.39 — DNA vælges før board-medlemmer og plan-signering; afventer commit/push.
    *   **#775: Hall of Fame mangler data:** Vigtig social feature.
    *   **#776: Rytter-status "stuck":** Skaber forvirring på markedet.

---

_Opdateret af Claude (Claude Code) den 2. juni 2026 — GitHub-audit close-out (21 lukket + 3 → done + Kategori K skill-fix, PR #947). **Næste session:** (1) ejer-verify af #793/#19/#896 på prod → luk dem; (2) merge docs-PR #947; derefter epic #893-rest (#896 #2/#5/#6 + #908 R2 v1.1) eller launch-kritisk (#676 race engine / #672 landing page). **Afledte opgaver (chips/separate sessioner):** agent-doctor "5 fail/5 warn" oprydning · surface Kategori K i daglig routine-digest (routine-prompt.md + RemoteTrigger)._

> **🗂️ Backlog-note (2. juni):** Founder-brain-dump trieret → #930–#946 oprettet. 7 vision-epics (#930–#936, `post-launch`), mobilapp-beslutning (#937), 3 pre-launch-kandidater (#938 søg / #939 vejr+vind / #940 NPS), 6 founder-issues (#941–#946, `cat:founder`). Bevidst lav prioritet — må IKKE fortrænge launch-backlog før 20. juni. #939 (vejr) bør behandles som sub-scope under race-engine #675/#676.
