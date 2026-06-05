# Parallel session skiftede branch i samme arbejdsmappe → klippede mit ucommittede tree

**Dato:** 2026-06-06
**Kontekst:** #955 board plan-faner (slice 1). Solo-arbejde i `C:\Dev\CyclingZone` (hoved-checkout).

## Symptom
Midt i implementeringen (efter ~10 edits til `BoardPage.jsx` + `board.json`, build + tests + Playwright grøn) viste et Playwright-screenshot pludselig **den gamle grid-layout**, og `git status` viste `BoardPage.jsx` som **ikke-modificeret** — som om alt arbejde var rullet tilbage. Mine specs havde lige passeret, så koden *havde* været korrekt.

## Rod-årsag
`git reflog` afslørede at en **anden AI-session** (OnlineBadge `bg-cz-subtle0`-spawn-task) kørte i **samme arbejdsmappe** og lavede en branch-dans MENS jeg arbejdede:

```
feat/955 → main → fix/online-badge-offline-dot-token → (commit) → feat/955
```

Da den session skiftede væk fra min branch, bar git mine **ucommittede** working-tree-ændringer med over til de andre branches og tilbage igen. I tidsvinduet hvor træet var checket ud til en anden branch så `git status`/screenshots det "gamle" indhold. Ændringerne var ikke *tabt* (git bevarede dem), men arbejdstræet var midlertidigt inkonsistent — og havde den anden session lavet en konfliktende edit eller `checkout -f`, *ville* de være tabt.

`docs/NOW.md` sagde "Working agent: Ingen aktiv session", så multi-AI-claim-signalet (#559) var ikke sat af den anden session.

## Forward-guard
1. **Commit tidligt og ofte ved risiko for parallelle sessioner.** Committet arbejde overlever branch-skift; ucommittet er sårbart. Så snart en sammenhængende del er verificeret → commit (kan altid squashes senere).
2. **Brug et dedikeret git-worktree** (`scripts/new-worktree.ps1`, `C:\Dev\CyclingZone-worktrees`) når der er nogen chance for en parallel session. Worktree = separat checkout → branch-skift i hoved-dir kan ikke røre det. Se memory `feedback_worktree_edit_main_checkout_path` + `feedback_worktree_before_parallel_commits`.
3. **Mistænk reflog, ikke dig selv, ved "mine ændringer forsvandt".** `git reflog` afslører branch-skift fra andre sessioner. Status der modsiger en netop-passeret test = ekstern mutation, ikke en fejlet edit.
4. **NOW.md "Working agent" er kun pålidelig hvis alle sessioner sætter den.** En tavs parallel session bryder claim-protokollen — verificér med reflog/`git status` ved tvivl.

## Hvad reddede det
git bar ændringerne tilbage da den anden session returnerede til `feat/955`; `git diff --stat` bekræftede fuldt intakt tree. Committede straks for at gøre arbejdet durable, re-verificerede (build + 175 tests + core-smoke 18/18 + board-plan-tabs), derefter PR #1088.
