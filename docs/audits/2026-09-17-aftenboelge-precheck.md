# Aftenbølge 17/9: "er det allerede lavet?"-forfilter (Bølge 0)

Ejer-krav 17/9 kl. 16:10: tjek HVERT issue i `docs/drafts/next-session-prompt-2026-09-17-aften-boelge.md` for merged PR'er, seneste kommentarer og kode på main FØR noget bygges. Kørt kl. 16:35-16:50 CEST af to READ-ONLY sonnet-agenter (issue-state + 3 seneste kommentarer, `gh pr list --search "#N"`, `git log --grep`, målrettet grep). 52 issues. Hver worker gentager tjekket som første trin i sit spor.

Verdikter: **LAVET** = spring over, done-flip/luk med evidens · **DELVIST** = byg kun resten (står i kolonnen) · **IKKE LAVET** = byg.

## Bølge 1: brand-bugs og CI

| Issue | Verdikt | Evidens / rest |
|---|---|---|
| #5322 apiFetch netværk vs. serverfejl | DELVIST | PR #5324 (17/9) gav `backendReachability.js` til Sentry-klassifikation på dashboardet. `apiFetch.ts` selv er urørt: intet try om `fetchImpl()`, intet `networkError`-flag. Rest: punkt 1-3 i issuet (fang transportfejl, kaldsteder viser rigtig besked, delt base-URL-helper). |
| #5302 relativeDayKey DST | IKKE LAVET | `stageScheduleConfig.js:96` bruger fast +24 t. PR #5300 rettede en anden bug. |
| #4873 manager-status Online→Never | IKKE LAVET | Ingen PR; `OnlineBadge.jsx` korrekt, `lastSeen`-payload mistænkt. |
| #4861 sponsorlinje "intro" | IKKE LAVET | `economyEngine.js` `buildSponsorMetadata` mangler `contract`-gren. |
| #5088 matview GRANT ALL | IKKE LAVET | Ingen REVOKE-migration; PR #5183 (#5176) rørte matviews men ikke grants. |
| #5085 CI lint+build marketing/ | IKKE LAVET | `ci.yml` nævner ikke `marketing`. |
| #5004 preflight anti-slop | IKKE LAVET | `preflight-pr.ps1` kalder ikke `check-anti-slop.mjs`. |
| #5326 sanitize-secrets-hook | IKKE LAVET | `sanitize-secrets.sh:360` videregiver ikke Python-stderr. |
| #5253 CDN-tjek retry | IKKE LAVET | Ingen retry i `check-cdn-cache-headers.mjs`/`verify-deploy.ps1`. |
| #5286 deploy-verify tom JSON | IKKE LAVET | `deploy-verify.yml` trin "Resolve target sha" uden tom-body-guard. |
| #5094 guard-commit-branch uden bash | IKKE LAVET | Scriptet og kaldstederne urørte. |

## Bølge 2: spillerfund og drift

| Issue | Verdikt | Evidens / rest |
|---|---|---|
| #5223 dobbelt sprint_captain | IKKE LAVET | Ejer 15+16/9: 2. forekomst, samme rodårsag. Gemme-guarden (#4357) dækker ikke motorens sammenfletning. |
| #5291 /distribution HTML 200 | IKKE LAVET | `RaceHubBoard.jsx:114` parse-gren uden content-type-guard. |
| #5224 race-count 500 tom besked | IKKE LAVET | `rankings.ts:96-102` sender rå fejl til `reportError`. |
| #5017 Sentry-hygiejne | DELVIST | Matview `[Object]` LAVET (PR #5132). Netværks-fingerprint LAVET (PR #5324, ejer 17/9: "lav ikke arbejdet to gange"). Rest: Alunta-vagtens dagstal i fejlbeskeden = samme arbejde som #5015. |
| #5015 Alunta boot-retry | IKKE LAVET | `aluntaOverdueWatch.js`: ingen retry, intet fingerprint. |
| #5321 rating forskellig på to flader | IKKE LAVET | Ubesvaret investigation. |
| #4123 kalender-invarianter CI-gate | DELVIST | PR #4571 (2/9) gav test + golden snapshot + CI-job `calendar-invariant-ci-gate`, men jobbet er rådgivende: ikke i `scripts/ci-required-checks.json`. Rest: gør gaten blokerende + gylden diff-rutine før S4-generering. |
| #5272 reconcile uden raceDayTarget | IKKE LAVET | `tierCalendarMaterializer.js:785-852` sender intet `raceDayTarget`. |

## Bølge 3: ops-vagter, forward-guards og perf

