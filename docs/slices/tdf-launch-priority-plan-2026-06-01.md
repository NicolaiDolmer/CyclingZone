# TdF Launch Sprint Prioriteringsplan (2026-06-01)

Denne plan opsummerer de vigtigste opgaver og prioriteter for CyclingZone-projektet frem mod Tour de France-lanceringen, med en hård deadline den 20. juni 2026.

## 🗓️ Gennemgang af de seneste 14 dage (17. maj – 31. maj)

De seneste to uger har været præget af store funktionelle spring og en omfattende "cleanup" af brugeroplevelsen. Nøglepunkter inkluderer:

*   **Handel & UI-polering:** Implementering af handel uden for transfervinduet (#19 Del A), ensartet evne-farveskala (#855), og nyt kolonne-layout til ryttertabeller (#799, #837). Bestyrelses-test-mode med frosset økonomi er åbnet (#805).
*   **Professionalisering & Sprog:** Fuld internationalisering (DA/EN) på tværs af profil, rangliste og finanssider (#678). Node 24 er pinnet for stabilitet (#718).
*   **Stabilitet:** Forbedret fejlhåndtering ved crash (#711), sikkerhedsværn mod UCI-datafejl (#702), og rettelse af achievement-sync ved flere planer (#695).
*   **Core Logic:** Lønudbetaling er flyttet til sæsonstart for bedre cashflow (#378). Resultat-import og point-beregning er optimeret.

## 📍 Aktuel status (Pr. 1. juni)

Projektet er tæt på "launch-ready" for TdF, men med enkelte kritiske hængepartier:

*   **Kritiske fejl:** Test-konti sidder fast ved oprettelse (#792).
*   **Sikkerhed:** `SUPABASE_SERVICE_KEY` skal regenereres efter leak (#691).
*   **Admin:** Der udestår udbetaling af ~11,9 mio. CZ$ i præmiepenge.
*   **Handel:** Del B af handel uden for vinduet (lejeaftaler) mangler.

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

_Udarbejdet af Manus AI den 1. juni 2026._
