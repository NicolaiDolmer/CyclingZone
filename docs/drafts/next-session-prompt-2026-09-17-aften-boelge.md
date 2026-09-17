# Prompt til næste session (17/9 aften): stor workflow-session på aftalte, færdigdesignede opgaver

> Ejer-mandat 17/9 kl. 16: *"arbejd videre i en ny session på ting der allerede er aftalt og designet færdigt med mig. Vælg opgaver du er sikker på hvordan man laver. Jeg er væk i 4-5 timer. Du må gerne lave mange opgaver. Skal være god stor workflow-session."* Listen herunder er sendt til ejeren til endelig godkendelse; kør den som godkendt medmindre ejeren har fjernet punkter i sit svar.

## Start (før første spawn)

1. Læs `docs/NOW.md`, `docs/NIGHT_WAVE_RUNBOOK.md` (hele), `docs/PARALLEL_WORKTREE_ORCHESTRATION.md` og denne fil. Sæt **🤖 Working agent** i NOW.md til "Aftenbølge 17/9 (workflow)".
2. `git pull` på main (rør ikke branch i hoved-checkoutet; alt byggearbejde i worktrees via `.claude/workflows/wave.js`).
3. Byg KUN via `Workflow({ scriptPath: "C:\Dev\CyclingZone\.claude\workflows\wave.js", args: { tracks: [...] } })`. Maks 4 laner, verifikations-semafor 2, maks 5 åbne PR'er, livstegn (draft-PR 30 min, push 15 min, timeout 60 min, recovery i samme worktree). `model` eksplicit pr. spor (sonnet til mekanisk/CI/docs, opus til motor/økonomi/UI). Fable bygger aldrig selv.
4. Worker-prompt SKAL indeholde: issue-nummer i PR-titel · Write→fil + `git commit -F` (aldrig heredoc) · `gh`/`git` bart, `git -C <worktree>` · preflight/tests i FORGRUNDEN · push hvert 15. min · rør aldrig `docs/NOW.md` · ingen patch note i PR'en (samles ved close-out) · copy efter `docs/TONE_OF_VOICE.md` (jeg/du, EN først, DA under) · page templates + TASTE for UI · `FLAG_GATED_EMPTY_TABLES` ved ny tabel bag flag.

## Merge-politik i denne session (WEEKLY_STEERING-reglen)

