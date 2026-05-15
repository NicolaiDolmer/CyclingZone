# 2026-05-15 — local-only agent context drift

## Trigger
User corrected Codex after it nearly treated `.codex.local/SESSION_CONTEXT.md` as a handoff source while preparing a two-PC/mobile workflow.

## Root cause
Repo docs still described `SESSION_CONTEXT.md` as per-PC and sometimes manually updated by Codex. That conflicted with the actual cross-device requirement: all durable project context must be readable by GitHub or OneDrive-connected tools across PC 1, PC 2, phone, ChatGPT, Claude.ai, Claude Code, Codex, Manus, and collaborators.

## Rule
Local agent files are caches/pointers only. If a fact affects future work, write it to GitHub (`docs/NOW.md`, issues, slice-docs, repo docs) or OneDrive-context before ending the session.

## Verification cue
At close-out, ask: "Could the next device continue if this local machine disappeared right now?" If no, migrate the missing context before commit/push.
