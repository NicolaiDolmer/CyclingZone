# NOW — Aktuel arbejdsstatus

> **🟢 Seneste close-outs** (detaljer i git-historik + issues/PRs): **1. juni — Sundhedsaudit** (Sentry + GitHub code-scanning + sidste 24t live + AI-opsætning på ny PC DOLMERPC): lockfile-drift false-positive fixet ([#876](https://github.com/NicolaiDolmer/CyclingZone/pull/876); lukkede spam-issues #835/#848/#863/#871/#875), 18 rate-limiting code-scanning-alerts triaget + dismissed (admin-gated false-positives; writes allerede rate-limited), Sentry-læseadgang genoprettet (officiel MCP + token-backbone `npm run audit:sentry`), og Sentrys #1-prod-fejl (stale-chunk efter deploy) fixet via `lazyWithRetry` ([#883](https://github.com/NicolaiDolmer/CyclingZone/pull/883)). · **AI-Autopilot review-gate gjort advisory igen** ([#884](https://github.com/NicolaiDolmer/CyclingZone/pull/884), erstattede #880): den obligatoriske fail-closed gate (#877) blokerede legitime PR'er på Anthropic-kvote i launch-ugen — `continue-on-error: true`, så de deterministiske checks (backend-tests/frontend-build/dependency-review) er de hårde gates. Audit-follow-ups: **#882 (achievements multi-row) ✅ lukket 1. juni** — rod-årsag var allerede fixet i prod (commit `55fd22d`, board_profiles `.maybeSingle()`→`readMany`), 0 events i 5 dage, regression-test grøn; afledte follow-ups #886 (Sentry write-token / auto-resolve) + #887 (close-protokol: AI lukker selv 100%-verificerede). **#878 (board/dna atomicitet) ✅ lukket 1. juni** — begge write-then-derive-sites nu atomiske: route-stien ([#889](https://github.com/NicolaiDolmer/CyclingZone/pull/889), `chooseDnaForTeam`) + auto-accept-cron-stien ([#890](https://github.com/NicolaiDolmer/CyclingZone/pull/890), rollback ved regenerate-fejl); backwards-check bekræfter ingen tredje forekomst. #879 (pagination) ✅ merged ([#885](https://github.com/NicolaiDolmer/CyclingZone/pull/885)).

## Aktiv styring

> **🎯 Next action:** **Præmiepenge end-to-end-audit — epic [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893)** (ejer: nu vigtigste opgave). Fase 1 kørt; 5 under-issues klar til session-fordeling: [#894](https://github.com/NicolaiDolmer/CyclingZone/issues/894) R2 point-model · [#895](https://github.com/NicolaiDolmer/CyclingZone/issues/895) R3 værdi-ved-udbetaling · [#896](https://github.com/NicolaiDolmer/CyclingZone/issues/896) preview · [#897](https://github.com/NicolaiDolmer/CyclingZone/issues/897) ProSeries-tjek · [#898](https://github.com/NicolaiDolmer/CyclingZone/issues/898) datakvalitet. Plan: `docs/slices/prize-money-audit.md`. **Ingen kode/udbetaling før design godkendt.** Stabilitets-spor stadig åbne: [#792](https://github.com/NicolaiDolmer/CyclingZone/issues/792) test-konto-blokade · [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SUPABASE_SERVICE_KEY rotation.
>
> **🤖 Working agent:** Ingen aktiv session. **Bemærk:** præmieudbetalinger er bevidst sat på pause indtil præmie-auditen (epic [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893)) er færdig — udbetal IKKE før da.

---

## 🚀 Prioriteret Plan for de Næste 7 Dage (1. juni – 7. juni)

Denne plan fokuserer på at lukke de sidste tekniske huller og gøre klar til Tour de France-kampagnen.

| Dag | Fokus | Opgaver |
| :--- | :--- | :--- |
| **1 - 2** | **Stabilitet & Sikkerhed** | Fix af test-konto blokade ([#792](https://github.com/NicolaiDolmer/CyclingZone/issues/792)). Regenerering af Supabase-nøgler ([#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691)). Gennemførsel af udestående præmieudbetalinger via Admin-panel. |
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

_Opdateret af Claude (Claude Code) den 1. juni 2026 — sundhedsaudit-session close-out._
