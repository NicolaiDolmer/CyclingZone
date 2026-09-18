# Wave-briefs bad workers om at bryde hard rule 17

**Symptom:** I dagbølgen 18/9 lagde to workers ting i det offentlige repo, som ikke må ligge der:
balance-tal fra generator-testen i `docs/audits/` (#5283, PR #5368), og holdnavne + et
Discord-brugernavn i fair-play-rapporten og PR-body'en (#5203, PR #5366). Begge fanget af
revieweren før merge.

**Rod-årsag:** Orkestratorens egen opgavetekst bad om rapporten i `docs/audits/`. Hard rule 17
(offentlighedspolitik for balance-tal) og anonymiseringskravet stod i AGENTS.md, men ikke i den brief
workeren faktisk læser. En worker følger briefen; en regel der ikke står i den, findes ikke for den.
Samme fejlklasse som #5142: reglen lå i docs og hukommelse, ikke i den handling der starter arbejdet.

**Konsekvens:** Intet nåede main (squash-merge holder branch-historikken ude). Indholdet ligger
stadig i de to PR'ers commit-historik (GitHub beholder `refs/pull/N/head` også efter at branchen er
slettet), og GitHub gemmer redigeringshistorik på PR-beskrivelser. Det kan kun fjernes via GitHub
Support; ejeren afgør om det er umagen værd. Ingen e-mails eller user_id'er
var med.

**Fix:** `scripts/make-wave-brief.mjs` har fået offentligheds-reglen som FAST linje i regel-blokken
(aldrig betinget af input): ingen præcise balance-tal, holdnavne, brugernavne eller ID'er i
committede filer, PR-body, kommentarer eller commit-beskeder; fuld udgave i gitignoreret
`balance-internals/`. Briefen siger eksplicit, at en opgavetekst der beder om det modsatte er en
briefing-fejl. Test i `make-wave-brief.test.mjs` låser linjen.

**Backwards-check (18/9):** De to PR'ers endelige diffs er læst før/efter merge: #5368 skriver
rapporten til `balance-internals/`, #5366 bruger aliaser og størrelsesordener. `gitleaks` og
`leak-check` fanger secrets, ikke holdnavne eller balance-tal; der findes ingen maskinel guard for
det, og en sådan ville kræve en navneliste i repoet (som selv ville være lækagen).

**Forward-guard:** Reglen bor nu i brief-generatoren. For orkestratoren: read-only rapporter over
prod-data (fair-play, økonomi, generator) bestilles ALTID med to leverancer: anonymiseret udgave
til repoet og fuld udgave til `balance-internals/`. Revieweren pr. spor beholder tjekket som andet lag.
