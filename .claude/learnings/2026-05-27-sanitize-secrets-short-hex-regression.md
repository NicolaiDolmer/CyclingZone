# Postmortem: sanitize-secrets short-hex regression guard

**Bug class:** Secret-sanitizer false positives on harmless command output.

**Issue:** #638 follow-up noted a CMA run where `openssl rand -hex 2` output (`cd4d`) was treated as a high-entropy secret candidate. Current runtime already required high-entropy candidates to be at least 40 chars, but the safe short-hex case was not covered by tests, so the regression could return unnoticed.

**Fix:** `scripts/test-sanitize-secrets.ps1` now resolves Git Bash explicitly on Windows and includes `control-short-hex` + `control-short-hex-json` safe cases for `openssl rand -hex 2` style output.

**Verification:** `pwsh -File scripts/test-sanitize-secrets.ps1` passed 32/32; `C:\Program Files\Git\bin\bash.exe scripts/hooks/__tests__/test-hooks.sh` passed 16/16.

**Lesson:** Agent hook tests should cover both the secret-positive path and mundane tool outputs that appear in automation harnesses. If a hook is Bash-based, PowerShell test runners should resolve Git Bash explicitly instead of assuming `bash` is on PATH.
