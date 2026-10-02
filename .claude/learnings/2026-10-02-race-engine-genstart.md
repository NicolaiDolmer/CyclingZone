# 2026-10-02 · Løbsmotor-genstart (orders_gc_v2)

## Hvad skete
Løbene var pauset 09.44-19.01, mens kaptajners tidstab, bjergetaper, udbrud og rullende etaper blev rettet (#6084, #6088, #6089, #6092, #6073, #6097). Genstart uden fejl: 23 forfaldne etaper i første kørsel, 13 løb bundet til `orders_gc_v2`.

## Læringer
1. **Mål målingen først.** "Udbruddet vinder 0 af 160" var en fejl i `dryRunUpcomingStage.mjs` (`components.breakaway` er 1/0, ikke true/false). Et helt spor var bygget på tallet. Tjek scriptets egen tælling mod én kendt etape, før et tal bliver et issue.
2. **Rolleregler kan tømme udbruddet.** Ejer-reglen "kun jægere/frie roller/Forsøg udbrud" gav 2-rytter-udbrud og ingen udbrud på hver fjerde etape i rigtige felter. Fanget først i den endelige test på alle genstartsløb; mål altid udbrudsstørrelse og "etaper uden udbrud", ikke kun vindere.
3. **Squash-merge af to PR'er der rører samme linje = ny konflikt pr. merge.** Løs kombinationen én gang i et integrations-worktree, mål den, og kopiér den løste fil ind i hver branch (diff mod integrationen = tom).
4. **Liga-vagten er falsk rød under en planlagt pause** (pausede løb ser "stalled" ud). Blokerede tre ejer-godkendte merges; ejeren måtte køre `gh pr merge --admin`. Ret i #6098.
5. **Test på main efter merge** (samme script, samme caches): 0 afvigelser mod det ejeren godkendte. Billig og giver et klart "det du sagde ja til er det der ligger".
