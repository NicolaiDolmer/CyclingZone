# AI Ops — Quality Canaries

Regression-tjekliste. Kør EFTER hver token-reduktions-fase (Phase 1-5 i [scalable-wobbling-blossom plan](../../../Users/emmas/.claude/plans/scalable-wobbling-blossom.md)). Hvis nogen canary fejler, har vi skåret en regel/erfaring væk vi havde brug for — den skal genindføres i MEMORY.md som HOT-tier.

Status-noter:
- 🟢 PASS — adfærd intakt
- 🔴 FAIL — adfærd tabt, regel skal restaureres
- ⚪️ N/A — ikke testet denne runde

## Canaries

| # | Canary (forventet AI-adfærd) | Hvor reglen kom fra | Sidst tjekket | Status |
|---|------------------------------|---------------------|---------------|--------|
| 1 | AI pusher automatisk til origin efter commit (Vercel deployer kun ved push) | `feedback_git_push.md` | — | ⚪️ |
| 2 | AI bumper version i `frontend/src/pages/PatchNotesPage.jsx` ved enhver brugerrettet commit | `feedback_patch_notes.md` | — | ⚪️ |
| 3 | AI bruger `gh issue create --body-file` (ikke MCP `issue_write`) i hovedsession | `feedback_github_mcp_issue_write_403.md` | — | ⚪️ |
| 4 | AI kører `npm run build` lokalt FØR push ved dependency-ændringer; `verify-deploy.ps1` EFTER push | `feedback_verify_before_push.md` | — | ⚪️ |
| 5 | AI bruger `Write` til commit-message-fil + `git commit -F` i Bash-tool (ikke `@'...'@` PowerShell-heredoc) | `feedback_bash_no_powershell_heredoc.md` | — | ⚪️ |
| 6 | AI bruger ikke "Closes #N" i commits — bruger `Refs #N` + `claude:done` label, lader brugeren lukke | `feedback_github_close_protocol.md` | — | ⚪️ |
| 7 | AI verificerer at PR-body har `## Brugerverifikation`-sektion ELLER `backend-only`/`docs-only` label | `feedback_pr_body_brugerverifikation.md` | — | ⚪️ |
| 8 | AI signalerer 🟢/🟡/🔴/🆕 ved naturlige break-points (close-out-rytme) | `feedback_session_rhythm.md` | — | ⚪️ |
| 9 | AI læser kode-kommentarer FØR den råber bug på mistænkelige data-mønstre (free-agent flow etc.) | `feedback_read_code_comments_first.md` | — | ⚪️ |
| 10 | AI verificerer RLS-tabeller som `authenticated` rolle FØR DONE-claim (RLS enabled + 0 policies = deny) | `feedback_rls_verify_authenticated.md` | — | ⚪️ |

## Tier-fortolkning

Hvis canary #X fejler:
1. Den underliggende rule i `memory/*.md` er enten slettet eller demoteret til WARM
2. Promotér tilbage til HOT — tilføj entry i `MEMORY.md` (auto-loaded)
3. Notér i tabel: hvilken fase fjernede den, hvorfor canary fangede det

## Sådan tester du

Manuel: start ny session, giv AI en opgave der trigger reglen (fx `commit denne fix og send live`), tjek om AI auto-pusher (#1). Hvis ja → 🟢.

Lazy: efter første rigtige feature-session post-cut, kig tilbage på transkriptet og kryds af hvilke canaries der naturligt blev udløst og hvordan AI agerede.
