# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> Ejer-godkendt 2026-07-05. **Regel: ét spor gøres FÆRDIGT før næste startes.** Status: 🟠 i gang (skal føres til dørs) · 🟢 næsten i mål/kun verify · ⚪ ikke startet. Detaljer/deadlines: [audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md) + issues. Visuel udgave: [Artifact-dashboard](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635) (regenereres når denne fil ændres). Opdateres ved close-out; budget ≤1.500 tok.

## Stående spor (viger aldrig): stabilitet + fastholdelse
Sentry-fejl ([#2186](https://github.com/NicolaiDolmer/CyclingZone/issues/2186) Express-fejl fanges ikke — blind plet, [#2189](https://github.com/NicolaiDolmer/CyclingZone/issues/2189)), løb der sidder fast ([#2149](https://github.com/NicolaiDolmer/CyclingZone/issues/2149) + rod-årsag), alle spillervendte bugs. Kører hver uge uanset alt andet — brugerne må ikke forlade os pga. fejl.

## 1 · NU (5–6/7)
1. 🟢 [#2206](https://github.com/NicolaiDolmer/CyclingZone/issues/2206) Rangliste manglede ryttere — årsag fundet (1000-rækkers DB-cap), fixet/merged; kun prod-verify.
2. 🟢 [#2080](https://github.com/NicolaiDolmer/CyclingZone/issues/2080) TdF-marketingkampagne — drafts klar; ejer godkender tekst → post.
3. 🟠 [#1903](https://github.com/NicolaiDolmer/CyclingZone/issues/1903) Betaling (CZ Pro) — checkout bygget; mangler ejerens Alunta-setup + testkøb → åbn salget 6/7.
4. ⚪ [#2221](https://github.com/NicolaiDolmer/CyclingZone/issues/2221) Snyd-undersøgelse — dataanalyse af ensidige handler; rapport til ejer.

## 2 · DENNE UGE (7–13/7)
5. 🟢 [#2081](https://github.com/NicolaiDolmer/CyclingZone/issues/2081)+[#2072](https://github.com/NicolaiDolmer/CyclingZone/issues/2072) Resultatside V2 + GC-fejl — **slice 1 merged (PR #2225)**, afventer ejer-prod-verifikation.
6. ⚪ [#2224](https://github.com/NicolaiDolmer/CyclingZone/issues/2224) Race-balance-analyse — samme-hold-top-10-dominans + gentagne vindere; harness+scorecard (m. [#1378](https://github.com/NicolaiDolmer/CyclingZone/issues/1378)).
7. ⚪ [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)/[#1147](https://github.com/NicolaiDolmer/CyclingZone/issues/1147) Living World design-session — gennemgå doktrin, vælg næste motor-slices.
8. 🟠 [#1441](https://github.com/NicolaiDolmer/CyclingZone/issues/1441) Økonomi fase 3 færdig — engine-slice (Plan B) + staff-UI [#2220](https://github.com/NicolaiDolmer/CyclingZone/issues/2220) → flip for alle.
9. 🟠 [#2082](https://github.com/NicolaiDolmer/CyclingZone/issues/2082) Trænings-nerf — ejer-mål fastsat; harness → scorecard → ship 7–9/7.
10. ⚪ [#2180](https://github.com/NicolaiDolmer/CyclingZone/issues/2180)/[#2181](https://github.com/NicolaiDolmer/CyclingZone/issues/2181) Holdudtagelses-QoL · [#1279](https://github.com/NicolaiDolmer/CyclingZone/issues/1279) GO/NO-GO betalt marketing 11/7.

## 3 · RESTEN AF JULI (ét spor ad gangen)
11. ⚪ [#2034](https://github.com/NicolaiDolmer/CyclingZone/issues/2034) Roller pr. etape + hjælperytter-adfærd + dominans-fix ([#2224](https://github.com/NicolaiDolmer/CyclingZone/issues/2224)) shippes.
12. ⚪ [#1922](https://github.com/NicolaiDolmer/CyclingZone/issues/1922) Trænings-rework (ægte trade-offs, + ugeplan [#1895](https://github.com/NicolaiDolmer/CyclingZone/issues/1895)) — oven på nerf'en.
13. ⚪ [#932](https://github.com/NicolaiDolmer/CyclingZone/issues/932)+[#2064](https://github.com/NicolaiDolmer/CyclingZone/issues/2064) Akademi-rework + intake-øgning (sim først) + junior/U23 [#958](https://github.com/NicolaiDolmer/CyclingZone/issues/958) design.
14. 🟠 [#2000](https://github.com/NicolaiDolmer/CyclingZone/issues/2000) Rytterprofil rest — scouting-fane + hero + rating [#2006](https://github.com/NicolaiDolmer/CyclingZone/issues/2006).
15. ⚪ Værdi-gennemgang — auto-opdatering kører allerede; session om frekvens + glid mod handelspris [#1281](https://github.com/NicolaiDolmer/CyclingZone/issues/1281).
16. ⚪ Marketing fase 2 — delebilleder [#1299](https://github.com/NicolaiDolmer/CyclingZone/issues/1299) + referral [#1173](https://github.com/NicolaiDolmer/CyclingZone/issues/1173) (hvis GO 11/7).
17. 🟠 Discord [#2176](https://github.com/NicolaiDolmer/CyclingZone/issues/2176)–[#2183](https://github.com/NicolaiDolmer/CyclingZone/issues/2183) + migration (efter 27/7) · onboarding/EN-mails [#413](https://github.com/NicolaiDolmer/CyclingZone/issues/413) · kørerprogram lag 2.

## 4 · EFTERÅR (aug–okt) — de store reworks, ét ad gangen
18. Race engine-dybde [#1021](https://github.com/NicolaiDolmer/CyclingZone/issues/1021)/[#1176](https://github.com/NicolaiDolmer/CyclingZone/issues/1176) (form, startlister, styrt)
19. Resultat-hub rest [#959](https://github.com/NicolaiDolmer/CyclingZone/issues/959) + verdensklasse palmares [#1997](https://github.com/NicolaiDolmer/CyclingZone/issues/1997)
20. Dashboard-rework + holdside-rework [#2178](https://github.com/NicolaiDolmer/CyclingZone/issues/2178) (nedrykket hertil af ejer 5/7)
21. Bestyrelses-rework [#955](https://github.com/NicolaiDolmer/CyclingZone/issues/955)
22. Auktion/transferliste [#228](https://github.com/NicolaiDolmer/CyclingZone/issues/228)/[#1310](https://github.com/NicolaiDolmer/CyclingZone/issues/1310) + inbox-redesign [#2223](https://github.com/NicolaiDolmer/CyclingZone/issues/2223)
23. Økonomiside [#986](https://github.com/NicolaiDolmer/CyclingZone/issues/986) + kontrakter [#1150](https://github.com/NicolaiDolmer/CyclingZone/issues/1150)/[#2217](https://github.com/NicolaiDolmer/CyclingZone/issues/2217) + pension→staff [#2218](https://github.com/NicolaiDolmer/CyclingZone/issues/2218) + sponsorer
24. Brand-identitet [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481) + SEO [#1301](https://github.com/NicolaiDolmer/CyclingZone/issues/1301) + PUBLIC_ROADMAP-refresh
25. Op/nedrykning [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ved sæsonskifte + skalering [#323](https://github.com/NicolaiDolmer/CyclingZone/issues/323)

## 5 · 2027-HORISONT (vision — bevidst ikke i kø)
Living World-feed [#1147](https://github.com/NicolaiDolmer/CyclingZone/issues/1147) · landshold+mesterskaber [#934](https://github.com/NicolaiDolmer/CyclingZone/issues/934) · fans pr. land [#1113](https://github.com/NicolaiDolmer/CyclingZone/issues/1113) · omdømme [#1099](https://github.com/NicolaiDolmer/CyclingZone/issues/1099) · rytterpersonligheder [#1154](https://github.com/NicolaiDolmer/CyclingZone/issues/1154) · venner [#935](https://github.com/NicolaiDolmer/CyclingZone/issues/935) · merchandise [#2222](https://github.com/NicolaiDolmer/CyclingZone/issues/2222) · transfer war room [#26](https://github.com/NicolaiDolmer/CyclingZone/issues/26) · gemte scoutfiltre [#27](https://github.com/NicolaiDolmer/CyclingZone/issues/27) · søgning [#938](https://github.com/NicolaiDolmer/CyclingZone/issues/938) · nationalitet [#1108](https://github.com/NicolaiDolmer/CyclingZone/issues/1108) · formplanlægning [#1146](https://github.com/NicolaiDolmer/CyclingZone/issues/1146) · admin-rework [#50](https://github.com/NicolaiDolmer/CyclingZone/issues/50).
