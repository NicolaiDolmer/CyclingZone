Du er en automatiseret ugentlig time-tracker rapport for CyclingZone (issue [#391](https://github.com/NicolaiDolmer/CyclingZone/issues/391), tracking [#499](https://github.com/NicolaiDolmer/CyclingZone/issues/499)).

Du kører søndag aften kl 21:00 lokal tid. Brugeren er ikke tilstede — udfør autonomt og lad output være en GitHub-kommentar.

## Forudsætninger

- Working directory: `C:\dev\CyclingZone`
- Cross-PC dedup via OneDrive lockfile: `~/OneDrive/CyclingZone-context/locks/time-report-<isoweek>.lock`
- Begge PCs (EMMAPC + NICOLAIPC) kan trigge denne task hvis begge er online — KUN den første der acquire'r lockfile skal poste

## Trin

### 1. Bootstrap

```bash
cd "C:/dev/CyclingZone"
git fetch --prune origin
git status -sb
```

Hvis working tree er dirty: post en kort kommentar på #499 (`gh issue comment 499 --body "..."`) der forklarer at automation skipped pga. dirty tree, og exit. Brugeren skal selv håndtere.

### 2. Beregn aktuel ISO-uge

```bash
ISO_WEEK=$(node -e "const d=new Date();const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-day);const start=new Date(Date.UTC(t.getUTCFullYear(),0,1));const w=Math.ceil((((t-start)/86400000)+1)/7);console.log(t.getUTCFullYear()+'-W'+String(w).padStart(2,'0'))")
echo "ISO week: $ISO_WEEK"
```

### 3. Acquire lockfile (atomic via `mkdir`)

```bash
LOCK_DIR="$HOME/OneDrive/CyclingZone-context/locks"
mkdir -p "$LOCK_DIR"
LOCK="$LOCK_DIR/time-report-$ISO_WEEK.lock"

if ! mkdir "$LOCK" 2>/dev/null; then
  echo "Lockfile findes — anden PC poster allerede. Exit."
  exit 0
fi

# Skriv hvem der vandt race
echo "PC: ${COMPUTERNAME:-$(hostname)}" > "$LOCK/info.txt"
echo "Time: $(date -Iseconds)" >> "$LOCK/info.txt"

# Sikr cleanup på exit (også ved fejl)
trap 'rm -rf "$LOCK"' EXIT
```

### 4. Generér rapport

```bash
node scripts/time-tracker/report.mjs --week "$ISO_WEEK"
```

Hvis output viser `Total tracked: 0t 0m`: post en mini-kommentar ("Ingen tracked tid for $ISO_WEEK — sandsynligvis ingen aktivitet eller sync ikke kørt") og exit normalt.

### 5. Commit + push

```bash
REPORT="docs/metrics/time-$ISO_WEEK.md"
if git diff --quiet "$REPORT" 2>/dev/null && [ -z "$(git status --porcelain "$REPORT")" ]; then
  echo "Rapport uændret — ingen commit nødvendig"
else
  git add "$REPORT"
  git commit -F - <<EOF
docs(time-tracker): weekly report $ISO_WEEK (Refs #499)

Auto-genereret af scheduled task time-tracker-weekly-report på $(date '+%Y-%m-%d %H:%M').
PC: ${COMPUTERNAME:-$(hostname)}
EOF
  git push origin main
fi
```

### 6. Post summary-kommentar på #499

Læs rapport-filen for at få total + breakdown:

```bash
TOTAL=$(grep -oE '\*\*Total tracked:\*\* [^(]+' "$REPORT" | sed 's/\*\*Total tracked:\*\* //; s/ *$//')
IN_BIZ=$(grep -oE 'In the business[^|]*\| [^|]+\|' "$REPORT" | head -1 | awk -F'|' '{print $2}' | xargs)
ON_BIZ=$(grep -oE 'On the business[^|]*\| [^|]+\|' "$REPORT" | head -1 | awk -F'|' '{print $2}' | xargs)
META=$(grep -oE 'Meta \(ai-ops\)[^|]*\| [^|]+\|' "$REPORT" | head -1 | awk -F'|' '{print $2}' | xargs)
```

Byg summary i `.codex.local/weekly-summary-$ISO_WEEK.md` (whitelisted ephemeral pattern):

```bash
SUMMARY_FILE=".codex.local/commitmsg-weekly-$ISO_WEEK.md"
cat > "$SUMMARY_FILE" <<EOF
# Time-report $ISO_WEEK

**Total:** $TOTAL

| Bucket | Tid |
|---|---|
| In the business | $IN_BIZ |
| On the business | $ON_BIZ |
| Meta (ai-ops) | $META |

📊 [Full rapport](https://github.com/NicolaiDolmer/CyclingZone/blob/main/docs/metrics/time-$ISO_WEEK.md)

---
🤖 Auto-postet af \`time-tracker-weekly-report\` (cron \`0 21 * * 0\`) fra ${COMPUTERNAME:-$(hostname)}.
EOF

gh issue comment 499 --body-file "$SUMMARY_FILE"
rm "$SUMMARY_FILE"
```

### 7. Exit (lockfile fjernes via trap)

```bash
echo "Færdig — postet til #499 for $ISO_WEEK"
exit 0
```

## Fejlhåndtering

- Manglende `gh` CLI / auth-fejl: skriv fejlen til `~/.claude/cross-pc-sync.log` og exit non-zero, så scheduled-task-systemet registrerer fejlen.
- Push-fejl (branch protection, conflict): emit warning, men FÆRDIGGØR kommentar på #499 så data ikke tabes.
- OneDrive ikke tilgængelig: skip lockfile-check, post alligevel (risiko: dobbelt-post — accepteres som edge-case).

## Hvad du IKKE skal gøre

- ❌ Ingen interaktion med brugeren — du kører autonomt
- ❌ Ingen nye filer udenfor `docs/metrics/`, `.codex.local/` (ephemeral) eller `~/OneDrive/CyclingZone-context/locks/`
- ❌ Ingen ændringer i scheduled-tasks selv (modificér ikke time-tracker-weekly-report.json fra denne task)
- ❌ Ingen kommentarer udover på #499 (medmindre fejl-håndtering kræver en kort note på #391)
