# claude-project-paths.ps1 — delt encoding af en arbejdsmappe-sti til Claude
# Codes ~/.claude/projects/<encoded>/ session-dir-navn.
#
# Hvorfor delt: tre scripts skal finde/rydde memory-junction'en for et worktree
# (prune-merged-worktrees.ps1, prune-stale-project-dirs.ps1, remove-worktree.ps1).
# Da encoding-reglen tidligere var kopieret ind i hvert script, drev de fra
# hinanden: prune-merged kodede kun ':' og '\' og ramte derfor aldrig den
# faktiske '--claude'-form on-disk (issue #1271, fundet 2026-06-21). Én kilde
# her eliminerer den drift.
#
# Encoding-regel (Claude Codes faktiske on-disk-form): erstat ':', '\', '/' OG
# '.' med '-'. Derfor bliver '...\.claude\worktrees\...' til
# '...--claude-worktrees-...' (dobbelt-bindestreg, fordi både '\' og '.' i
# '\.claude' kodes). Case bevares (hoved-checkoutet kan være 'C--dev-...' mens
# worktrees er 'C--Dev-...' afhængig af hvilken sti der blev åbnet).

function Get-ClaudeProjectDirName {
  # Returnerer det ~/.claude/projects/-dir-navn Claude Code bruger for $Path.
  # Normaliserer '/' → '\' og trimmer trailing separator først, så et trailing
  # slash ikke giver et efterhængende '-'.
  [CmdletBinding()]
  param(
    [Parameter(Mandatory, Position = 0)][string]$Path
  )
  $p = ($Path -replace '/', '\').TrimEnd('\')
  return ($p -replace '[:\\./]', '-')
}
