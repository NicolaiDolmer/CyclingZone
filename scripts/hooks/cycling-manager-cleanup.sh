#!/usr/bin/env bash
# cycling-manager: SessionStart self-heal
# - Pulls main if behind origin (FF-only, never destructive)
# - Removes stale claude/* worktrees that are fully merged to origin/main
# - Removes orphan disk dirs in .claude/worktrees/ (with OneDrive-lock retry)
# - Removes merged local feature branches without worktrees (claude/* feat/* fix/* chore/* docs/* ci/* refactor/*)
# - Skips the current session's own worktree (impossible to remove from inside)
# - Skips dirs with activity in last 30 min (likely concurrent session)
# - Emits a one-line systemMessage summarizing what was cleaned (visible to user)
# Always exits 0; never blocks Claude session start.
#
# Cross-PC: REPO root is detected via `git rev-parse --show-toplevel` from CWD,
# so the same script works on any PC regardless of where the repo lives.
# Only runs when CWD is inside a CyclingZone/cycling-manager repo (verified via
# origin remote URL).
#
# Ydelse (#8240): hooken har 10 s timeout og ramte den i 52 af 55 sessioner, saa
# oprydningen blev afbrudt midtvejs. Derfor koeres hvert git-opslag EEN gang for
# hele repoet (worktree-liste, flettede grene, aktuel gren) i stedet for 3-4
# git-processer pr. gren, der hentes kun een gang fra origin, og fjernelse af
# flettede worktrees sker i EEN samlet pwsh-koersel (aldrig pwsh pr. worktree).
# Sikkerheden er uaendret: samme filtre, samme aktivitets-vagt, og worktrees
# fjernes stadig kun via Remove-WorktreeSafely (#6687/#7446/#7837).

set +e

CWD="$PWD"
LOG="${TMPDIR:-/tmp}/cm-cleanup.log"
exec 2>"$LOG"

# Detect repo root portably. Skip silently if not in a git repo.
REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO" ] && exit 0

# Only run for CyclingZone/cycling-manager. Other repos must not be touched.
REMOTE_URL="$(git -C "$REPO" config --get remote.origin.url 2>/dev/null)"
case "$REMOTE_URL" in
  *CyclingZone*|*cycling-manager*) ;;
  *) exit 0 ;;
esac

# Counters for end-of-run summary.
REMOVED_WTS=0
REMOVED_DIRS=0
REMOVED_BRANCHES=0
SKIPPED_LOCKED=0

# Current worktree top = REPO (rev-parse ovenfor koerte fra CWD).
CURRENT_WT="$REPO"

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

printf -v NOW_EPOCH '%(%s)T' -1
ACTIVITY_GUARD_SEC=1800  # 30 minutes

# 1. Sync with origin: ONE fetch, then the same FF-only merge `git pull --ff-only
#    origin main` did (no-op if non-FF). Tidligere hentede pull'en en gang til.
git fetch origin --quiet
git merge --ff-only --quiet origin/main >/dev/null

# Alle opslag koeres een gang for hele repoet (#8240).
WT_PORCELAIN="$(git worktree list --porcelain)"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
declare -A MERGED=()      # lokale grene der er fuldt flettet til origin/main
declare -A CHECKED_OUT=() # grene der er tjekket ud i et worktree
declare -A TRACKED=()     # worktree-stier git kender
while IFS= read -r br; do
  [ -n "$br" ] && MERGED["$br"]=1
done < <(git for-each-ref --merged origin/main --format='%(refname:short)' refs/heads/ 2>/dev/null)

WT_LIST=()   # "sti<TAB>gren" for claude/*-worktrees
wt=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) wt="${line#worktree }"; TRACKED["$wt"]=1 ;;
    "branch refs/heads/"*)
      br="${line#branch refs/heads/}"
      CHECKED_OUT["$br"]=1
      [ -n "$wt" ] && WT_LIST+=("$wt"$'\t'"$br")
      ;;
  esac
done <<<"$WT_PORCELAIN"

