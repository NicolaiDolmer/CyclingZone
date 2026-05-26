# sanitize-secrets.sh: Chrome MCP screenshot false-positive

**Date:** 2026-05-26 ~16:35 CEST (EmmaPC)
**Trigger:** `#666` prod verify on `cycling-zone.vercel.app`
**Hook:** `.claude/hooks/sanitize-secrets.sh` (built in `#634` AC2)

## Summary

The PostToolUse secret sanitizer flagged **587 high-entropy patterns** on a single Chrome MCP `browser_batch` tool_response that included a `screenshot` action. The hook returned exit 2, which suppressed the entire tool_response. The session lost visual verification mid-flight and had to fall back to text-only `read_page`.

Same pattern appeared earlier in the log:
- `2026-05-25T18:08:13` — count=241, all high-entropy
- `2026-05-26T14:46:06` — count=587, all high-entropy

Preview samples from both incidents (verbatim from `.claude/secret-leak-incidents.log`):

```
4gHYSUND...xADb   ← base64 of JPEG color profile bytes
2wBDAAgG...zNDL   ← base64 of JPEG DQT (Define Quantization Table) marker
8QAWBAAA...RZSj   ← base64 of JPEG SOFn / SOS marker
APkKIvF7...6bYF   ← base64 of compressed image scan data
```

These are JPEG/JFIF bytes, not secrets.

## Root cause

`sanitize-secrets.sh` has two scanning layers:

1. **Named patterns** (sb_secret_, eyJ JWT, ghp_, AKIA, sk-ant-, Sentry DSN, …). All have distinct prefixes — false-positive rate ~0.
2. **High-entropy fallback** — any 40+ char `[A-Za-z0-9_+=-]` chunk with ≥2 upper, ≥2 lower, ≥2 digit. Designed to catch novel-prefix tokens.

JPEG bytes encoded as base64 trivially satisfy the entropy criteria. A single screenshot returns thousands of bytes of image data; even after segmenting on `/` (which the regex excludes), each contiguous URL-safe-base64-ish chunk between slashes is typically 50–200 chars and hits the entropy threshold. One screenshot → hundreds of "findings" → output suppressed.

The named-pattern layer is fine. The high-entropy layer is the problem **specifically for screenshot / image-bytes tool output**.

## Fix

Image-mode detection in both `sanitize-secrets.sh` and `sanitize-secrets.ps1`. If either signal fires, the **high-entropy fallback is skipped**; named patterns still run for defense-in-depth.

Signals (either is enough):

1. **`tool_name` regex** — `mcp__Claude_in_Chrome__(browser_batch|computer|gif_creator|upload_image|read_page)`, `mcp__Claude_Preview__preview_screenshot`, or any name containing `screenshot`.
2. **Payload markers** — `data:image/`, `"type":"image"`, `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `/9j/4AA` (base64 JPEG SOI+JFIF), `iVBORw0KG` (base64 PNG signature), `R0lGODlh` (base64 GIF header), `UklGR` (base64 WebP), `Successfully captured screenshot`.

Tests: `scripts/test-sanitize-secrets.ps1` extended with:
- `screenshot-chrome-mcp-safe.json` — tool_name path, exit 0.
- `screenshot-data-uri-safe.json` — marker path on a Bash output, exit 0.
- `image-mode-jwt-still-blocks` — runtime-constructed JPEG bytes + JWT, exit 2 (named pattern still fires inside image-mode).

All 30 test cases pass.

## Backwards-check

Scanned `.claude/secret-leak-incidents.log` for the two screenshot-window timestamps. The 241 + 587 findings were **exclusively** of type `high-entropy` with previews like `4gHYSUND...xADb`, `2wBDAAgG...zNDL`, `8QAWBAAA...RZSj` — all JPEG-byte signatures (`2wBD` decodes to `\xdb\x00\x43`, the JPEG DQT marker, etc.). No `sb_secret_`, `eyJ`, `ghp_`, `AKIA`, `sk-ant-`, Sentry DSN, or Discord token previews appeared in either incident.

**Conclusion:** no real leaks happened during these incidents. The log entries are evidence of the false-positive pattern and can stay in place as historical record. Not rotating the file.

## Forward-guard

Added `.claude/secret-leak-stats.log`. Both hooks now append a stats line whenever **image-mode triggers** *or* **a leak is detected**:

```
2026-05-26T15:04:40+0000 image_mode=True reason=tool_name skipped_he=1 leak=False count=0 tool=mcp__Claude_in_Chrome__browser_batch
```

Fields: `image_mode`, `reason` (tool_name / marker), `skipped_he` (count of high-entropy candidates skipped), `leak` (whether a named pattern fired), `count` (number of findings), `tool` (tool_name).

If image-mode still misses cases (genuine high-entropy false-positives leak through), the stats log shows which tool_name we missed and how many candidates would have flagged. Allowlist or pattern tweak from there.

If image-mode over-skips (a real secret slips through inside image-mode), the named-pattern layer should catch it — `image-mode-jwt-still-blocks` test verifies that.

## Refs

- Hook: `.claude/hooks/sanitize-secrets.sh`, `.claude/hooks/sanitize-secrets.ps1`
- Tests: `scripts/test-sanitize-secrets.ps1`, `.claude/hooks/sanitize-secrets-tests/`
- Stats: `.claude/secret-leak-stats.log` (also added to `.gitleaks.toml` allowlist)
- Built originally in `#634` (post-`#296` + `#620` secret rotation work)
- Suppressed tool_response during `#666` prod verify on EmmaPC
