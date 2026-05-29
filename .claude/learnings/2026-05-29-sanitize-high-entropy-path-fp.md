# sanitize-secrets: high-entropy false-positives på flade paths/identifiers (#752)

**Dato:** 2026-05-29
**Issue:** #752 (Refs #634, #743)

## Symptom

`sanitize-secrets.sh` (PostToolUse) fyrede gentagne gange i live-sessioner på
**ikke-secrets** der trippede high-entropy-fallback'en:
- Flade worktree-/session-stier: `C--Dev-CyclingZone-worktrees-agent-<16hex>`
  (Claude Code flader `C:\Dev\...` til `C--Dev-...`).
- Arkiv-filnavne: `NOW_HIST...`.
- Test-fixture-signaturer i source (fx JWT-sig `SflKxFIX...` uden underscores,
  så ikke fanget af `FIXTURE_DO_NOT_USE`-allow).

Hver firing erstatter HELE tool_output med en block-besked (exit 2), så agenten
taber resultatet → loop / spildt session-tid.

## Vigtigste afklaring: redact-inline er teknisk UMULIGT i PostToolUse

Issuens oprindelige idé var "redact-inline-og-pass" for high-entropy. Bekræftet
mod officielle docs (code.claude.com/docs/en/hooks.md): en **PostToolUse**-hook
kan IKKE erstatte/overskrive tool_response. `exit 0` lader det *originale*
output passere uændret; `exit 2` blokerer med stderr som feedback;
`additionalContext` kan kun *tilføje*, ikke erstatte. Den `redacted`-streng
Python beregnede var derfor død kode — og at skifte high-entropy til `exit 0`
ville **lække** secretet (originalen passerer, ikke det redacted).

## Fix (det realistiske scope)

Robust **path/identifier-skip** i high-entropy-fallback'en (analogt med den
eksisterende image-mode-skip), IKKE whack-a-mole-allowlist:
- `looks_like_path_or_identifier(value)` skipper en high-entropy-kandidat hvis
  (1) den starter med drev-flad-form `[A-Za-z]--`, ELLER (2) den har ≥3 rene
  alfabetiske ord-segmenter (≥3 tegn) splittet på `[-_+=]`.
- Rationale: paths/identifiers er sammensat af rigtige ord (Dev, CyclingZone,
  worktrees, agent…); tilfældige base64-secrets har ikke ord-grænser.
- **Sikkerhed bevaret:** skip'en kaldes KUN i high-entropy-fallback'en, EFTER
  named patterns (sb_secret_/eyJ/ghp_/AKIA/Sentry/Discord/Stripe/...) allerede
  har kørt og fuld-blokeret. En kendt secret kan ikke slippe igennem.
- Test: `high-entropy-raw` (random uden ord-segmenter) blokerer stadig (exit 2);
  `worktree-flat` + `archive-fname` passerer. 47/47 (.ps1) + 17/17 (.sh) grønne.

## Loop-guard (generaliseret)

Tilføjet til `memory/feedback_reproduce_locally_before_push.md`: hvis en hook
fyrer 2+ gange i samme session på samme mønster-type → STOP, retry IKKE samme
tool-call, diagnosticér allowlist/skip-gap'et frem for at gætte nye edits.

## Kendt restgap (out of scope her)

Test-fixture-signaturer i source-filer (`scripts/test-sanitize-secrets.*`)
tripper stadig high-entropy ved Read/Edit af selve test-filen. Filen er
gitleaks-allowlistet men ikke sanitize-allowlistet. Lav-impact (kun ved
redigering af test-filen selv); kan adresseres separat hvis det generer.
