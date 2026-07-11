# Natbølge 2026-07-12 (11/7 23:00 → 12/7 ~01:05)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 23:02 → 01:05 (2 bølger; keep-awake armeret til 05:42) |
| Agenter launched / fuldført / døde | 9 / 9 / 0 (bølge 1: 5, bølge 2: 4; sonnet-workers, Fable-orkestrator) |
| PR'er åbnet / merged | 10 (#2365-#2374) / 0 (ejer-beslutning: ingen merges i nat — morgen-salve) |
| Issues → claude:done | 0 endnu (flip sker pr. merge i morgen-salven); #2149 LUKKET (verificeret væk), #2375 oprettet |
| Sentry-triage | CYCLINGZONE-28+29 resolved (kollateral fra #2276-reparation, verificeret); -24 rod-årsag = støjende global alert, fixes i PR #2374 |
| gh-401-retries | 0 observeret (preflight-probe grøn i 1. forsøg) |
| Recoveries (type) | 0 ægte; 2× idle-wait-nudge på oprydnings-agenten (ventede på afsluttede børn) |
| Preflight | GO kl. 22:58 (.codex.local/night-wave-preflight.json); keep-awake-scriptet havde pwsh7 uint32-bug → fixet på main (7f1dd53b) FØR launch |

## Leverancer (morgen-salve-rækkefølge, ejer-go pr. merge)

1. **PR #2372** 🔴 FØRST — security: `REVOKE FROM PUBLIC` på 11 funktioner der reelt stadig var uautentificeret kaldbare efter #2345 (inkl. create_emergency_loan_atomic) + search_path-pins. **Merge + apply migration STRAKS.** Postmortem: `.claude/learnings/2026-07-12-revoke-from-public-not-just-named-roles.md`.
2. **PR #2374** — #2251 scheduler-hærdning (graceful skip + dedup) + præcis stall-alert (fixer CYCLINGZONE-24-støjen). Backend-only.
3. **PR #2365** — #2360 retention-scorecard v2 (admin D1/D7/D30; RPC-migration applies af ejer). Ægte kohorte-tal i PR-body.
4. **PR #2366** — #2150+#2184 help/FAQ (auktions-grace-copy fixet + 5 nybegynder-FAQ, EN+DA).
5. **PR #2373** — #2241 forward-guard CI (kolonne-grant-guard, selv-udvidende).
6. **PR #2367** — #2359+#2358 nav-oprydning (HoF-redirect, swaps demoteret; patch note v6.94).
7. **PR #2371** — #1994 lån fjernet end-to-end (patch note v6.95). ⚠️ `DROP TABLE`-migration — review SQL før merge; apply manuelt. #1996 bevidst udskudt (2 ejer-valg, se issue-kommentar).
8. **PR #2369** — #2352 Race v3 S1 work-cost, kalibreret (−0.03/w=0.10), gates grønne, adversarial-reviewet (RLS-fund fixet). Migration applies af ejer. Audit: `2026-07-12-race-v3-s1-calibration.md`.
9. **PR #2368** (draft) — #1997 rytter-palmarès m. screenshots; ejer ser visuelt → undraft.
10. **PR #2370** (draft) — #2353 S2 dagsform + jour sans + EJER-BESLUTNING: se nedenfor.

## Ejer-beslutninger fra natten

- **S2 varians-vej (audit `2026-07-12-race-v3-s2-calibration.md`, appendix):** Spec-antagelsen felt-gab 0.032 er empirisk 0.060 → spec-varians kan ALDRIG nå favorit-båndet (probe A: selv 3× sd giver 45 % og ødelægger ITT). Probe B: τ=0.5 top-kompression + spec-varians rammer 25-40 %-båndet på alle 3 seeds med type-integritet intakt. Anbefaling: option 2 (τ=0.5); maxSeason ≤45 %-målet flyttes til S4+.
- **Hjælper-tab-båndet 10-30 pladser** (ejer-beslutning §16.2) er strukturelt unåeligt som felt-median (3-5); ny counterfactual-linse er i harnessen — bånd skal re-defineres eller accepteres som counterfactual-metrik.
- **#2375 (ny):** kapacitets-gate vs. AI-fill i materializeren (0-entry tier-4-løb; observation kører via #2374).
- **#1996:** window-carry/`seasonAutoTransition`-valg (analyse i issue-kommentar).
- **Dashboard-klik (5 min):** OTP-expiry <1t + leaked-password-protection (vejledning i #2258-kommentar).

## Afvigelser/læringer
- keep-awake.ps1 pwsh7-bug (0x80000000 → negativ int32) — fixet; ville ellers have ladet S0-maskinen sove (natbølge-3-klassen).
- Oprydnings-agenten gik 2× i idle-vent på afsluttede under-agenter — nudge-mønstret virkede; overvej eksplicit "ingen under-agent-delegering" i natbølge-agent-prompts.
- Bølge 1 tog ~1t40m wall-clock for 7 PR'er — parallellisering + resume-i-samme-kontekst (S1→S2→prober på én agent) var den store gevinst.
