# #6088: GC-kaptajners tidstab under orders_gc_v1 i et rigtigt felt (2/10)

Kvalitativ rapport. Tal, fordelinger og før/efter-billedet ligger privat i `balance-internals/6088/` (`tal-6088.md`, `compare-races.txt`, `foer-efter-6088.png`); repoet er offentligt. Alt gælder kun løb bundet til `orders_gc_v1`; legacy er uændret (egne tests og hele v4-suiten grøn).

## Klassifikation

Beregningsfejl. Kompensationen i lad-gå-balancen blev også givet til udbrud hvor det den kompenserer for, ikke findes.

## Hvad der skete

- Under orders_gc_v1 består morgenudbruddet af de ryttere der fik en udbrudsordre, ikke af kaptajner der fyldes ind som under legacy. For at det svagere udbrud ikke altid blev spist af stigningerne, giver feltet det mere plads under denne revision (et ekstra loft på lad-gå-hullet pr. profil).
- I det rigtige felt sender holdene stærke ryttere med (ordre til kaptajner og hjælpere). Sådan et udbrud klatrer ikke fra hinanden. Samtidig er jagtens nettofordel negativ hele dagen på bjergetaperne, og feltet sprænges på første stigning, så ingen stor gruppe jager bagefter.
- Resultat: hullet nåede det ekstra loft, og hele loftet blev etapens forspring. Alle kaptajner bag udbruddet tabte flere gange så meget tid som under legacy.

## Sådan blev det fundet

Mekanikkerne blev slået til og fra én ad gangen i en harness-kopi af motoren (ikke i motoren selv) og målt med `dryRunUpcomingStage.mjs` på de kuperede og bjergrige etaper:

- Lad-gå-loftet alene forklarer tabet. Uden det ekstra loft er kaptajnernes tab under legacy-niveau; vækstfaktoren alene gør ingen forskel.
- Ordrestyret dannelse, GC-reaktionen, klatre-gain for "Kør roligt" og brosten flytter ikke tabet.
- Instrumentering pr. segment: hullet vokser under lad-gå-fasen til loftet, jagten lukker intet (negativ nettofordel), og efter første stigning er "jagtgruppen" en enkelt rytter, mens kaptajnernes gruppe ligger stille bagved.

## Rettelsen

- Det ekstra loft (ikke væksthastigheden) trappes ned for et udbrud der er stærkt på begge mål: samlet GC-trussel mod feltet (samme mål som grundloftet allerede bruger) og en klatrer på favoritniveau mod feltets bedste klatrere.
- Et bredt men harmløst udbrud (mange jægere) og en enkelt stærk rytter i et svagt udbrud beholder pladsen. Flad og rullende er uændret. Legacy er uændret.
- Ingen flag, ingen migration. Gaten følger den eksisterende lad-gå-gate i `letGoBalanceFor` (dækker også en senere revision når den gate udvides).

## Målt før/efter (kvalitativt)

- Giroens felt med GC-standings (etape 1 til N kørt i rækkefølge, som i prod fra etape 2): kaptajnernes tab er nu under legacy-niveau i gennemsnit og på næsten alle kuperede/bjergetaper; før var det flere gange legacy.
- Giroens felt uden GC-standings (enkelt-etape dry-run, som ejerens kommando): tabet er faldet til omkring en tredjedel af før, men ligger stadig over legacy på nogle etaper. Uden standings er GC-reaktionen slukket, så det er ikke prod-vejen fra etape 2.
- Rolle-reglerne holder: ingen leder i udbruddet uden "Forsøg udbrud" i nogen kørsel.
- To andre løb der starter i dag (fra den lokale cache): det ene er uændret (udbruddet er svagt), det andet er forbedret til legacy-niveau eller bedre.
- Kalibreringsharness (AI-scenariet): udbrudsoverlevelse og nye førere fra udbrud på legacy-niveau; GC-top-10's tidstab lidt bedre end før.
- Kalibreringsharness (stress-scenariet, alle hold lader gå og alle jægere forsøger): GC-tab bedre, men udbruddet overlever sjældnere end før og under legacy. Det er den afvejning rettelsen gør; ejer-synlig.
- Replay af prod-etaper (#5957-ankeret): korrelation mellem evne og placering uændret eller marginalt bedre på alle etapetyper.

## Anker

`backend/scripts/dev/giroCaptainTimeLoss6088.mjs` + `.test.mjs` med et anonymiseret fixture-udsnit (`backend/scripts/baselines/giro-field-6088-2026-10-02.json`, ingen navne eller id'er). Fejler før rettelsen og er grønt efter, både med og uden GC-standings.

## Ikke dækket

- Dry-runnet (`dryRunUpcomingStage.mjs`) sender ingen GC-standings med; prod gør fra etape 2. Ankeret simulerer standings ved at køre de forudgående etaper; de rigtige standings fra prod er ikke brugt.
- Stress-scenariets lavere udbrudsoverlevelse.