| Issue | Verdikt | Evidens / rest |
|---|---|---|
| #4981 autobud-notifikation | IKKE LAVET | `proxyBidding.js:523-538` `break` uden notify når `autoBidder === currentWinner`. |
| #5201 Scouting Network-copy | IKKE LAVET | `klub.json` lover 2 opgaver; `scoutEngine.js:57` kræver overall ≥ 80. |
| #2671 RLS-policy EXECUTE-guard | DELVIST | Punkt 1 LAVET (PR #4464, 31/8). Rest: punkt 2 (`SET LOCAL role`-smoke-test af centrale tabeller) + punkt 3, se ejer-kommentar 30/8 nederst. |
| #4645 /pro-pris vs. Alunta | **LAVET** | `aluntaPlanCatalog.js:29-34` DKK-halvår 21200/"265,00" = live-pris; #4608 + #5210 (forward-guard) merget. Ejer 2/9: "synkes når #4608 er merget". Lukkes med evidens. |
| #5091 monday-numbers substring | IKKE LAVET | `monday-numbers.mjs:141` `includes("discord")`. |
| #5092 script-tests i CI | IKKE LAVET | Ingen `test:*`-entry, ingen workflow. |
| #5093 NOW.md-guard | IKKE LAVET | `check-now-md.sh` er kun budget-hook. |
| #5177 perf top 3 | DELVIST | CLS-spor (PR #5189, #5217) LAVET. Ejer 17/9: LCP-sporet (5,6 s mobil) og index-chunk-sporet er åbne. Rest: mål index-chunk mod 180 KB gzip (PR #5198 rørte det; genmål) og LCP sitewide (i18n-bundle 131 KB + flag-icons-CSS 85 KB). |
| #5055 posthog-js-lite | IKKE LAVET | Ikke i `frontend/package.json`. |

## Bølge 4: aftalte features

| Issue | Verdikt | Evidens / rest |
|---|---|---|
| #5283 synlig generator-test | IKKE LAVET | Ingen PR. |
| #5327 færdiggør PR #3512 | IKKE LAVET | #3512 stadig draft; WIP a03b6eb40 i worktree. |
| #4582 demote arver kontrakt | DELVIST | Backend-arv LAVET via PR #4973 (#4589, 7/9; ejer droppede reparation af 19 historiske). `origin/wip/4582-demote-inherits-contract` (ac616293d, 7 filer) har backend + modal + i18n. Rest: rebase wip på main, fjern det #4973 allerede dækker, behold modal/i18n der viser den arvede løn, e2e, skærmbillede. |
| #5259 beta-adgang | IKKE LAVET | Ingen admin-flade for `is_beta_tester`/flag-stadie. |
| #3517 forum v1.1 | DELVIST | Citér-svar LAVET (PR #4238/#4250). Rest: links i indlæg + auto-signatur (ejer 17/9). DA/EN-split IKKE i dette spor. |

## Bølge 5: flere aftalte features

| Issue | Verdikt | Evidens / rest |
|---|---|---|
| #5226 rapportér auktion | IKKE LAVET | Ingen PR. |
| #5257 samlet handelsliste | IKKE LAVET | Ingen PR. |
| #4813 transferhistorik døde klik | IKKE LAVET | Ingen PR. |
| #4982 sticky-header padding | IKKE LAVET | Ejer 10/9: 3. spillerstemme. |
| #4875 etapetype-ikoner i kalender | IKKE LAVET | Ingen PR. |
| #2748 pension forvarsel | DELVIST | PR #5109 (10/9) gemmer varslet på rytteren. Rest: lead-time én sæson før (ejer 25/8), squad-minimum-check, robust notifikation. Worker verificerer #5109's dækning først. |

## Hvis tid

| Issue | Verdikt | Evidens / rest |
|---|---|---|
| #5242 apiFetch PR 2 | DELVIST | PR 1/2 (#5248) merget; 214 kaldsteder/74 filer tilbage. |
| #4521 patch-notes-SSOT | DELVIST | Efterkontrol LAVET (2/9). Rest: `docs/PATCH_NOTES_RULES.md`. |
| #5328, #5329 ai-ops-guards | IKKE LAVET | |
| #5249, #5250 forside/cookie | IKKE LAVET | `sessionCookie.ts` er stadig markør-cookie. |
| #4702 bunch-tid | IKKE LAVET | |
| #5203, #5282, #4867, #5179 | IKKE LAVET | Read-only-rapporter. |
| #4829 AI-hold nedlagt? | Besvaret af ejer 6/9 | "Division 4 F = 25 hold (krav 24)": sandhedstesten er nej. Rest: kun konklusion i issuet. |
| #4924 forældreløse mapper | DELVIST | Runde 1 (38 slettet). Rest: liste m. commit-titler til ejer-go. |

## Retningsskift fundet i seneste ejer-kommentarer

1. **#5017:** kun Alunta-delen mangler; slås sammen med #5015 i spor 2B.
2. **#4582:** roden er fikset på main (#4973); sporet skrumper til UI/modal-resten fra wip-branchen.
3. **#5177:** index-chunk genmåles før der bygges; LCP sitewide er den reelle rest.
4. **#4123:** ejer-kommentaren 23/8 er fra før PR #4571; resten er at gøre gaten blokerende.

Refs #627.