- **Backend / drift / CI / docs / tests:** Claude merger selv ved grøn CI + CodeRabbit, én ad gangen (`gh pr merge N --squash --delete-branch --admin` bart; `gh pr update-branch` først). Done-flip på issuet i samme tur.
- **UI / spilmekanik / prod-data:** PR bliver åben som *ready* med skærmbillede(r) i PR-body; go-kort til ejeren når han er tilbage. Byg dem SIDST så de åbne PR'er ikke blokerer merge-lanerne (loft 5 åbne).
- Migrationer applies af auto-migrate.yml ved merge; Claude post-verificerer STRAKS (Supabase MCP read-only). Destruktive migrationer er ejer-gated: ingen i denne liste.
- Webkit-flake (#4925): rerun, ikke fix. Loop-guard: 2 CI-fails på samme symptom → stop sporet, notér.

## Bølge 1: brand-bugs og CI (merges selv)

| Spor | Issue | Hvad | Model | Verify |
|---|---|---|---|---|
| 1A | #5322 | apiFetch skelner "nåede aldrig serveren" fra "serveren svarede fejl"; kaldsteder viser rigtig besked (opfølger til #5312/#5324) | opus | targeted e2e + node --test |
| 1B | #5302 | relativeDayKey mister "i morgen" ved dansk DST-skift (bug fra #5300-review) | sonnet | node --test |
| 1C | #5088 | Matviews med GRANT ALL til authenticated: REVOKE-migration (idempotent) + advisor-verify efter merge | opus | migration-idempotency + post-verify via MCP |
| 1D | #5085 + #5004 + #5326 + #5253 + #5286 | CI/tooling-pakke: lint+build marketing/ i CI · preflight kører check-anti-slop · sanitize-secrets-hook fejler uden årsag (bed 2x 17/9) · CDN-cache-tjek retry ved alias-skift · deploy-verify tom-JSON | sonnet | scripts' egne tests, én PR pr. issue |

## Bølge 2: spillerfund og drift (merges selv, undtagen 2D)

| Spor | Issue | Hvad | Model | Verify |
|---|---|---|---|---|
| 2A | #5223 | Dobbelt sprint_captain på samme hold/etape set af motoren (Sentry) – rodårsag + guard | opus | node --test motor |
| 2B | #5291 + #5224 | `/api/races/distribution` svarer HTML 200 → JSON-guard + fejlbesked; `/api/rankings/race-count` 500 med tom fejlbesked → ægte fejlbesked i Sentry | sonnet | node --test backend |
| 2C | #5321 | Samme rytter viser forskellig rating på to flader (mandia1984 16/9): find de to kilder, ret til én beregning, skriv svarudkast til ejeren (EN) i PR-body | opus | node --test + e2e på begge flader |
| 2D | #4123 | Kalender-invarianter som CI-gate + gylden kalender-diff (før S4-generering) | opus | CI-gaten selv grøn på S3-kalenderen |

## Bølge 3: aftalte features (PR til ejer-go, byg sidst)

| Spor | Issue | Hvad | Model | Verify |
|---|---|---|---|---|
| 3A | #5283 | Synlig test af ryttergeneratoren (fødsel uden PCM) FØR U23-ryttere genereres: 1.000 ryttere, fordeling pr. arketype/evne som rapport i PR + CI-test (ejer-krav 15/9). Backend/test → merges selv | opus | node --test + rapport |
| 3B | #4582 | Nedrykning til akademiet arver kontrakten (ejer 4/9). Start fra `wip/4582-demote-inherits-contract` (gemt 17/9): backend + bekræftelses-modal + i18n | opus | node --test + e2e + skærmbillede → ejer-go |
| 3C | #5259 | Beta-adgang: beta-tester pr. bruger + flag-stadie off/beta/on i admin + opt-in for spilleren (ejer 15/9, høj prio; #4268 rolle-direktivet) | opus | e2e admin + settings, skærmbilleder → ejer-go |
| 3D | #3517 | Forum: klikbare links i indlæg (sanitiseret, kun http/https) + auto-signatur på profilen (ejerens 3. ønske 9/9) | sonnet | e2e forum, skærmbillede → ejer-go |

## Hvis tid (efter bølge 3, i prioriteret rækkefølge)

- #5257 samlet handelsliste (T2 wide data, nyeste øverst, anmeld-knap) → ejer-go.
- #5242 apiFetch PR 2: de 214 kaldsteder i skiver à ~50 (EFTER #5322 er merget) → merges selv pr. skive ved grøn e2e.
- #4521 SSOT-dokument for patch notes (site + Discord): `docs/PATCH_NOTES_RULES.md`, konvention fra TONE §2 + dagens udsnit-praksis → merges selv.
- #5328 + #5329 ai-ops-guards (søndagsrapport-rutine, triage:new-alder-guard) → merges selv.
- #5203 fair-play-gennemgang: READ-ONLY-agent laver rapporten (45 flag klassificeret, whitelist-forslag, #5282 transfer-ring-analyse) til `docs/audits/2026-09-17-fairplay-uge38.md`; ingen prod-mutation.

## Rør IKKE (ejer-samtale udestår)

Træningsdesign (B3 #5281, B4 #5264, #5169, #5267, loft #5268, tick-akse, Åbnere #5238, D1-D3 #4852-#4854, træningssiden, `wip/assistant-training-suggestions`) · win-back-sending (#2760) · icebox-batch 2 · de 31 needs-decision · roadmap_items i prod · Quad9-DNS (#5323) · Discord-opslag (ejeren poster selv).

## Close-out (obligatorisk, i denne rækkefølge)

1. Done-flip PR-for-PR (`claude:done`, kommentar "Shipped i PR #N (squash <hash>)"); UI-PR'er: `claude:in-progress` + go-kort-tekst klar i NOW.
2. Samlet patch note for alle spillervendte merges (én version, EN + DA, TONE §2) i `frontend/src/data/patchNotes.js` som egen docs-PR → merges selv ved grøn CI.
3. NOW.md: 🎯 Next action = ejerens go-kort (én pr. UI-PR med skærmbillede) + de fire udskudte samtaler fra 17/9; 🤖 Working agent = "Ingen aktiv session". MASTERPLAN ✅-markeringer + Masterplan-artifact republiceret (samme URL, hard rule 34). WEEKLY_STEERING-log: én række.
4. `pwsh -File scripts/check-agent-token-hygiene.ps1` uden FAIL · `pwsh -File scripts/close-out-cleanup.ps1 -Execute` · postmortem i `.claude/learnings/` pr. bugfix (2A, 2B, 2C).
5. Slutrapport til ejeren i chatten: merget / åbne PR'er med skærmbilleder / stoppede spor med årsag / hvad han skal gøre (ét kort ad gangen når han er tilbage).
