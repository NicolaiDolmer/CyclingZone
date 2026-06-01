# NOW — Aktuel arbejdsstatus

> **🟢 Seneste close-outs** (detaljer i git-historik + issues/PRs): **1. juni** — **AI-Autopilot Fase 2** (v4.40): Loop D (Auto-PR-review) opgraderet til obligatorisk statuscheck ved at fjerne `continue-on-error` i `claude-review.yml`. Loop F (Subagent-orkestrering) etableret som Manus-orkestreringsdisciplin. PatchNotesPage og FEATURE_STATUS opdateret. Verificeret: `.github/workflows/claude-review.yml` opdateret. · **31. maj** — **[#861](https://github.com/NicolaiDolmer/CyclingZone/issues/861) admin loading-state hardening** (v4.38, PR pending): aktive admin-tabs nulstiller nu loading i `finally` og tåler non-JSON/network-fejl via shared `readAdminJson`/`adminErrorMessage`.

## Aktiv styring

> **🎯 Next action:** **[#792](https://github.com/NicolaiDolmer/CyclingZone/issues/792) test-konto-blokade** — test-konto går i stå ved opret hold/manager. Åbner test-/preview-verify-loopet. Alternativ: **[#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691)** SUPABASE_SERVICE_KEY rotation.
>
> **🤖 Working agent:** Manus AI (Architect & Coordinator). **Afventer din hånd:** (1) Tilføj manuelt "Auto PR review" som Required Status Check i GitHub branch protection rules for `main`. (2) Gennemførsel af udestående præmieudbetalinger via Admin-panel.

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
    *   **#820: Bestyrelses-DNA mismatch:** Implementeret lokalt i v4.39 — DNA vælges før board-medlemmer og plan-signering; afventer commit/push.
    *   **#775: Hall of Fame mangler data:** Vigtig social feature.
    *   **#776: Rytter-status "stuck":** Skaber forvirring på markedet.

---

_Opdateret af Manus AI den 1. juni 2026._
