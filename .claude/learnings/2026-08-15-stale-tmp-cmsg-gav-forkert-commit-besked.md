# Stale /tmp/cmsg.txt gav en forkert commit-besked på main

**Dato:** 2026-08-15 · **Commit:** `e637d0a6` (indhold korrekt, besked forkert) · **Korrektion:** `95bcf33d`

## Hvad skete der

En docs-commit til `docs/MASTERPLAN.md` blev committet med beskeden *"fix(sim): omdoeb key->gateName..."* — en besked fra en HELT anden session. Kæden var:

```
git pull --rebase && printf '...' > /tmp/cmsg.txt && git add ... && git commit -F /tmp/cmsg.txt
```

Pull fejlede (unstaged changes) → hele kæden stoppede → `printf` skrev ALDRIG filen. Ved gentag af kun `git add && git commit -F /tmp/cmsg.txt` lå der en **stale fil fra en parallel session** på præcis den sti, og den blev committet uden fejl. Amend + force-push var blokeret af branch-beskyttelsen, så beskeden står forkert i historikken med en tom korrektions-commit efter.

## Rod-årsag

1. **Generisk delt filnavn** (`/tmp/cmsg.txt`) på en maskine hvor flere Claude-sessioner kører parallelt — samme klasse som worktree-mappens `commit-msg*.txt`-efterladenskaber.
2. **Skriv-og-brug i samme kæde**: da kæden knækkede mellem skriv og brug, var der ingen kobling mellem "filen findes" og "filen er min".

## Guard fremover

- **Unikt filnavn pr. commit**: `/tmp/cmsg-<issue eller slug>.txt`, aldrig `/tmp/cmsg.txt`.
- **Genstart ALTID kæden fra printf** hvis en commit-kæde fejler — genbrug aldrig kun halen (`git commit -F ...`).
- **Verificér beskeden i outputtet**: `git commit` printer beskeden — læs den FØR push, ikke efter. Forkert besked opdaget før push er en gratis `--amend`; efter push er den permanent på beskyttet main.

Relateret: `feedback_bash_no_powershell_heredoc` (Write→fil + `-F` er stadig rigtigt — det er GENBRUGEN af generiske stier der bed).
