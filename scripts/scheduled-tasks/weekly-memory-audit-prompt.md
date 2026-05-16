Du er en automatiseret ugentlig memory-review for CyclingZone-projektet (issue #380).

Trin:

1. `cd C:\dev\CyclingZone` og kør:
   ```
   node scripts/audit-memory-dir.mjs --baseline-out docs/metrics/memory-baseline.json
   ```
   Scriptet scanner `~/.claude/projects/C--dev-CyclingZone/memory/*.md` for:
   - Stale entries (>=30 dage uændret)
   - Suspected duplicates (Levenshtein på frontmatter `description` >=0.82)
   - Frontmatter-rot (manglende felter eller ukendt type)

   Markdown-rapporten kommer på stdout. Baseline-filen opdateres med week-over-week growth-diff.

2. Tag rapportens output, prepend en "Auto-generated weekly review (YYYY-MM-DD)"-header, og poster den som kommentar på GitHub issue #380:
   ```
   gh issue comment 380 --body-file <tmpfile>
   ```

3. Hvis growth siden sidste baseline er >10 % (kan ses i `docs/metrics/memory-baseline.json` ved at sammenligne `approxTokens` vs `previous.approxTokens`), tilføj en advarsel i kommentaren: "⚠️ Memory-dir vækst >10 % siden sidste review — overvej oprydning."

4. Hvis der findes konkrete oprydnings-kandidater (stale + dups + rot tilsammen >5), foreslå konkrete handlinger nederst i kommentaren — f.eks. "Slet/refresh: foo.md (45 dage gammel)" eller "Merge: bar.md + baz.md (similarity 0.91)".

5. Bekræft kun med en kort linje til chat-output: "Posted weekly memory audit til #380 (N stale, M dups, K rot)."

VIGTIGT:
- Skriv ikke andet til GitHub end den ene kommentar på #380.
- Du må IKKE editere selve memory-filerne i denne automatiserede kørsel; kun rapportér.
- Hvis `gh` ikke er autentificeret eller scriptet fejler, abort gracefully og log fejlen til chat-output uden at lave nogen GitHub-ændringer.
- Hold dig i C:\dev\CyclingZone — andre repos er ikke target for denne task.
