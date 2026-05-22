#!/usr/bin/env bash
# cycling-manager: SessionStart self-heal
# - Pulls main if behind origin (FF-only, never destructive)
# - Removes stale claude/* worktrees that are fully merged to origin/main
# - Removes orphan disk dirs in .claude/worktrees/ (with OneDrive-lock retry)
# - Removes merged local feature branches without worktrees (claude/* feat/* fix/* chore/* docs/* ci/*)
# - Skips the current session's own worktree (impossible to remove from inside)
# - Skips dirs with activity in last 30 min (likely concurrent session)
# - Emits a one-line systemMessage summarizing what was cleaned (visible to user)
# Always exits 0; never blocks Claude session start.
#
# Cross-PC: REPO root is detected via `git rev-parse --show-toplevel` from CWD,
# so the same script works on any PC regardless of where the repo lives.
# Only runs when CWD is inside a CyclingZone/cycling-manager repo (verified via
# origin remote URL).

set +e

CWD="$(pwd)"
LOG="$(mktemp -t cm-cleanup.XXXXXX 2>/dev/null || echo /tmp/cm-cleanup-$$)"
exec 2>"$LOG"

# Detect repo root portably. Skip silently if not in a git repo.
REPO="$(cd "$CWD" && git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO" ] && exit 0

# Only run for CyclingZone/cycling-manager. Other repos must not be touched.
REMOTE_URL="$(cd "$REPO" && git config --get remote.origin.url 2>/dev/null)"
case "$REMOTE_URL" in
  *CyclingZone*|*cycling-manager*) ;;
  *) exit 0 ;;
esac

# Counters for end-of-run summary.
REMOVED_WTS=0
REMOVED_DIRS=0
REMOVED_BRANCHES=0
SKIPPED_LOCKED=0

# Capture current worktree top BEFORE cd'ing.
# Fallback to CWD if git lost track of this worktree (corrupt gitdir).
CURRENT_WT="$(cd "$CWD" && git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$CURRENT_WT" ] && CURRENT_WT="$(cygpath -m "$CWD" 2>/dev/null || echo "$CWD")"

cd "$REPO" || exit 0

# Helper: rm with retry for OneDrive file-locks. 3 tries, 1s apart.
rm_with_retry() {
  local target="$1"
  local i
  for i in 1 2 3; do
    rm -rf "$target" 2>>"$LOG"
    [ ! -e "$target" ] && return 0
    sleep 1
  done
  return 1
}

# Helper: convert C:/foo/bar -> /c/foo/bar for MSYS stat/rm compatibility.
to_unix_path() {
  cygpath -u "$1" 2>/dev/null || echo "$1"
}

# Helper: dir mtime in seconds since epoch (portable across MSYS variants).
# Always normalize via cygpath since git porcelain emits C:/ paths.
dir_mtime() {
  local p="$(to_unix_path "$1")"
  stat -c %Y "$p" 2>/dev/null || stat -f %m "$p" 2>/dev/null || echo 0
}

NOW_EPOCH="$(date +%s)"
ACTIVITY_GUARD_SEC=1800  # 30 minutes

# 1. Sync local main with origin (no-op if not on main, or if non-FF).
git fetch origin --quiet
git pull --ff-only origin main --quiet

# 2. Sweep merged claude/* worktrees under .claude/worktrees/.
git worktree list --porcelain | awk '
  BEGIN { wt=""; br="" }
  /^worktree / {
    if (wt != "" && br != "") print wt "\t" br
    wt = substr($0, 10); br = ""; next
  }
  /^branch refs\/heads\// { br = substr($0, 19) }
  END { if (wt != "" && br != "") print wt "\t" br }
