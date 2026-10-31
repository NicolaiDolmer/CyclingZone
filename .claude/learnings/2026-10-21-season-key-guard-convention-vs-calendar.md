# Season-key-vagten maalte mod en konvention, kalenderen havde forladt (#7022)

**Symptom:** Sentry CYCLINGZONE-A9 (21/10 06:04 UTC): `season_transition_planned_at diverges`. Vagten forventede 27/10 17:00Z (aftenen foer start_date kl. 18), noeglen stod paa 25/10. Ville have alarmeret dagligt indtil S5-start 28/10.

**Rod-aarsag:** #5592 (23/9) flyttede kalenderens anker til det TIDLIGST MULIGE skifte (forrige saesons sidste etape + 30 min buffer) og lod `buildSeasonCalendar.js --apply` skrive netop den vaerdi til noeglen. Vagten fra #4129 blev ikke opdateret og maalte stadig mod den gamle konvention. Fra S5 slutter saesonen lørdag, saa skiftet ligger dage foer konventionen, og hver korrekt noegle blev en alarm.

**Data:** var korrekt (ejer-go 21/10 satte 25/10 18:30Z). S4's sidste etape 25/10 14:00Z, S5's foerste etape 28/10 10:00Z: noeglen ligger inden for begge graenser.

**Fix:** Er den kommende saesons kalender bygget, doemmes noeglen mod kalenderen: `too-early` (foer sidste etape + buffer) eller `too-late` (< 24 t til foerste etape). Konventionen gaelder kun uden etaper (glemt --apply).

**Laering:** Naar en regel flytter et anker (her #5592), grep efter ALLE laesere af ankeret, ogsaa read-only vagter og alarmer, ikke kun skriverne.
