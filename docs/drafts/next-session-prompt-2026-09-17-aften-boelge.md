# Prompt til næste session (17/9 aften): stor workflow-session på aftalte, færdigdesignede opgaver

> Ejer-mandat 17/9 kl. 16 (ordret): *"arbejd videre i en ny session på ting der allerede er aftalt og designet færdigt med mig. Vælg opgaver du er sikker på hvordan man laver. Jeg er væk i 4-5 timer. Du må gerne lave mange opgaver. Skal være god stor workflow-session."* Og ved godkendelsen: *"Du må gerne lave en endnu større liste med flere vigtige ting du kan køre uden mig. Det du dog skal sikre at du husker inden du går i gang med opgaver, det er at tjekke om opgaverne allerede er lavet i forvejen."* Listen er ejer-godkendt 17/9 kl. 16:10 (svar 1 + udvidelse).

## Start (før første spawn)

1. Læs `docs/NOW.md`, `docs/NIGHT_WAVE_RUNBOOK.md` (hele), `docs/PARALLEL_WORKTREE_ORCHESTRATION.md` og denne fil. Sæt **🤖 Working agent** i NOW.md til "Aftenbølge 17/9 (workflow)" og commit det på main (docs, bag guarden).
2. `git pull` på main. Rør aldrig branch i hoved-checkoutet; alt byggearbejde i worktrees via `.claude/workflows/wave.js`.
3. **Bølge 0, "er det allerede lavet?" (OBLIGATORISK, ejer-krav):** én READ-ONLY-agent (sonnet) tjekker HVERT issue i listen FØR noget bygges: `gh issue view N --json state,comments` (seneste 3 kommentarer), `gh pr list --state all --search "#N" --limit 10 --json number,title,state,mergedAt`, `git --no-pager log --oneline origin/main --grep "#N" | head`, og et grep i koden efter den konkrete adfærd/fil issuet nævner. Verdikt pr. issue: **LAVET** (→ done-flip/luk med evidens, spring over) · **DELVIST** (→ byg kun resten, skriv hvad der mangler i spawn-prompten) · **IKKE LAVET** (→ byg). Skriv resultatet som tabel i `docs/audits/2026-09-17-aftenboelge-precheck.md` og læg den i #627 som kommentar. Samme tjek gentages af hver worker som første trin i sit eget spor (issue + PR-søgning + grep), og en worker der finder arbejdet lavet stopper og rapporterer "ALLEREDE LAVET" i stedet for at bygge dobbelt.
4. Byg KUN via `Workflow({ scriptPath: "C:\Dev\CyclingZone\.claude\workflows\wave.js", args: { tracks: [...] } })`. Maks 4 laner, verifikations-semafor 2, maks 5 åbne PR'er, livstegn (draft-PR 30 min, push 15 min, timeout 60 min, recovery i samme worktree). `model` eksplicit pr. spor. Fable bygger aldrig selv.
5. Worker-prompt SKAL indeholde: allerede-lavet-tjekket (punkt 3) · issue-nummer i PR-titel · Write→fil + `git commit -F` (aldrig heredoc; unikt filnavn pr. commit) · `gh`/`git` bart, `git -C <worktree>` · preflight/tests i FORGRUNDEN · push hvert 15. min · rør aldrig `docs/NOW.md` · ingen patch note i PR'en (samles ved close-out) · copy efter `docs/TONE_OF_VOICE.md` (jeg/du, EN først, DA under, ingen em-dash) · page templates + `docs/design/TASTE.md` for UI · `FLAG_GATED_EMPTY_TABLES` ved ny tabel bag flag · skærmbillede(r) i PR-body ved enhver UI-ændring.

## Merge-politik i denne session (WEEKLY_STEERING-reglen)