' | while IFS=$'\t' read -r wt branch; do
  case "$branch" in claude/*) ;; *) continue ;; esac
  case "$wt" in *.claude/worktrees/*) ;; *) continue ;; esac

  # Skip current session's own worktree.
  [ "$wt" = "$CURRENT_WT" ] && continue

  # Skip worktrees with recent activity (likely concurrent session).
  WT_MTIME="$(dir_mtime "$wt")"
  if [ "$WT_MTIME" -gt 0 ] && [ $((NOW_EPOCH - WT_MTIME)) -lt "$ACTIVITY_GUARD_SEC" ]; then
    continue
  fi

  # Only delete if fully merged to origin/main.
  if git merge-base --is-ancestor "$branch" origin/main; then
    git worktree remove --force "$wt" && REMOVED_WTS=$((REMOVED_WTS + 1))
    git branch -D "$branch" >/dev/null && REMOVED_BRANCHES=$((REMOVED_BRANCHES + 1))
  fi
done

# 2b. Sweep orphan disk dirs in .claude/worktrees/ — dirs without valid .git link.
# Safe because: a dir without .git file (or with .git pointing to a missing admin
# record) cannot host an active git/Claude session — it's a phantom from a
# previous session that crashed before cleanup. No activity guard needed.
TRACKED_WTS="$(git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}')"
for d in "$REPO"/.claude/worktrees/*/; do
  [ -d "$d" ] || continue
  d_clean="${d%/}"
  d_norm="$(cygpath -m "$d_clean" 2>/dev/null || echo "$d_clean")"

  # Skip current session's worktree (rm would fail anyway).
  [ "$d_norm" = "$CURRENT_WT" ] && continue
  case "$CWD" in "$d_clean"|"$d_clean"/*) continue ;; esac

  # Skip if git tracks this path — already handled by step 2.
  printf '%s\n' "$TRACKED_WTS" | grep -Fxq "$d_norm" && continue

  # Real worktree dirs have a .git file pointing to .git/worktrees/<name>.
  # If .git file is present AND its admin record exists, leave it alone —
  # something is using it (even if `git worktree list` doesn't show it).
  if [ -f "$d_clean/.git" ]; then
    admin_path="$(sed -n 's/^gitdir: //p' "$d_clean/.git" 2>/dev/null)"
    if [ -n "$admin_path" ] && [ -d "$admin_path" ]; then
      continue
    fi
  fi

  if rm_with_retry "$d_clean"; then
    REMOVED_DIRS=$((REMOVED_DIRS + 1))
  else
    SKIPPED_LOCKED=$((SKIPPED_LOCKED + 1))
  fi
done

# 2c. Sweep merged local feature branches with no worktree attached.
# Common prefixes for branches that ship via PR and become orphans.
for prefix in claude feat fix chore docs ci refactor; do
  git for-each-ref --format='%(refname:short)' "refs/heads/$prefix/" 2>/dev/null | while read -r br; do
    [ -z "$br" ] && continue
    # Skip if any worktree currently uses this branch.
    if git worktree list --porcelain 2>/dev/null | grep -qx "branch refs/heads/$br"; then
      continue
    fi
    # Skip current branch.
    [ "$br" = "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" ] && continue
    # Only delete if fully merged to origin/main.
    if git merge-base --is-ancestor "$br" origin/main 2>/dev/null; then
      git branch -D "$br" >/dev/null && REMOVED_BRANCHES=$((REMOVED_BRANCHES + 1))
    fi
  done
done

# 3. Clean admin records for already-deleted worktree directories.
git worktree prune

# 4. Emit summary as systemMessage so user sees the hook fired.
TOTAL=$((REMOVED_WTS + REMOVED_DIRS + REMOVED_BRANCHES))
if [ "$TOTAL" -gt 0 ] || [ "$SKIPPED_LOCKED" -gt 0 ]; then
  PARTS=""
  [ "$REMOVED_WTS" -gt 0 ] && PARTS="$PARTS$REMOVED_WTS worktree(s), "
  [ "$REMOVED_DIRS" -gt 0 ] && PARTS="$PARTS$REMOVED_DIRS orphan dir(s), "
  [ "$REMOVED_BRANCHES" -gt 0 ] && PARTS="$PARTS$REMOVED_BRANCHES branch(es), "
  PARTS="${PARTS%, }"
  if [ "$TOTAL" -gt 0 ] && [ "$SKIPPED_LOCKED" -gt 0 ]; then
    MSG="Worktree-cleanup: ryddet $PARTS. ${SKIPPED_LOCKED} dir(s) blokeret af OneDrive-lock — selv-rydder næste session."
  elif [ "$TOTAL" -gt 0 ]; then
    MSG="Worktree-cleanup: ryddet $PARTS."
  else
    MSG="Worktree-cleanup: ${SKIPPED_LOCKED} dir(s) blokeret af OneDrive-lock — selv-rydder næste session."
  fi
  printf '{"systemMessage": "%s"}\n' "$MSG"
fi

exit 0
