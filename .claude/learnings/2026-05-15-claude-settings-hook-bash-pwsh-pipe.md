# 2026-05-15: SessionStart-hook brugte pwsh-syntax i bash-eksekveret pipe

## Symptom
SessionStart-hook nr. 3 i `~/.claude/settings.json` producerede `/usr/bin/bash: line 1: Where-Object: command not found` ved hver Claude Code session-start. Hookets command var:

```
pwsh -File scripts/link-onedrive-context.ps1 2>&1 | Where-Object { $_ -match 'STOP|err|Exception' }
```

## Root cause
Claude Code eksekverer hook-commands gennem bash (`/usr/bin/bash`), ikke pwsh — uanset om kommandoen selv kalder pwsh. Bash ser pipen `|` foer pwsh starter, og `Where-Object` er ikke i bash's scope. Scriptet selv koerte fint; kun filteret efter pipen fejlede.

## Fix
Erstattede `Where-Object { $_ -match 'STOP|err|Exception' }` med `grep -E 'STOP|err|Exception'` — virker native i bash, matcher samme patterns.

## Cross-PC self-heal
`~/.claude/settings.json` er PC-lokal og ikke i git, saa fix'et skulle ramme begge PCs manuelt. I stedet: tilfoejede idempotent self-heal i `scripts/link-onedrive-context.ps1` (som allerede koerer ved SessionStart paa begge PCs). Self-heal finder den buggy hook-streng, laver timestamped backup, og erstatter med grep-versionen. No-op hvis allerede helet.

Ironisk: hookets pipe fejler paa anden PC, men scriptet selv koerer stadig, saa self-heal gor sig selv overfloedig ved foerste eksekvering.

## Forward-guard
- **Hooks eksekverer i bash, ikke pwsh.** Brug bash-native pipe-tools (`grep`, `awk`, `sed`, `head`, `tail`) — ikke `Where-Object`, `Select-Object`, `ForEach-Object`.
- Hvis du ABSOLUT skal bruge pwsh-pipes i en hook: wrap hele kommandoen i `pwsh -Command "& {...}"` saa pipen evalueres af pwsh, ikke bash.
- **Cross-PC drift af PC-lokal config:** lav self-heal i et script der allerede koerer paa alle PCs, frem for at stole paa manuel synkronisering.
- Backwards-check: ingen andre hooks i `settings.json` brugte pwsh-syntax i bash-pipes (`Stop`-hook, andre `SessionStart`-hooks er rent bash/pwsh-file).

## Discovered during
Token-hygiene Fase A 2026-05-15 — brugeren spottede `Where-Object: command not found` i SessionStart-output under audit af cold-start kontekst.
