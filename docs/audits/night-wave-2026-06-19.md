# Natbølge 2026-06-19

Discord-feedback-bølge (testbølge 18/6) ryddet natten før relaunch (20/6). Drevet via Workflow-orkestrering (pipeline pr. issue: investigér → implementér i isoleret worktree → adversarielt verificér) + orkestrator-konsolidering.

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | Aften 19/6 → nat 20/6 (præcist klokkeslæt ikke logget) |
| Wall-clock (workflows) | Wave 1 ~24 min · Wave 2 (#1483) ~19 min + orkestrator-solo imellem/efter |
| Agenter launched / fuldført / døde | ~20 / ~20 / 0 (wave 1 = 18: investigate+implement+verify+balance; wave 2 = 2) |
| PR'er åbnet / merged | 8 / 0 (merge bevidst overladt til ejer — relaunch-aften) |
| Issues adresseret | #1479 #1478 #1481 #1488 #1482 #1480 #1483(DEL1) #1487(analyse) #1486(beslutning) |
| Subagent-tokens | ~1,96M (wave 1 ~1,71M + wave 2 ~0,25M) |
| gh-401-retries | Ikke talt centralt; preflight-probe ramte forsøg 1/5 |
| Recoveries | 1: hoved-checkout efterladt på `review/1480-training-ux` af en verify-agent → gendannet til `main` |
| Preflight | GO (`.codex.local/night-wave-preflight.json`) |

## PR'er (alle required CI-checks grønne; afventer ejer-merge)

| PR | Issue | Type | Verdict | Note |
|---|---|---|---|---|
| #1489 | #1479 | backend | ✅ approve | "Træn i dag" route-ordering (`invalid_focus`) + regressionstest |
| #1493 | #1478 | backend | ✅ approve | 4 akademi-bugs, 2 rod-årsager, ingen migration (relaunch regenererer) |
| #1492 | #1481 | backend | ✅ approve | **+ data-migration `database/2026-06-19-reset-rester-...sql` — EJER MERGER** |
| #1490 | #1488 | frontend | ✅ approve | board-kort skjult indtil bestyrelse findes |
| #1491 | #1482 | frontend | ✅ approve | status/type/contract-kolonner; needs-work-blocker (Type-sort) fikset af orkestrator |
| #1494 | #1480 | frontend | ✅ approve | ryttertyper + gruppering + bulk-rediger |
| #1496 | #1483 (DEL 1) | fullstack | ✅ approve | rytternavn i finance-speak (kilde-fix + retro-regex + leak-fix) |
| #1495 | (ops) | scripts | — | preflight `.Count`-fejl fundet+fikset under denne bølge |

Konsolideret patch-note: **v5.61** (denne PR). Agenter rørte ikke `PatchNotesPage.jsx`/`NOW.md` (undgår parallel versions-kollision).

## Ejer-beslutninger (investigeret, ikke shippet)

- **#1483 DEL 2 (grafer):** issuet beder eksplicit om *forslag* til at gøre finance-graferne brugbare = design-valg. Forslag: erstat reason_code-donuts med kumulativ balance-over-tid + indtægt/udgift stacked bar; aktivér sponsor-kurven når board-snapshots findes. Afventer dit valg.
- **#1486 (indbakke rytter-link):** scope A (fuld backend-metadata-kontrakt, anbefalet) vs B (frontend-only 2 typer). Post-launch-prioritet. Beslutning postet på issuet.
- **#1487 (start-trupper for stærke):** fuld balance-analyse postet. Nøglefund: "max ~10 i evner" er **umuligt** med nuværende population (svageste rytter ~26 på 1-99-skala). Kræver skala-afklaring + nerf-retning (A: vend draft + loft ~40 / B: dedikeret svag pulje ~10-25) + start-budget-beslutning. Analyse-harness på branch `balance/1487-starter-squad-nerf-analysis`.

## Afvigelser / læringer

- **Verify-agenter (ingen worktree-isolation) lavede `git checkout` i hoved-checkoutet** for at læse PR-diffs, og efterlod det på en `review/*`-branch. Fremover: instruér verify-agenter til at bruge `gh pr diff <url>` (ingen lokal checkout) ELLER kør dem også i worktree-isolation. (Forward-guard til natbølge-runbook.)
- **`audit` (feature-liveness) fejler på alle PR'er** med 5 "write-but-no-data"-findings (auction_bids/auction_proxy_bids/auctions/loan_agreements/transfer_listings) — tomme fordi sæsonen lige er relanceret. Ikke en required check, ikke introduceret af bølgen. Forsvinder når spillere begynder at byde/handle.
- **Patch-notes-konsolidering virker:** ingen versions-kollision fordi kun orkestratoren rører `PatchNotesPage.jsx`/`NOW.md`; fix-PR'erne passerer patch-notes-gaten (uændret fil).
- **Worktree-isolation holdt:** 7 parallelle implementeringer, 0 kryds-konflikter.

---

# Dag-bølge 2 (dagtimer 19/6) — ultracode-orkestrering

4-timers dag-bølge (ejer væk). 14 opgaver, hver i sit eget worktree (`new-worktree.ps1`, branch fra origin/main). Pipeline pr. opgave: **implementér → read-only review (`gh pr diff`) → betinget fix** (kun blocker/major). Merger INTET — review-klare PR'er.

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 11:07 → 11:51 |
| Wall-clock (workflow) | ~44,6 min |
| Agenter launched / fuldført / døde | 28 / 28 / 0 (14 impl + 13 review + 1 fix; concurrency-cap ~6) |
| PR'er åbnet / merged | 13 / 0 (merge overladt til ejer) |
| Allerede-løst (sprunget over) | 1 (Race v2 Plan 2 — fuldt merged via #1428-kæden) |
| Subagent-tokens | ~2,74M |
| Tool-uses | 1.116 |
| Fix-runder udløst | 1 (#1512 notifications snapshot) |
| Preflight | GO kl. ~11:00 (`.codex.local/night-wave-preflight.json`) |

## PR'er (alle MERGEABLE; afventer ejer-merge)

| PR | Issue | Spor | merge_ready | Note |
|---|---|---|---|---|
| #1508 | #1077 | C backend | ✅ | `.eq("is_bank",false)` i economyEngine (season-end/start) + is_ai/is_bank/is_frozen 403-guard i 4 /board-handlere (spejlet fra DNA-endpoint) + regressionstests. `backend-only`. |
| #1507 | #1285 | D ops | ✅ (1 minor) | Delt gh-retry-wrapper (`scripts/lib/gh-retry.sh`+`.ps1`, 5×/3s) + preflight gh-auth-WARN. `backend-only`. |
| #1511 | #1272 | D test | ✅ (1 minor) | Central `waitForPageReady` + `ROUTE_READINESS`-registry i core-smoke; /auctions-gate delt. CI grøn inkl. frontend-smoke. `cat:infra`. |
| #1509 | #1465/#1464 | D audit | ✅ (2 minor) | **MIGRATION (DRAFT) → EJER APPLIER.** Read-only audit fandt **1 reel CHECK-drift**: `finance_transactions.type='forced_debt_sale'` skrives (economyEngine.js:540, B3-gældseskalering) men mangler i CHECK — samme klasse som upkeep-bug #1463. **0 uhåndterede reset-FK** (forward-guard #1472 holder). Migration `database/2026-06-19-finance-forced-debt-sale-type.sql` additiv. |
| #1510 | #1139 | E polish | ✅ (1 minor) | Skjult Hall of Fame (nav: Layout + Resultater) + fjernet login-streak-power fra UI (🔥-boks + frontend-kald) + help.json (en+da). BEVARET: route/HallOfFamePage/POST login-streak/DB-kolonner/awardXP. Snapshots refreshet. **Rører samme filer som #1514 + #1515.** |
| #1519 | #671 | B Plan-4 | ✅ | Transfers — Card/EmptyState, rounded-cz, hex→cz-accent, emoji→SVG. baseline 65→64. |
| #1512 | #671 | B Plan-4 | ✅ (fixed) | Notifications — major fundet+fixet: 3 nye ikoner i delt barrel voksede `kitchen-sink.png` → desktop+mobile-chromium PNG regenereret. |
| #1513 | #671 | B Plan-4 | ✅ | Profile — Card/Button/Field/Input/Toggle/Spinner, hex→cz-discord-token. |
| #1515 | #671 | B Plan-4 | ✅ | Manager-profil + OnlineBadge — Card/Table/Tabs/StatusBadge; FlameIcon tilføjet. **Rører ManagerProfilePage.jsx (jf. #1510).** |
| #1514 | #671/#959 | B Plan-4 | ✅ (2 minor) | Results — hub-ikoner→SVG (CrownIcon/BookOpenIcon), Card/EmptyState. **Rører ResultaterPage.jsx (jf. #1510); #959-overlap flagget.** |
| #1516 | #671 | B Plan-4 | ✅ | Standings — 7 hex→tokens, Card/EmptyState/Spinner. |
| #1517 | #671 | B Plan-4 | ✅ | Teams — Card/Input/Spinner/EmptyState, DIV_COLORS hex→tokens, glow fjernet. |
| #1518 | #671 | B Plan-4 | ✅ | Auction History — Card/Spinner/EmptyState/Button. |

## MERGE-RÆKKEFØLGE (anbefalet — ejer merger; aldrig auto-merge)

1. **Backend/lav-konflikt først:** #1508 (#1077), #1507 (#1285), #1511 (#1272). Ingen fil-overlap, kan merges direkte.
2. **E før de overlappende Plan-4-flader:** #1510 (#1139) — fjerner HoF-nav + streak-boks. **Konflikt-cluster:** #1510 rører `ResultaterPage.jsx` (også #1514) + `ManagerProfilePage.jsx` (også #1515). Merg #1510 her, så rebases #1514/#1515 ovenpå (Plan-4-migrationen forener med den fjernede HoF-entry / skjulte streak-boks).
3. **Plan-4-flader sekventielt m. rebase** (delte filer: `scripts/ui-slop-baseline.json` + `frontend/src/components/ui/icons/index.jsx` + `kitchen-sink.png`): #1519 → #1512 → #1513 → #1515 → #1514 → #1516 → #1517 → #1518. **Ved hver merge der tilføjer et ikon til barrelen:** efter rebase, kør `npx playwright test kitchen-sink --update-snapshots` + commit de 2 chromium-PNG'er FØR merge (KitchenSinkPage rendrer hele `Object.entries(Icons)` → siden vokser pr. nyt ikon). Konflikter i `ui-slop-baseline.json`: kør `node scripts/lint-ui-slop.mjs --update-baseline` efter rebase.
4. **Migration sidst:** #1509 (#1465) — `database/*.sql` auto-applies på prod ved merge. Review SQL'en (additiv CHECK-udvidelse) + tag frisk backup før merge.

## Konsolideret patch-notes (FAKTA — founder finaliserer copy, jf. tone-regel)

Tilføjes til `PatchNotesPage.jsx` som **v5.63** når wave-PR'erne merges (IKKE shippet endnu — notes skal matche live-state). Forslag til indhold:
- **Brand-polish:** Transfers, Notifications, Profile, Manager-profil, Results, Standings, Teams og Auktionshistorik er opdateret til det nye design-system (renere kort, ensartede ikoner, fladt udtryk).
- **Hall of Fame + login-streak/XP** er fjernet fra brugerfladen (#1139, ejer-godkendt).
- (help.json en+da allerede opdateret i #1510.)

> Orkestratoren rørte IKKE `PatchNotesPage.jsx` (undgår parallel versions-kollision). Sig til hvis du vil have entryen lavet på en docs-branch i stedet.

## Afvigelser / læringer

- **Delt icon-barrel → `kitchen-sink.png` vokser.** `KitchenSinkPage.jsx` rendrer `Object.entries(Icons)` i et grid, så ethvert nyt glyph i `ui/icons/index.jsx` flytter pixels → `kitchen-sink-{desktop,mobile}-chromium`-snapshot fejler deterministisk (ikke flake). #1512-agenten afskrev det først som miljø, review fangede det → fix-agent regenererede. **Konsekvens for sekventiel Plan-4-merge:** hver flade der tilføjer ikoner skal regenerere kitchen-sink efter rebase. Postmortem: `.claude/learnings/2026-06-19-plan4-shared-icon-barrel-kitchen-sink-snapshot.md`.
- **mobile-webkit kan ikke køres lokalt på denne PC** (manglende `brotlicommon.dll`/`icuuc77.dll`/`brotlidec.dll`) — `npx playwright test … core-smoke` (alle 3) dropper stille webkit lokalt; CI-Linux dækker det. Anbefaling: kør `npx playwright install webkit` (+ evt. `--with-deps`) én gang, så fremtidige bølger får fuld 3-projekt-dækning lokalt.
- **`audit` (feature-liveness) fejler på Plan-4 + #1139-PR'er** med `loan_agreements`-fund (write-but-no-data) — **samme præeksisterende post-relaunch-tomhed** som dokumenteret i dag-bølge 1 ovenfor, ikke introduceret af UI-refactors. Ikke required check.
- **Stray `verify.txt` i hoved-checkoutet:** transfers-agenten redirectede en engangs-Playwright-verifikation til `C:\Dev\CyclingZone\verify.txt` (untracked, aldrig committed) trods "rør aldrig hoved-checkoutet". Orkestrator slettede → main rent. Forward-guard: instruér agenter eksplicit i at skrive temp-output INDE i worktree'et.
- **Race v2 Plan 2 var allerede løst** — agenten fast-forwardede sin branch, verificerede alle plan-deliverables på origin/main (FORMULA_VERSION=3, archetypePhysiology 32/32, race:gate grøn) og åbnede ingen PR. #1021/#1102 forbliver åbne (umbrella-epics), ikke et signal om manglende Plan-2-kode.
- **Worktree-isolation + read-only review holdt:** 0 kryds-konflikter under kørsel, hoved-checkoutet uberørt af review-agenter (gh pr diff-instruktion virkede).
