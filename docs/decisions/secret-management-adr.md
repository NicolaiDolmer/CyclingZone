# ADR: Professional secret management for CyclingZone

**Status:** Proposed — requires Nicolai approval before implementation  
**Date:** 2026-05-12  
**Owner:** Manus AI  
**Issue:** [#327](https://github.com/NicolaiDolmer/CyclingZone/issues/327)  
**Parent:** [#323](https://github.com/NicolaiDolmer/CyclingZone/issues/323)

---

## Decision

CyclingZone should adopt **Infisical as the canonical secret-management system** for production-critical and CI-critical secrets. The first implementation should use Infisical as a managed service rather than self-hosting it, because the immediate goal is to remove fragile OneDrive hardlinks without introducing new infrastructure ownership. Self-hosted Infisical remains the documented future option if the project later needs stricter sovereignty, cost control, or custom operational policy.

The target model is not to delete all native platform secret stores. **Infisical becomes the source of truth**, while GitHub Actions, Vercel, Railway, and Supabase continue to act as runtime delivery surfaces where needed. GitHub Actions should prefer Infisical OIDC machine identities for workflows that need secrets at runtime, because Infisical supports GitHub-issued short-lived OIDC tokens and avoids storing long-lived third-party tokens in GitHub secrets.[^1] Vercel and Railway should keep their native environment variables for deployed runtime configuration, but those values should be populated from Infisical during migration and then treated as downstream copies rather than source-of-truth records.[^2] [^3]

OneDrive must no longer be used for **production-critical secrets** such as Supabase service keys, database URLs, GitHub PATs, Google service-account JSON, Railway or Vercel deployment tokens, Claude OAuth tokens, Discord webhooks, or future payment/auth secrets. A temporary hybrid exception is accepted only for **non-production AI context** and local convenience files that cannot yet be managed cleanly through Infisical, such as Claude memory and possibly per-machine MCP bootstrap metadata. That exception must be explicitly tracked and reviewed after migration.

> **Decision rule:** if a value can grant access to production data, CI deployments, external APIs, or account-level automation, it belongs in Infisical first. If a file only improves agent memory or local ergonomics and cannot execute privileged production actions by itself, it may remain local or OneDrive-synced temporarily.

---

## Context and problem

The current cross-PC model stores several gitignored files as hardlinks into `~/OneDrive/CyclingZone-context/`. The repository documentation currently states that `backend/.env`, `frontend/.env`, `frontend/.env.production`, `.mcp.json`, `.codex.local/SUPABASE_CONTEXT.md`, and `.codex.local/supabase-readonly.env` are synced through OneDrive hardlinks or junctions. The script `scripts/link-onedrive-context.ps1` implements this by linking production-like `.env` files from the OneDrive `secrets/` directory and Codex-local Supabase files from the OneDrive `codex-local/` directory.

That model solved cross-PC drift quickly, but it is no longer adequate for the project’s growth target. OneDrive file sync is not a secret manager: it does not provide workflow-scoped access, short-lived credentials, audit-friendly rotation, environment-level policy, or clean separation between production runtime secrets and AI-agent convenience context. It also creates a high-blast-radius local file surface, because every linked PC receives the same sensitive files.

The issue asks for either a professional secret-management replacement or a formally accepted transition risk. This ADR chooses replacement for production-critical secrets and allows only a narrowly scoped temporary hybrid for AI context.

---

## Runtime-verified secret inventory

This inventory intentionally records **file paths and variable names only**, not values. It was derived from the current repo state, GitHub workflow references, local env-file key names, `docs/CROSS_PC_SETUP.md`, and `scripts/link-onedrive-context.ps1`.

| Surface | Current location or reference | Secret/config names observed | Target owner | Migration priority |
|---|---|---|---|---|
| Backend local runtime | `backend/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `FRONTEND_URL`, `PORT` | Infisical source of truth; local generated `.env` only | P0 |
| Backend example | `backend/.env.example` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `FRONTEND_URL`, `PORT`, `DISCORD_DM_TARGET` | Repo example remains non-secret | P2 |
| Frontend local runtime | `frontend/.env` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` | Infisical for local bootstrap; Vercel runtime copy for deploy | P1 |
| Frontend production build | `frontend/.env.production` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_CLARITY_PROJECT_ID` | Infisical source; Vercel env delivery | P1 |
| Codex Supabase readonly context | `.codex.local/supabase-readonly.env` | `SUPABASE_URL`, `SUPABASE_READONLY_DSN`, `SUPABASE_READONLY_KEY` | Infisical if still needed; otherwise regenerate per PC | P1 |
| MCP configuration | `.mcp.json` | JSON object under `mcpServers`; values may include connector tokens or command args | Split: non-secret config in repo template; secrets in Infisical/manual connector stores | P1 |
| GitHub Actions migrations | `.github/workflows/auto-migrate.yml` | `SUPABASE_DB_URL` | Infisical OIDC fetch in workflow | P0 |
| GitHub Actions audits and drift monitor | `.github/workflows/drift-monitor.yml`, `feature-liveness-audit.yml`, `rls-audit.yml`, `uci_sync.yml` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DISCORD_WEBHOOK`, `UCI_GOOGLE_SERVICE_ACCOUNT_JSON`, `UCI_GOOGLE_SHEET_ID` | Infisical OIDC fetch in workflow | P0 |
| GitHub Actions Claude automation | `.github/workflows/claude.yml`, `claude-review.yml`, `claude-triage.yml` | `CLAUDE_CODE_OAUTH_TOKEN` | Infisical if action supports env injection; otherwise GitHub secret as downstream copy | P0 |
| GitHub project automation | `.github/workflows/add-to-project.yml` | `PROJECTS_PAT` | Infisical if workflow can fetch before use; otherwise GitHub secret as downstream copy | P1 |
| GitHub built-in token | Multiple workflows | `GITHUB_TOKEN` | Native GitHub only; not managed in Infisical | N/A |
| Vercel frontend deploy | Vercel project settings | Frontend `VITE_*` values and any future frontend runtime config | Vercel delivery, populated from Infisical source | P1 |
| Railway backend deploy | Railway service variables | Backend `SUPABASE_*`, `FRONTEND_URL`, future backend runtime values | Railway delivery, populated from Infisical source | P1 |
| Claude memory | `~/.claude/projects/<encoded>/memory/`, currently OneDrive junction | Agent memory, not a normal app secret | Temporary hybrid; do not mix with production secrets | P3 |
| OneDrive context store | `~/OneDrive/CyclingZone-context/secrets/`, `codex-local/`, `memory/` | Current hardlink source files | Decommission for production secrets | P0-P2 |

GitHub’s native secret mechanism is still relevant but should not be the only cross-platform source of truth. GitHub documents repository, environment, and organization secrets and exposes them through the `secrets` context, while also noting that OIDC can remove the need to store long-lived cloud credentials in workflows where supported.[^4]

---

## Option analysis

| Option | Fit for CyclingZone | Strengths | Weaknesses | Decision |
|---|---|---|---|---|
| Infisical | High | Open-source product family, machine identities, GitHub Actions OIDC, one source of truth, future self-host path | Requires onboarding, project/env structure, and migration discipline | **Chosen** |
| Doppler | Medium-high | Strong developer UX and documented syncs into GitHub/Railway | GitHub path is primarily a sync into GitHub secrets; import/bootstrap can require service tokens, and it is less aligned with avoiding long-lived GitHub-held credentials | Not chosen |
| Native only: GitHub Secrets + Vercel env + Railway variables | Medium | No new vendor and lowest operational overhead | No single source across platforms; drift remains likely; manual PC bootstrap remains weak | Rejected as final model |
| Hybrid native + OneDrive AI context | Medium as transition | Minimal disruption and preserves existing agent convenience | Leaves OneDrive risk in place if not tightly scoped | Accepted only for non-production transition |

Infisical is selected because the most important hardening objective is to reduce long-lived secret sprawl while keeping automation feasible. Infisical’s GitHub Actions integration supports OIDC machine identities, where GitHub issues a short-lived token and Infisical validates repository/workflow claims before issuing runtime access to authorized secrets.[^1] Doppler is a credible alternative, but its GitHub Actions documentation emphasizes syncing values into GitHub secrets through a GitHub App, and it notes that existing GitHub secret values cannot be imported through GitHub’s API because GitHub hides those values.[^5]

Railway and Vercel remain important deployment surfaces. Railway variables are exposed during service builds, running deployments, `railway run`, and `railway shell`, and Railway supports sealed variables with stricter retrieval limits.[^3] Vercel environment variables are encrypted at rest, scoped by project/team and environment, and can be pulled locally with `vercel env pull` for Development variables.[^2] Those native capabilities should be used for runtime delivery, but not as the canonical inventory.

---

## Target architecture

The target architecture is a **hub-and-spoke secret model**. Infisical is the hub. GitHub Actions, Vercel, Railway, Supabase operational credentials, and local developer machines are spokes.

| Flow | Target behavior |
|---|---|
| CI workflow needs Supabase or Google credentials | GitHub Actions obtains a short-lived OIDC token, Infisical verifies the workflow identity, and the workflow receives only the required secrets for that job. |
| Frontend deploy needs public Vite values | Values are stored in Infisical and copied into Vercel environment variables for Production/Preview/Development. Public `VITE_*` values are still treated as configuration, but source-of-truth remains Infisical. |
| Backend deploy needs Supabase service key | Value is stored in Infisical and copied into Railway service variables. Railway sealed variables should be considered for values that do not need CLI retrieval. |
| Local backend/frontend development | Developers run an explicit bootstrap command that materializes `.env` files from Infisical into local gitignored files, or they use platform CLIs such as `vercel env pull` and `railway run` where appropriate. |
| New PC setup | Git clone and tool login are enough for code. Production secrets are pulled from Infisical after explicit authentication, not from OneDrive. |
| Agent memory and non-secret context | May remain local or OneDrive-synced temporarily, but must be physically separated from production secrets and documented as non-authoritative. |

---

## Migration plan

The migration should happen in deliberate phases. No production secret values should be printed in terminal logs, issue comments, or committed files during any phase.

| Phase | Owner | Actions | Exit criteria |
|---|---|---|---|
| 0. ADR approval | Nicolai | Review this ADR and approve, reject, or amend the selected direction. | Issue #327 has an approval comment. |
| 1. Infisical project setup | Nicolai + Manus/Claude support | Create Infisical org/project, define environments `dev`, `preview`, `prod`, and create machine identities for GitHub Actions. | Empty project structure exists; no app behavior changed. |
| 2. Secret import | Nicolai + Claude/Codex local support | Import current GitHub, Vercel, Railway, Supabase, Google, Discord, Claude, and local env values into Infisical. Use manual copy from authoritative dashboards, not log output. | Infisical has the complete inventory with owners and environments. |
| 3. GitHub Actions OIDC pilot | Claude | Convert one low-blast-radius workflow first, preferably `drift-monitor.yml` or a read-only audit workflow, to fetch secrets from Infisical via OIDC. | Workflow succeeds and secret gates remain green. |
| 4. CI migration | Claude | Migrate remaining secret-backed workflows: auto migration, RLS audit, feature liveness audit, UCI sync, drift monitor, Claude automation where supported. | GitHub repository secrets are reduced to unavoidable native values and public Infisical identifiers. |
| 5. Runtime deployment alignment | Claude + Nicolai | Populate Vercel and Railway envs from Infisical source values. Consider Railway sealed variables for high-risk backend secrets that do not need CLI retrieval. | Vercel and Railway deployments remain healthy after redeploy. |
| 6. Local bootstrap replacement | Codex | Replace OneDrive secret hardlink bootstrap with a documented Infisical/local bootstrap path. Update `docs/CROSS_PC_SETUP.md`, setup scripts, and `scripts/agent-doctor.ps1`. | New PC setup no longer requires OneDrive hardlinks for production secrets. |
| 7. OneDrive decommission | Codex + Nicolai | Remove production secrets from `~/OneDrive/CyclingZone-context/secrets/`. Leave only approved non-secret context or archive it outside the automation path. | `scripts/link-onedrive-context.ps1` no longer links production `.env` files. |

---

## Rollback plan

Rollback must prioritize service continuity without reintroducing silent drift. If any migration phase breaks deployments or automation, revert only the affected spoke and preserve Infisical as the developing source of truth unless the ADR itself is rejected.

| Failure point | Rollback step | Safety note |
|---|---|---|
| Infisical project setup is incomplete | Stop before importing secrets; no runtime impact. | No code or platform values should have changed. |
| OIDC workflow fails | Revert that workflow to its previous GitHub `secrets.*` references. | Keep the Infisical machine identity disabled until fixed. |
| Vercel env mismatch | Restore previous Vercel env value from Vercel dashboard history/manual backup and redeploy. | Do not copy from logs. |
| Railway env mismatch | Revert staged Railway variable changes before deploy, or restore previous values manually and redeploy. | Railway variable changes are staged before application, which gives a review point.[^3] |
| Local bootstrap blocks development | Temporarily keep local `.env` files on the affected PC, but do not resync them through OneDrive. | Local fallback is allowed; OneDrive production-secret sync is not. |
| Infisical outage during transition | Use existing native platform secrets for already-migrated runtime surfaces until availability returns. | This is why native stores remain delivery surfaces during phase one. |

---

## Accepted residual risks

This ADR intentionally accepts a few transition risks because a big-bang migration would be more dangerous than a phased migration.

| Risk | Why accepted | Mitigation |
|---|---|---|
| Native platform stores remain populated | Vercel and Railway need runtime env delivery, and GitHub may need unavoidable native secrets for integrations that cannot fetch from Infisical before authentication. | Mark native stores as downstream copies, document owners, and reconcile during monthly secret review. |
| Some AI context remains outside Infisical temporarily | Claude memory and MCP bootstrap are operationally distinct from app runtime secrets and may not map cleanly to Infisical on day one. | Separate non-secret context from production secrets and remove privileged tokens from OneDrive first. |
| Public frontend variables remain easy to discover | `VITE_*` values are bundled or exposed to browsers by design. | Treat frontend keys as public configuration; never put service-role keys in frontend variables. |
| Migration requires manual value handling | Existing GitHub secret values cannot be fetched back through GitHub APIs, so some manual copy from dashboards is unavoidable.[^5] | Use a checklist and never print values in logs, comments, or commits. |
| New vendor dependency | Infisical becomes a security-critical control plane. | Keep native stores as delivery copies initially and retain self-host option as future escape hatch. |

---

## Implementation guardrails

Implementation must not start until this ADR is approved in issue #327. After approval, implementation should be done in a PR with `manual-review` retained. The implementation PR should update `docs/CROSS_PC_SETUP.md`, `docs/HOOKS.md` if hook behavior changes, `scripts/link-onedrive-context.ps1`, `scripts/setup-new-pc.ps1`, and `scripts/agent-doctor.ps1` as needed. It should also update `docs/FEATURE_STATUS.md` only if project feature/state tracking changes.

Patch notes are not required for this ADR itself because it is documentation-only and has no user-facing runtime/UI effect. The implementation PR may also skip user-facing patch notes if it only changes developer/security operations, but the commit or PR description must state that rationale explicitly.

The verification path for implementation is:

| Check | Required result |
|---|---|
| `git grep -n "OneDrive-context/secrets\|backend.env\|frontend.env.production\|mcp.json" docs scripts AGENTS.md` | No production-secret hardlink instructions remain, except historical notes or explicit deprecation text. |
| `pwsh -File scripts/agent-doctor.ps1` | Still green or reports only documented non-blocking warnings. |
| GitHub secret-backed workflows | Converted workflows pass with Infisical OIDC or intentionally documented native fallback. |
| Vercel frontend deploy | Production deploy still resolves required `VITE_*` values. |
| Railway backend deploy | Backend starts with required `SUPABASE_*` and `FRONTEND_URL` values. |
| New PC bootstrap dry-run | Does not require OneDrive production-secret hardlinks. |

---

## Handoff recommendation

After Nicolai approves this ADR, dispatch implementation as a high-risk manual-review slice. Recommended next agent is **Claude** for the initial implementation because workflow authentication, setup scripts, and cross-platform deployment secrets touch multiple contracts. Codex can then validate the local bootstrap and documentation drift.

**Do not dispatch implementation before approval.** The only safe next action after committing this ADR is an issue comment asking for human approval of the proposed Infisical-first direction.

---

## References

[^1]: [Infisical Docs — GitHub Actions](https://infisical.com/docs/integrations/cicd/githubactions)
[^2]: [Vercel Docs — Environment Variables](https://vercel.com/docs/environment-variables)
[^3]: [Railway Docs — Using Variables](https://docs.railway.com/variables)
[^4]: [GitHub Docs — Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
[^5]: [Doppler Docs — GitHub Actions](https://docs.doppler.com/docs/github-actions)
