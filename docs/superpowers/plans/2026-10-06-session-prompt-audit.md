# Prompt: session "prompt-audit" (6/10 aften)

Model: **Claude Opus 5.5** i Claude Code, indsats høj. Kopiér alt under stregen.

Note: `/doctor` i Claude Code tjekker installationen, ikke vores prompter, og har ingen `prompt-audit`. Denne session er den audit, ejeren mener: alt der bliver læst eller kørt automatisk, når en Claude- eller Codex-session starter.

---

Ny session: **prompt-audit**. Mål: hver session starter hurtigere, billigere og mere præcist, og ingen regel modsiger en anden. Udfordr status quo. Arbejdsform (ejer 6/10): langsigtet værdi, best practice, god fart, beslutninger som popup én ad gangen med anbefaling.

**Læs først:** `CLAUDE.md`, `AGENTS.md`, `~/.claude/projects/C--Dev-CyclingZone/memory/MEMORY.md` + `MEMORY_REFERENCE.md`, `docs/NOW.md`, `docs/AI_OPS_TOKEN_BUDGET.md`, `docs/AI_CHANNEL_ROUTING.md`.

**Målt 6/10 (udgangspunkt):** `check-agent-token-hygiene.ps1` = 0 fail, 8 warn. MEMORY.md 3.159 tok (mål ≤ 2.800). 332 memory-filer, ~188k tok, +286 % siden 16/5. Codex auto-load ~11k tok. AGENTS.md 6.500 tok. 29 hooks. Claude cold start ~22k tok.

## Opgaver
1. **Inventar:** list alt der auto-loades eller kører pr. session/tool-kald (CLAUDE.md-kæden, MEMORY.md, SessionStart-hooks, PreToolUse-guards, skills, `wave.js`-brief, `codex-wave.mjs`-brief, Codex' AGENTS.md). Mål tokens pr. post.
2. **Modsigelser og forældede regler:** find regler der modsiger hinanden eller peger på ting der ikke findes længere (fx filer, flag, issues). Verificér hver mod koden. Eksempel fra 6/10: sessionsprompten påstod `posthog-js` ikke var installeret, men `posthog-js-lite` var wiret siden #5052.
3. **Memory-oprydning:** 332 filer. Flet dubletter, slet forældede, demotér lavfrekvente HOT-entries. Brug skill `anthropic-skills:consolidate-memory`. Mål: MEMORY.md ≤ 2.800 tok, memory-dir markant ned.
4. **Guards der koster mere end de redder:** gennemgå hooks. Hvilke afviste legitime kald i dag (fx `process.env` i et scratch-script blev blokeret som secret-læk, `git log` uden `--no-pager`)? Foreslå præcisering, ikke fjernelse, hvor en guard har bidt før.
5. **Worker-briefs:** er bølge-briefen og Codex-briefen korte nok til, at en worker følger dem? Mål på dagens bølge (#6279 #6280).
6. **Leverance:** én PR med prompt/doc-ændringer + memory-oprydning (lokalt) + en kort før/efter-tabel (tokens, antal filer, warns) på #605. Spillertekst røres ikke.

Beslutninger der ændrer en ejer-regel = popup til ejeren. Tekniske valg træffer du selv.
