#!/usr/bin/env bash
# Blokerende branch-guard for commits i det delte hoved-checkout og i worktrees.
#
# Baggrund: 5 bid af samme fejlklasse (11/6, 12/6, 13/6, 6/8, 18/8). En parallel
# session kan skifte branch i C:\Dev\CyclingZone mellem to af dine egne tool-kald,
# så en commit lander på en fremmed branch.
#
# Fejlen 18/8 var at bruge `git branch --show-current && git commit ...` som guard.
# Den kommando printer branchen og exiter ALTID 0, så kæden fortsatte uanset hvad.
# Dette script exiter 1 ved mismatch, hvilket er hele pointen.
#
# Bid 6 (2/9, #4658) var den omvendte fejl: en worker i et worktree kaldte guarden
# uden mappe-argument, og guarden læste `git branch --show-current` i shell-cwd, som
# var hoved-checkoutet på main. Falsk "BLOKERET: main", selvom worktree'et stod
# korrekt. Agent-shells nulstiller cwd mellem kald, så cwd er IKKE et pålideligt
# udtryk for "det træ jeg committer i". Deraf det valgfrie <dir>-argument: giv
# guarden PRÆCIS den mappe din `git -C <dir> commit` bruger.
#
# Brug:
#   bash scripts/guard-commit-branch.sh main && git commit -F msg.txt
#   bash scripts/guard-commit-branch.sh <branch> <dir> && git -C <dir> commit -F msg.txt
#
# Exit-koder:
#   0  match (tavs)
#   1  BLOKERET: forkert branch eller detached HEAD i det tjekkede træ
#   2  kald-fejl: manglende argument, <dir> er ikke et git-arbejdstræ, eller to træer
#      i spil uden <dir> (scriptet ligger i ét repo-træ, shell-cwd i et andet)
#
# Læring: .claude/learnings/2026-08-06-shared-checkout-cross-session-commit.md
#         .claude/learnings/2026-09-02-guard-commit-branch-tjekker-cwd-ikke-worktree.md
# Test:   bash scripts/test-guard-commit-branch.sh

set -euo pipefail

expected="${1:-}"
dir="${2:-}"

if [ -z "$expected" ]; then
  echo "guard-commit-branch: mangler forventet branch som argument" >&2
  echo "  brug: bash scripts/guard-commit-branch.sh <branch> [<dir>]" >&2
  exit 2
fi

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

if [ -n "$dir" ]; then
  # Eksplicit mappe: tjek den og kun den. Det er samme mappe som `git -C "$dir" commit`.
  if ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "guard-commit-branch: \"$dir\" er ikke et git-arbejdstrae (findes stien?)" >&2
    echo "  brug: bash scripts/guard-commit-branch.sh <branch> [<dir>]" >&2
    exit 2
  fi
  target="$dir"
else
  target="."
  cwd_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -z "$cwd_root" ]; then
    cat >&2 <<EOF
guard-commit-branch: shell-cwd ($PWD) er ikke et git-arbejdstrae, og intet <dir> er givet.

Agent-shells nulstiller cwd mellem kald. Giv guarden den mappe din commit bruger:
  bash scripts/guard-commit-branch.sh $expected <dir> && git -C <dir> commit ...
EOF
    exit 2
  fi

  # Ligger scriptet i et andet repo-trae end cwd, er der to traeer i spil, og kun
  # kalderen ved hvilket af dem der committes i. Gaet ikke; bed om <dir>.
  script_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$script_root" ] && [ "$(lower "$script_root")" != "$(lower "$cwd_root")" ]; then
    cat >&2 <<EOF
guard-commit-branch: to traeer i spil, og intet <dir> er givet.

  scriptet ligger i:  $script_root
  shell-cwd er:       $cwd_root

Uden <dir> tjekker guarden cwd, mens en git -C-commit gaar til et andet trae. Det gav
2/9 en falsk blokering fra et worktree der stod korrekt (#4658). Sig hvilket trae du
committer i:
  bash scripts/guard-commit-branch.sh $expected <dir> && git -C <dir> commit ...
EOF
    exit 2
  fi
fi

actual="$(git -C "$target" branch --show-current 2>/dev/null || true)"
where="$(git -C "$target" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$target")"
slug="${expected//\//-}"

# Detached HEAD giver tom streng. Det er lige så farligt som forkert branch.
if [ -z "$actual" ]; then
  cat >&2 <<EOF
BLOKERET: detached HEAD i $where.

En commit her havner uden for enhver branch og bliver usynlig efter næste checkout.

Ret det med et midlertidigt worktree i stedet:
  git worktree add /tmp/cz-$slug $expected
  cd /tmp/cz-$slug && git commit ... && git push origin $expected
  cd - && git worktree remove /tmp/cz-$slug
EOF
  exit 1
fi

if [ "$actual" != "$expected" ]; then
  cat >&2 <<EOF
BLOKERET: $where staar paa "$actual", ikke "$expected".

En parallel session har sandsynligvis skiftet branch. Commit IKKE her, og gentag
ikke kommandoen uden denne guard. En blokeret guard ER signalet, ikke stoej.

Tjek hvem der arbejder:
  git -C "$where" status --porcelain | grep -v '^??'
  grep -A2 'Aktive sessioner' docs/NOW.md

Er der fremmed ucommitteret arbejde, saa skift ALDRIG branch. Brug et worktree:
  git worktree add /tmp/cz-$slug $expected
  cd /tmp/cz-$slug && git commit ... && git push origin $expected
  cd - && git worktree remove /tmp/cz-$slug
EOF
  exit 1
fi

exit 0
