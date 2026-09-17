#!/usr/bin/env bash
# Branch-guard-markør: bevis for at scripts/guard-commit-branch.sh faktisk kørte
# for DETTE commit, i DETTE træ, på DENNE branch (#5094).
#
# Kaldes fra .githooks/pre-commit (source'es, så exit 1 stopper commit'et) og kan
# køres selvstændigt fra et vilkårligt arbejdstræ:
#   bash .githooks/check-commit-guard-marker.sh
#
# Hvorfor laget findes
# --------------------
# Hard rule 18: commit KUN bag scripts/guard-commit-branch.sh. Indtil nu var
# guarden det eneste lag, og den kanoniske kæde
#   bash scripts/guard-commit-branch.sh <branch> <dir> && git -C <dir> commit ...
# kunne fortsætte forbi guarden når `bash` ikke kunne resolves i den kaldende
# proces: en command-resolution-fejl opdaterer ikke nødvendigvis $LASTEXITCODE
# (målt 9/9, .claude/learnings/2026-09-09-codex-hooks-measured-cause-chain.md
# linje 89-92 og 333). Guarden kan ikke sige fra når den aldrig blev startet.
#
# Git kan. Git for Windows kører sine hooks med sin EGEN medbragte sh, uafhængigt
# af kalderens PATH — så netop denne kontrol kører i præcis den situation hvor
# guarden blev sprunget over.
#
# Markøren er engangsbrug: den læses og slettes her, uanset udfald. Den kan ikke
# dække to commits, og den kan ikke genbruges på tværs af worktrees (den ligger i
# det enkelte træs egen git-dir, og `tree=` verificeres desuden eksplicit).
#
# Hvad laget IKKE er: en beskyttelse mod nogen der bevidst vil udenom.
# `git commit --no-verify` deaktiverer alle pre-commit-hooks, og et repo uden
# origin springes over med vilje (fixture-/temp-repoer). Det er en spærre mod den
# TAVSE omgåelse — kæden der fortsatte uden at guarden kørte — ikke mod en
# bevidst handling.

guard_marker_block() {
  _why="$1"
  _branch="$2"
  _toplevel="$3"
  cat >&2 <<EOF

🔴 PRE-COMMIT BLOCKED: branch-guarden kan ikke bevises koert ($_why).

Hard rule 18: commit kun bag scripts/guard-commit-branch.sh. Guarden skriver en
engangs-markoer naar den har godkendt branchen; dette commit har ingen gyldig.

Den typiske aarsag er #5094: \`bash\` kunne ikke resolves i den kaldende proces,
saa kommandokaeden fortsatte forbi guarden uden at den koerte. Guarden kan ikke
sige fra naar den aldrig blev startet - derfor siger Git fra her.

Koer guarden og commit i SAMME kaede:
  bash scripts/guard-commit-branch.sh ${_branch:-<branch>} "${_toplevel:-<dir>}" \\
    && git -C "${_toplevel:-<dir>}" commit -F <besked-fil>

Fra PowerShell (fejler haardt hvis bash mangler):
  pwsh -File scripts/guard-commit-branch.ps1 ${_branch:-<branch>} "${_toplevel:-<dir>}"
  if (\$LASTEXITCODE -ne 0) { exit 1 }
  git -C "${_toplevel:-<dir>}" commit -F <besked-fil>

Blokerer guarden selv (forkert branch), saa er DET signalet - commit ikke udenom.

Refs: #5094, hard rule 18 i CLAUDE.md/AGENTS.md.
EOF
  exit 1
}

