#!/usr/bin/env bash
# Blokerende branch-guard for commits i det delte hoved-checkout.
#
# Baggrund: 5 bid af samme fejlklasse (11/6, 12/6, 13/6, 6/8, 18/8). En parallel
# session kan skifte branch i C:\Dev\CyclingZone mellem to af dine egne tool-kald,
# så en commit lander på en fremmed branch.
#
# Fejlen 18/8 var at bruge `git branch --show-current && git commit ...` som guard.
# Den kommando printer branchen og exiter ALTID 0, så kæden fortsatte uanset hvad.
# Dette script exiter 1 ved mismatch, hvilket er hele pointen.
#
# Brug:
#   bash scripts/guard-commit-branch.sh main && git commit -F msg.txt
#
# Læring: .claude/learnings/2026-08-06-shared-checkout-cross-session-commit.md

set -euo pipefail

expected="${1:-}"

if [ -z "$expected" ]; then
  echo "guard-commit-branch: mangler forventet branch som argument" >&2
  echo "  brug: bash scripts/guard-commit-branch.sh <branch>" >&2
  exit 2
fi

actual="$(git branch --show-current 2>/dev/null || true)"

# Detached HEAD giver tom streng. Det er lige så farligt som forkert branch.
if [ -z "$actual" ]; then
  cat >&2 <<'EOF'
BLOKERET: detached HEAD i dette checkout.

En commit her havner uden for enhver branch og bliver usynlig efter næste checkout.

Ret det med et midlertidigt worktree i stedet:
  git worktree add /tmp/cz-main main
  cd /tmp/cz-main && git commit ... && git push origin main
  cd - && git worktree remove /tmp/cz-main
EOF
  exit 1
fi

if [ "$actual" != "$expected" ]; then
  cat >&2 <<EOF
BLOKERET: checkoutet staar paa "$actual", ikke "$expected".

En parallel session har sandsynligvis skiftet branch. Commit IKKE her, og gentag
ikke kommandoen uden denne guard. En blokeret guard ER signalet, ikke stoej.

Tjek hvem der arbejder:
  git status --porcelain | grep -v '^??'
  grep -A2 'Aktive sessioner' docs/NOW.md

Er der fremmed ucommitteret arbejde, saa skift ALDRIG branch. Brug et worktree:
  git worktree add /tmp/cz-$expected $expected
  cd /tmp/cz-$expected && git commit ... && git push origin $expected
  cd - && git worktree remove /tmp/cz-$expected
EOF
  exit 1
fi

exit 0
