#!/bin/bash
# SessionStart-hook: advarer om lokale branches der har "gone" upstream
# (origin-branchen er slettet, fx efter PR-merge eller fast-forward push).
# Auto-sletter ALDRIG - rapporterer kun foreslaaet cleanup-kommando.
#
# Output: en linje per stale branch (plain text). Tom output hvis intet at advare om.
# Exit altid 0 (non-blocking).

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

# Advar hvis HOVEDMAPPEN (primær worktree) ikke står på main. Rod-årsagen til
# branch/worktree-ophobning er at man bliver "boende" på en feature-branch efter
# merge i stedet for at vende hjem til main. Vi inspicerer altid den primære
# worktree (første blok i 'git worktree list --porcelain'), uanset om hook'en
# kører i hovedmappen eller i et linked worktree. Detached primær HEAD har ingen
# 'branch '-linje → ingen falsk advarsel.
primary_branch=$(git worktree list --porcelain 2>/dev/null | awk '
  /^worktree /{ wt++ }
  wt==1 && /^branch /{ sub("refs/heads/","",$2); print $2; exit }
')
if [ -n "$primary_branch" ] && [ "$primary_branch" != "main" ]; then
  echo "⚠ Hovedmappen står på '$primary_branch', ikke main — kør efter-merge-rutinen: git checkout main && git pull"
fi

# git branch -vv listet en linje per lokal branch:
#   * main 9e03105 [origin/main] ...
#   + feat/x 1234abc [origin/feat/x: gone] ...   (+ = checked out i anden worktree)
#     feat/y 5678def [origin/feat/y: gone] ...
# Vi filtrerer paa ": gone]" og stripper det forreste prefix-tegn (* + space).
stale=$(git branch -vv 2>/dev/null | grep ': gone\]' | sed -E 's/^[*+ ]+//' | awk '{print $1}')

if [ -z "$stale" ]; then
  exit 0
fi

while IFS= read -r branch; do
  [ -z "$branch" ] && continue
  echo "Stale: $branch (merged & deleted from origin) - cleanup: git branch -D $branch"
done <<< "$stale"

exit 0