guard_marker_check() {
  git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
  [ -n "$git_dir" ] || return 0

  # Merge/rebase/cherry-pick/revert/am: commit'et skabes af Git selv, ikke af en
  # agent der vælger branch. Samme undtagelse som secret-scanningen bruger.
  if [ -f "$git_dir/MERGE_HEAD" ] || [ -f "$git_dir/REBASE_HEAD" ] \
    || [ -f "$git_dir/CHERRY_PICK_HEAD" ] || [ -f "$git_dir/REVERT_HEAD" ] \
    || [ -d "$git_dir/rebase-merge" ] || [ -d "$git_dir/rebase-apply" ]; then
    return 0
  fi

  # Kun dette repo. Fixture-/temp-repoer (hook-testharness,
  # install-git-hooks.ps1 -SmokeTest) har ingen origin og skal ikke kræve en
  # guard de aldrig har hørt om.
  origin_url="$(git config --get remote.origin.url 2>/dev/null || true)"
  case "$origin_url" in
    *[Cc]ycling[Zz]one*) ;;
    *) return 0 ;;
  esac

  marker="$git_dir/cz-commit-guard-ok"
  branch="$(git branch --show-current 2>/dev/null || true)"
  toplevel="$(git rev-parse --show-toplevel 2>/dev/null || true)"

  if [ ! -f "$marker" ]; then
    guard_marker_block "guarden blev ikke koert for dette commit" "$branch" "$toplevel"
  fi

  m_branch=""
  m_epoch=""
  m_tree=""
  while IFS= read -r line; do
    case "$line" in
      branch=*) m_branch="${line#branch=}" ;;
      epoch=*)  m_epoch="${line#epoch=}" ;;
      tree=*)   m_tree="${line#tree=}" ;;
    esac
  done < "$marker"

  # Engangsbrug — men HVORNÅR markøren forbrugtes betyder noget.
  #
  # Kører vi som pre-commits trin 0, kan senere trin (gitleaks, lint-staged)
  # stadig afvise commit'et. Slettede vi markøren her, ville næste forsøg blive
  # mødt med "guarden blev ikke koert for dette commit" — en årsag der ikke
  # passer: guarden KØRTE og godkendte. Derfor sætter pre-commit
  # CZ_GUARD_DEFER_MARKER=1 og sletter selv markøren når ALLE trin er bestået.
  # 300s-grænsen sikrer stadig at en efterladt markør ikke dækker et senere
  # commit. Køres scriptet direkte (test/manuel brug) er der intet senere trin,
  # og markøren forbruges med det samme.
  CZ_GUARD_MARKER="$marker"
  if [ "${CZ_GUARD_DEFER_MARKER:-}" != "1" ]; then
    rm -f "$marker" 2>/dev/null || true
  fi

  if [ "$m_branch" != "$branch" ]; then
    guard_marker_block "markoeren gjaldt branch \"$m_branch\", commit'et er paa \"$branch\"" "$branch" "$toplevel"
  fi

  # Markøren ligger allerede i dette træs egen git-dir (for et linked worktree
  # .git/worktrees/<navn>/), men stien verificeres eksplicit, så en kopieret
  # markør heller ikke virker. Case-insensitivt: Windows-stier.
  if [ -n "$m_tree" ]; then
    _a="$(printf '%s' "$m_tree" | tr '[:upper:]' '[:lower:]')"
    _b="$(printf '%s' "$toplevel" | tr '[:upper:]' '[:lower:]')"
    if [ "$_a" != "$_b" ]; then
      guard_marker_block "markoeren gjaldt et andet arbejdstrae ($m_tree)" "$branch" "$toplevel"
    fi
  fi

  case "$m_epoch" in
    '' | *[!0-9]*)
      guard_marker_block "markoeren har ingen brugbar tidsstempling" "$branch" "$toplevel"
      ;;
  esac
  now="$(date +%s 2>/dev/null || echo 0)"
  age=$(( now - m_epoch ))
  # 300s: guarden og commit'et står ved siden af hinanden i samme kæde, så en
  # gyldig markør er sekunder gammel. Grænsen findes for at en glemt markør fra
  # en tidligere, afbrudt kæde ikke dækker et senere commit.
  if [ "$age" -lt 0 ] || [ "$age" -gt 300 ]; then
    guard_marker_block "markoeren er ${age}s gammel (graense 300s) - koer guarden umiddelbart foer commit" "$branch" "$toplevel"
  fi

  return 0
}

guard_marker_check