# 2. Sweep merged claude/* worktrees under .claude/worktrees/.
REMOVE_PATHS=()
declare -A REMOVE_BRANCH=()
for entry in "${WT_LIST[@]}"; do
  wt="${entry%%$'\t'*}"
  branch="${entry#*$'\t'}"
  case "$branch" in claude/*) ;; *) continue ;; esac
  case "$wt" in *.claude/worktrees/*) ;; *) continue ;; esac

  # Skip current session's own worktree.
  [ "$wt" = "$CURRENT_WT" ] && continue

  # Only delete if fully merged to origin/main.
  [ -n "${MERGED[$branch]:-}" ] || continue

  # Skip worktrees with recent activity (likely concurrent session).
  WT_MTIME="$(dir_mtime "$wt")"
  if [ "$WT_MTIME" -gt 0 ] && [ $((NOW_EPOCH - WT_MTIME)) -lt "$ACTIVITY_GUARD_SEC" ]; then
    continue
  fi

  REMOVE_PATHS+=("$wt")
  REMOVE_BRANCH["$wt"]="$branch"
done

if [ "${#REMOVE_PATHS[@]}" -gt 0 ]; then
  # #6687/#7446: links ud foerst, ellers foelger '--force' en junction og toemmer maalet.
  # #7837: links ud + arkiv af alt ikke-versioneret (ogsaa ignorerede filer) foer fjernelse.
  # EEN pwsh for alle kandidater (#8240); stierne gives som PowerShell-strenge
  # med fordoblede apostroffer, og svaret er kandidatens indeks (ikke stien),
  # saa konsol-kodning aldrig kan forvanske svaret. stdin lukkes, saa pwsh
  # aldrig laeser af hookens input.
  ps_q() { local s="${1//\'/\'\'}"; printf "'%s'" "$s"; }
  PS_LIST=""
  for wt in "${REMOVE_PATHS[@]}"; do
    PS_LIST="${PS_LIST:+$PS_LIST,}$(ps_q "$wt")"
  done
  PS_CMD=". $(ps_q "$REPO/scripts/lib/archive-worktree-unversioned.ps1"); \$l = @($PS_LIST); for (\$i = 0; \$i -lt \$l.Count; \$i++) { if ((Remove-WorktreeSafely -WorktreePath \$l[\$i] -RepoRoot $(ps_q "$REPO")).Ok) { [Console]::Out.WriteLine('REMOVED ' + \$i) } }"
  while IFS= read -r line; do
    line="${line%$'\r'}"
    case "$line" in
      "REMOVED "*)
        idx="${line#REMOVED }"
        case "$idx" in ''|*[!0-9]*) continue ;; esac
        wt="${REMOVE_PATHS[$idx]:-}"
        branch="${REMOVE_BRANCH[$wt]:-}"
        [ -n "$branch" ] || continue
        REMOVED_WTS=$((REMOVED_WTS + 1))
        unset -v 'CHECKED_OUT[$branch]'
        if git branch -D "$branch" >/dev/null; then
          REMOVED_BRANCHES=$((REMOVED_BRANCHES + 1))
          unset -v 'MERGED[$branch]'
        fi
        ;;
    esac
  done < <(pwsh -NoProfile -NonInteractive -Command "$PS_CMD" </dev/null 2>>"$LOG")

  # 2b skal se worktree-listen EFTER fjernelserne (som foer).
  TRACKED=()
  while IFS= read -r line; do
    case "$line" in "worktree "*) TRACKED["${line#worktree }"]=1 ;; esac
  done < <(git worktree list --porcelain)
fi

# 2b. Sweep orphan disk dirs in .claude/worktrees/ — dirs without valid .git link.
# Safe because: a dir without .git file (or with .git pointing to a missing admin
# record) cannot host an active git/Claude session — it's a phantom from a
# previous session that crashed before cleanup. No activity guard needed.
for d in "$REPO"/.claude/worktrees/*/; do
  [ -d "$d" ] || continue
  d_clean="${d%/}"
  d_norm="$(cygpath -m "$d_clean" 2>/dev/null || echo "$d_clean")"

  # Skip current session's worktree (rm would fail anyway).
  [ "$d_norm" = "$CURRENT_WT" ] && continue
  case "$CWD" in "$d_clean"|"$d_clean"/*) continue ;; esac

  # Skip if git tracks this path — already handled by step 2.
  [ -n "${TRACKED[$d_norm]:-}" ] && continue

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
# Samme filtre som foer, men fra de allerede hentede maengder i stedet for 3-4
# git-processer pr. gren, og EEN `git branch -D` for dem alle (#8240).
DELETE_BRANCHES=()
for br in "${!MERGED[@]}"; do
  case "$br" in claude/*|feat/*|fix/*|chore/*|docs/*|ci/*|refactor/*) ;; *) continue ;; esac
  # Skip if any worktree currently uses this branch.
  [ -n "${CHECKED_OUT[$br]:-}" ] && continue
  # Skip current branch.
  [ "$br" = "$CURRENT_BRANCH" ] && continue
  DELETE_BRANCHES+=("$br")
done
if [ "${#DELETE_BRANCHES[@]}" -gt 0 ]; then
  while IFS= read -r line; do
    case "$line" in "Deleted branch "*) REMOVED_BRANCHES=$((REMOVED_BRANCHES + 1)) ;; esac
  done < <(LC_ALL=C LANGUAGE=C git branch -D -- "${DELETE_BRANCHES[@]}" 2>>"$LOG")
fi

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
