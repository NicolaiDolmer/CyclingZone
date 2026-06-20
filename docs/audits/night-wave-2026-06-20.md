# Natbølge 2026-06-19 → 20 (autonom, Claude Code)

> Ejer-autoriseret hel-nats autonom session. Mandat: lav-risiko, høj-værdi opgaver hvor planer findes eller scope er klart; find flere når færdig. Sandhed = git + dette dokument (ikke session-transcript).

## Leverance i tal

- **15 PR'er merged** (alle CI-grønne). Backend (sikkerhed + SSOT-hygiejne + forward-guard-test) **LIVE via Railway**; frontend venter Vercel-reset.
- **2 patch-notes-versioner** (v5.67 batch + v5.68 a11y).
- **7 audits** + Sentry-gennemgang (0 prod-fejl): design-kvalitet, security (prod-verificeret), bug-backlog ×2, DB-perf-advisor, + **tre kerne-system-korrektheds-audits med adversariel verifikation** (se nedenfor).
- **4 issues lukket** (verificeret) + **1 rod-årsag udredt** (#46) + **1 launch-blocker oprettet** (#1558).
- **1 implementeringsplan** (WS1 race-automatisering) + audit-docs.

## Kerne-system-audits (adversariel verifikation — det stærkeste signal)

Tre korrektheds-audits af de vigtigste systemer, hver med en adversariel verify-fase der **afviste de fleste påståede bugs** (hurtige scannere producerer falske positiver; verifikationen er det der gør konklusionen troværdig):

| System | Resultat | Doc |
|--------|----------|-----|
| **Race-engine** (#1-prioritet) | **0 bugs — solid.** Determinisme, idempotens, evne-drevne resultater, klassementer alle verificeret korrekte. Få edge-cases (E1 tom bjerg-trøje er eneste spiller-synlige). | [race-engine-quality](2026-06-20-race-engine-quality.md) |
| **Økonomi** (#1441) | **0 beregnings-bugs — solid.** Idempotens, advisory-lock-atomicitet, frosne lønninger, sponsor-loft alle korrekte. | [economy-correctness](2026-06-20-economy-correctness.md) |
| **Concurrency** (forever-relaunch) | **1 reel race = #1558** (akademi-race, eneste sted en bruger kan tabe penge). Resten verificeret beskyttet. | [concurrency](2026-06-20-concurrency.md) |

**Vigtigst:** #1558 er den eneste launch-blocker i hele audit-mængden. Idempotency-key alene lukker den ikke (to krydser, forskellige keys) — fix kræver atomær RPC. Detaljer + fix-retning på issuet.

## Onboarding / nye-spiller-rejse (forever-relaunch retention) — fandt den STØRSTE blocker

En 8. audit ([onboarding-journey](2026-06-20-onboarding-journey.md)) af den nye spillers første-oplevelse afslørede **#1560 — det vigtigste fund i hele natbølgen:** hold oprettet EFTER relaunch får INGEN starttrup (`PUT /api/teams/my` allokerer 0 ryttere; `runStarterSquadAllocation` kører kun ved relaunch). Næste nye signup sidder fast i en tom-trup-købs-cirkel. Verificeret mod kode + prod (ikke aktivt live — alle 22 hold har trup fra relaunch — men hård forever-relaunch-blocker, da løbende nye signups er hele præmissen). Railway-deploybar, men balance-følsom (#1487) → ejer + simulér-før-ship. Øvrige onboarding-fund (R2-R4 signup-copy/dismiss/narrativ) er mest frontend → venter Vercel-reset.

## Merged PR'er

**Frontend (deployer ved Vercel-reset — se §Vercel):**
| PR | Issue | Hvad |
|----|-------|------|
| #1544 | #1483 | Finance: rytternavn på transfer/swap-transaktioner + graf-i18n-leak |
| #1546 | #1486 | Indbakke: rytter-notifikationer linker til rytterprofil (+ fixede latent proxyBidding-metadata-bug) |
| #1547 | #249 | Bud-historik: sekundær sortering på beløb |
| #1545 | #1532 | Fjernet PCM-resultatindberetning fra UI (backend bevaret til WS2) |
| #1548 | #671 | Design-token-drift + glow-oprydning (audit T1-T10) |
| #1549 | #1421 | Dead-click: falske affordances + token-separatorer |
| #1550 | #9 | Rytterdatabase: mobil-sorteringskontrol |
| #1551 | #1484 | Løbsresultat: stiliseret terræn-/ruteprofil-indikator pr. etape |
| #1552 | #42 | U23-filter aligneret med badge-grænse |
| #1555 | a11y | Tilgængelighed: aria-labels, aria-hidden, form-labels (aria-only, nul visuel ændring) |

**Backend (LIVE i prod via Railway — uafhængigt af Vercel):**
| PR | Issue | Hvad |
|----|-------|------|
| #1553 | #544 | closed_at defense-in-depth: admin-close satte ikke closed_at (reelt hul) + regression-test |
| #1554 | security | 3 reelle valideringshuller: offer_amount/loan-repay råt fra body + .or()-injektion på /managers/:teamId; HSTS; admin-route CI-guard |
| #1556 | security | POST /finance/loans amount-validering (samme klasse som #1554) |

## Sikkerheds-audit (prod-verificeret)

**Konklusion: sikker codebase. 0 ERROR-niveau Supabase-advisor-lints. Ingen verificeret auth-bypass, PII-læk, finans-exploit, IDOR eller SQL-injection.** Flere "kritiske" audit-claims var baseret på stale `schema.sql` og holdt ikke mod prod (schema.sql nu markeret som ikke-source-of-truth).

Reelle fund (alle fixet i #1554/#1556): tre amount-/UUID-valideringshuller (defense-in-depth, ingen aktiv exploit observeret). Verificeret mod prod: `is_admin`/`is_beta_tester` er anon-EXECUTE men returnerer kun callerens egen status (kosmetisk); `get_cohort_retention` er SIKKER (intern `is_admin`-gate); alle 87 admin-ruter er `requireAdmin`-gated.

## ⚠️ Vercel build-rate-limit (ejer-handling)

Nattens høje merge-tempo ramte Vercel hobby-tier's deploy-rate-limit ("retry in 24 hours"). **Prod kører stabilt på #1550-deploy.** De 10 frontend-merges (#1551/#1552/#1555 + patch notes v5.67/v5.68) er i git/main men **ikke deployet til frontend-prod endnu.** Backend (Railway) er upåvirket og kører den nyeste kode.
- **Løsning:** vent ~24t på reset (auto-deployer ved næste push), ELLER opgrader Vercel Pro, ELLER trigger manuel re-deploy efter reset.
- **Efter deploy:** prod-spotcheck af v5.68 (især terræn-profil på løbsresultat, mobil-sortering, finance-rytternavne).

## Ejer-handlingsliste (prioriteret)

1. **Vercel:** reset/Pro/re-deploy → få frontend-natbølgen live + spotcheck (se §Vercel).
2. **Sikkerhed før forever-relaunch:** aktivér leaked-password-protection i Supabase Auth (HaveIBeenPwned, 1 klik). Valgfrit: REVOKE EXECUTE FROM anon på `is_admin`/`is_beta_tester` (migration, kosmetisk); DB CHECK-constraints på beløbskolonner (migration, defense-in-depth — app-niveau allerede dækket).
3. **WS1 race-automatisering** ([plan](../superpowers/plans/2026-06-19-ws1-race-automation.md)): Fase-0-beslutninger — (A) auto-prize-timing/point-freeze, (B) "dagens løb"-schema-model (gater Fase 3 + migration du merger), (C) stress-test-vindue. Fase 1-2 er implementerbare når A/C er afklaret.
4. **Granit-frys-session** (forever-spec §7): godkend de kalibrerede tal som endelige før forever-vinduet.
5. **Design-smag** ([audit](2026-06-20-design-quality-audit.md)): (A) nav-emoji → SVG, (B) modal-radius, (C) loan-violet-token.
6. **#46 balance-realtime:** rod-årsag fundet (teams/notifications ikke i `supabase_realtime` publication) → publication-migration ELLER targeted invalidering (#1374, post-launch).

## Næste-bølge backlog (verificeret, klar)

- **#786** transferliste-UX (autonom-egnet, men subjektiv → ejer-retning på action-gruppering/status-summaries anbefales).
- **#918** rytter-værdi-historik (kræver ejer: schema + design — værdi beregnes nu fra resultat-vindue, ikke lagret).
- **#1485** holdklassement (race-engine beregner ALLEREDE team-classification; mangler visning + season_standings-kolonne → reset-krævende, ejer-scope A/B/C).
- **#109/#42-rest** U25-kategorisering: obsolet for sæson 1 (fiktive ryttere har korrekte birthdates).

## Lukkede issues

#1453 (migration-drift, prod-verificeret applied), #229 (scroll-to-top), #47 (navne-søgning), #248 (evne-sortering) — alle verificeret fixet i koden før lukning.
