# Recovery + all-division kalender-rebuild (2026-06-27)

Opfølgning på `.claude/learnings/2026-06-27-d3-reset-blitz.md` (blitz-hændelsen). Denne session ryddede op efter hændelsen, byggede hele kalenderen rigtigt og fik den live — uden gentagelse af fejlen.

## Hvad blev gjort
1. **Rod-årsag for blitzen rettet ordentligt** (3 fix, ikke quickfixes):
   - `calendarStartDate.js` (`resolveCalendarFrom`/`nextMonday`): dag-0 = valgt fremtidig dato (default næste mandag); guard afviser fortid/i-dag → blitz-fejlklassen (scheduled_at ≤ now på et live spil) er nu umulig.
   - **Cross-tier dedup** i `tierCalendarMaterializer`: intet løb deles mellem divisioner (ejer fangede det: tier1∩2=6, tier2∩3=10 løb). Tiers behandles stigende, hver udelukker højere tiers løb.
   - **Grand Tour-rygrad** i `tierRaceSelection` + `raceCalendarPacker`: alle 3 Grand Tours garanteres + spredes som rygrad med overlap; øvrige etapeløb foretrækker rene dage → alle 33 Div-1-løb passer (var: 10 droppet, fordi de 2 største blev gjort "solo" og blokerede ~10 dage). Reproducerer den ejer-godkendte pack.
2. **All-division rebuild anvendt** (`reset-all-divisions.mjs --apply`): 185 gamle løb → 209 nye, dato-synkrone fra 29/6; AI-præmie af-linket (balancer urørt); ægte spillere upåvirkede. Backup `backup_allreset_20260627_*` (10 tabeller) FØR sletning.
3. **Motoren tændt sikkert** — kun efter verificeret garanti: tidligste løb man 29/6 08:00, 0 forfaldne før mandag → intet kører i weekenden. Ejer-betinget go indhentet før tænding.

## Lessons
- **Læs/respektér ejer-godkendte planer.** "Skær til 8 etapeløb" var en quickfix-omgåelse; ejeren havde allerede godkendt en kalender hvor alle 33 løb passer — rod-årsagen var produktions-pakkeren (solo-Grand-Tours), ikke en reel begrænsning. Find ud af HVORFOR produktionen afviger fra den godkendte plan, før du ændrer planen.
- **Eksponér droppede løb (ingen tavse caps):** pakkeren rapporterede `unplacedStages/Singles`, men materializeren videregav dem ikke → "23 løb" skjulte at 10 blev droppet. Nu synligt.
- **Tænd live-systemer kun mod en strukturel garanti.** Motoren blev kun tændt efter at have verificeret at INTET løb har en dato før mandag (0 forfaldne) — ikke "den burde være sikker".
- **Backup før irreversibelt; verificér efter.** Sum af balancer = backup-sum bekræftede at af-link ikke rørte penge.
- **Recovery af hængt baggrunds-agent:** kalender-featuren var bygget men agenten hang (frosset output 69 min) før commit/push → arbejdet sikret fra worktree, verificeret, flettet ind. Tjek ground truth (mtime/bytes), ikke "running".
