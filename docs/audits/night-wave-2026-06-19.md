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