- **Backend / drift / CI / docs / tests / tekstfejl:** Claude merger selv ved grøn CI + CodeRabbit, én ad gangen (`gh pr merge N --squash --delete-branch --admin` bart; `gh pr update-branch` først; konflikt → worker fletter main ind). Done-flip på issuet i samme tur.
- **UI / spilmekanik / auth / prod-data:** PR bliver åben som *ready* med skærmbillede(r); go-kort til ejeren når han er tilbage. Byg dem SIDST i deres bølge, så åbne PR'er ikke blokerer merge-lanerne (loft 5 åbne; er loftet nået, vent med nye UI-spor til ejeren har givet go).
- Migrationer applies af auto-migrate.yml ved merge; Claude post-verificerer STRAKS (Supabase MCP read-only). Destruktive migrationer er ejer-gated: ingen i denne liste (REVOKE af grants er ikke destruktivt).
- Webkit-flake (#4925): rerun, ikke fix. Loop-guard: 2 CI-fails på samme symptom → stop sporet, notér i rapporten.

## Bølge 1: brand-bugs og CI (merges selv)

| Spor | Issue | Hvad | Model |
|---|---|---|---|
| 1A | #5322 | apiFetch skelner "nåede aldrig serveren" fra "serveren svarede fejl"; kaldsteder viser rigtig besked (opfølger til #5312/#5324) | opus |
| 1B | #5302 + #4873 + #4861 | Tre små bugs: relativeDayKey mister "i morgen" ved dansk DST-skift · manager-status springer fra Online til Never · finansloggens sponsorlinje hedder "intro" for alle | sonnet |
| 1C | #5088 | Matviews med GRANT ALL til authenticated: REVOKE-migration (idempotent) + advisor-verify efter merge | opus |
| 1D | #5085 + #5004 + #5326 + #5253 + #5286 + #5094 | CI/tooling-pakke (én PR pr. issue): lint+build marketing/ i CI · preflight kører check-anti-slop · sanitize-secrets-hook fejler uden årsag (bed 2x 17/9) · CDN-cache-tjek retry ved alias-skift · deploy-verify tom-JSON · guard-commit-branch kan omgås når bash ikke er på PATH | sonnet |

## Bølge 2: spillerfund og drift (merges selv; 2D = CI-gate)

| Spor | Issue | Hvad | Model |
|---|---|---|---|
| 2A | #5223 | Dobbelt sprint_captain på samme hold/etape set af motoren (Sentry): rodårsag + guard + test | opus |
| 2B | #5291 + #5224 + #5017 + #5015 | API/Sentry-hygiejne: `/api/races/distribution` HTML 200 → JSON-guard + fejlbesked · `/api/rankings/race-count` 500 med tom fejlbesked · matview-vagt sender `[Object]` + ét fingerprint · Alunta-forfaldsvagt retry ved netværksblip | sonnet |
| 2C | #5321 | Samme rytter viser forskellig rating på to flader (mandia1984 16/9): find de to kilder, ret til én beregning, skriv svarudkast (EN) til ejeren i PR-body | opus |
| 2D | #4123 + #5272 | Kalender-invarianter som CI-gate + gylden kalender-diff (før S4-generering) · reconcilePoolCalendarOnActivation uden raceDayTarget | opus |

## Bølge 3: ops-vagter, forward-guards og perf (merges selv)

| Spor | Issue | Hvad | Model |
|---|---|---|---|
| 3A | #4981 + #5201 | Autobud giver ingen overbudt-notifikation når egen leder forbliver leder (backend) · Klub-sidens Scouting Network-tekst lover 2 samtidige opgaver, reelt kræver det mere (tekst rettes til sandheden, en+da) | sonnet |
| 3B | #2671 + #4645 | Forward-guards: RLS-policy-kaldte funktioner skal have EXECUTE for alle roller (punkt 2+3) · pris på /pro vs Alunta tjekkes mod hinanden i CI | sonnet |
| 3C | #5091 + #5092 + #5093 | monday-numbers kanalmatch domæne-forankret · de to script-tests kører i CI · NOW.md-guard mod sidevogns-PR'er | sonnet |
| 3D | #5177 + #5055 | Perf-resten: index-chunk-sporet fra baseline 11/9 (mål før/efter) · posthog-js → posthog-js-lite (89 KB) | opus |

## Bølge 4: aftalte features (PR til ejer-go medmindre andet står)

| Spor | Issue | Hvad | Model |
|---|---|---|---|
| 4A | #5283 → #5327 | Synlig test af ryttergeneratoren (fødsel uden PCM) FØR U23-ryttere: 1.000 ryttere, fordeling pr. arketype/evne som rapport i PR + CI-test (ejer-krav 15/9) → merges selv. Derefter #5327: færdiggør PR #3512 (arketype-prior i alle genererings-stier): cherry-pick WIP mod main, grøn test, før/efter-fordeling på 1.000 ryttere i PR-body (ejer-krav 4/9) → ejer-go | opus |
| 4B | #4582 | Nedrykning til akademiet arver kontrakten (ejer 4/9). Start fra `wip/4582-demote-inherits-contract` (gemt 17/9): backend + bekræftelses-modal + i18n + e2e, skærmbillede → ejer-go | opus |
| 4C | #5259 | Beta-adgang: beta-tester pr. bruger + flag-stadie off/beta/on i admin + opt-in for spilleren (ejer 15/9, høj prio; #4268 rolle-direktivet), skærmbilleder → ejer-go | opus |
| 4D | #3517 | Forum: klikbare links i indlæg (sanitiseret, kun http/https, rel=noopener) + auto-signatur på profilen (ejerens 3. ønske 9/9), skærmbillede → ejer-go | sonnet |

## Bølge 5: flere aftalte features (PR til ejer-go)

| Spor | Issue | Hvad | Model |
|---|---|---|---|
| 5A | #5226 | Rapportér en afsluttet auktion som eget objekt (slutpris + budhistorik i metadata), samme knap-mønster som #4346 (ejer-direktiv 10/9) → ejer-go | opus |
| 5B | #5257 | Samlet handelsliste: alle handler og rytterskifter, nyeste øverst, med anmeld-knap (T2 wide data, ejer-ønske 15/9) → ejer-go | opus |
| 5C | #4813 + #4982 + #4875 | UX-rettelser med Clarity-/spiller-evidens: transferhistorik-rækker får rigtige links (153/119 døde klik) · manglende padding efter sticky headers på Mit hold · de nye etapetype-ikoner ind i kalenderen (ejer 21/8: ensartede miniaturer) → ejer-go med før/efter-skærmbilleder | sonnet |
| 5D | #2748 | Pensionering: squad-minimum-check + forvarsel med fuld lead-time ved masse-retirement (rest efter PR #5109) → ejer-go (spilmekanik) | opus |

## Hvis tid (i denne rækkefølge)

- #5242 apiFetch PR 2: de 214 kaldsteder i skiver à ~50, EFTER 1A er merget → merges selv pr. skive ved grøn e2e.
- #4521 SSOT-dokument for patch notes (site + Discord): `docs/PATCH_NOTES_RULES.md` fra TONE §2 + udsnit-praksis 17/9 → merges selv.
- #5328 + #5329 ai-ops-guards (søndagsrapport-rutine, triage:new-alder-guard) → merges selv.
- #5249 + #5250 (ejer-beslutning 14/9 på PR #5239): forsiden `/` statisk og CDN-cachet + ægte session-cookie i stedet for markør-cookien. Auth → PR til ejer-go med verifikation på preview; `node scripts/check-cdn-cache-headers.mjs` før merge.
- #4702 bunch-tid: ryttere i samme gruppe får samme sluttid (motor) → ejer-go.
- Read-only-rapporter (ingen prod-mutation, én agent): #5203 fair-play-gennemgang (45 flag klassificeret, whitelist-forslag, #5282 transfer-ring-analyse) → `docs/audits/2026-09-17-fairplay-uge38.md` · #4829 verificér at de 4 AI-hold blev nedlagt efter Settimana og puljerne faldt til target · #4867 prod-DB-genstart 3/9: læs Supabase-logs, konklusion i issuet · #4924 forældreløse checkout-mapper: liste til ejer-go · #5179 svarudkast (EN+DA) om hjælperytternes niveau vs. kaptajnens point (ejeren poster).

## Rør IKKE (ejer-samtale udestår)

Træningsdesign (B3 #5281, B4 #5264, #5169, #5267, loft #5268, tick-akse, Åbnere #5238, D1-D3 #4852-#4854, #4848, træningssiden, `wip/assistant-training-suggestions`) · win-back-sending (#2760) · icebox-batch 2 · de 31 needs-decision (også #5306, #5304, #5305, #5310, #5030, #5059) · roadmap_items i prod · Quad9-DNS (#5323) · Discord-/forum-opslag (ejeren poster selv) · backup-tabeller (#2259, #3633).

## Close-out (obligatorisk, i denne rækkefølge)

1. Done-flip PR-for-PR (`claude:done`, kommentar "Shipped i PR #N (squash <hash>)"); UI-PR'er: `claude:in-progress` + go-kort-tekst klar i NOW.
2. Samlet patch note for alle spillervendte merges (én version, EN + DA, TONE §2) i `frontend/src/data/patchNotes.js` som egen docs-PR → merges selv ved grøn CI. Discord-udsnit tilføjes til `docs/drafts/discord-patch-notes-2026-09-17.md` (ejeren poster).
3. NOW.md: 🎯 Next action = ejerens go-kort (ét pr. UI-PR med skærmbillede) + de fire udskudte samtaler fra 17/9; 🤖 Working agent = "Ingen aktiv session". MASTERPLAN ✅-markeringer + Masterplan-artifact republiceret (samme URL https://claude.ai/artifact/UoZexVskbfA5xmvTnML4Bn, hard rule 34). WEEKLY_STEERING-log: én række.
4. `pwsh -File scripts/check-agent-token-hygiene.ps1` uden FAIL · `pwsh -File scripts/close-out-cleanup.ps1 -Execute` · postmortem i `.claude/learnings/` pr. bugfix.
5. Slutrapport til ejeren i chatten: merget / åbne PR'er med skærmbilleder / "allerede lavet"-fund / stoppede spor med årsag / hvad han skal gøre (ét kort ad gangen når han er tilbage).
