// S-02c · 9 board-arketyper med personality-akser, policy-akser og reaktions-templates.
// Master roadmap: docs/slices/02-board-redesign-MASTER.md (Q-batch 1B Q9 — låst 2026-05-05)
//
// Hver arketype har:
//  - personality_axes: matcher eksisterende deriveBoardPersonality-output (sports_ambition,
//    financial_risk, identity_strength) — brugt af boardEvaluation til weighting.
//  - policy_axes: 8 binære/triple-akser bruges til CONFLICT-detection ved wildcard-valg.
//    A2-præmis: 3 identity-matched + 2 wildcards, men wildcards må IKKE modsige eksisterende
//    medlemmers grundholdninger (debt_aversion, youth_focus, results_pressure er de
//    tre primære friction-akser).
//  - category_alignment: vægter hvilken feedback-kategori arketypen "ejer". Brugt til
//    sample-reaction-routing — Sponsoraten taler om økonomi, Resultatjægeren om resultater, etc.
//  - reactions: 30 templates pr. arketype = 270 total. 6 buckets × 5 templates:
//    feedback_positive, feedback_warning, feedback_negative,
//    goal_proposal, goal_achievement, goal_failure.
//
// Persistens-valg (A5 2026-05-05): kode-konstanter som BOARD_REQUEST_DEFINITIONS, ikke DB-tabel.
// Hurtigere iteration, sporbar i git, ingen seed-migration ved template-tilføj.

export const BOARD_ARCHETYPE_KEYS = [
  "sponsoraten",
  "traditionalisten",
  "talentspejderen",
  "resultatjaegeren",
  "pragmatikeren",
  "ungdomsidealisten",
  "nationalist_purist",
  "klassiker_purist",
  "gc_elsker",
];

// Policy-akser: low/medium/high. Bruges til conflict-detection.
// Konflikt = to medlemmer med high vs. low på samme akse, kun for de tre "friction-akser":
// debt_aversion, youth_focus, results_pressure. Andre akser kan have spread.
const FRICTION_AXES = ["debt_aversion", "youth_focus", "results_pressure"];

export const BOARD_ARCHETYPES = {
  sponsoraten: {
    key: "sponsoraten",
    label: "Sponsoraten",
    emoji: "💰",
    short_description: "Vogter sponsorforhold og økonomisk disciplin",
    long_description: "Tidligere kommerciel direktør. Holder øje med sponsoraftaler, balance og økonomisk risiko. Bliver nervøs ved gæld og krydser fingre for sponsor-vækst hver sæson.",
    personality_axes: { sports_ambition: "medium", financial_risk: "cautious", identity_strength: "medium" },
    policy_axes: {
      results_pressure: "medium",
      financial_caution: "high",
      debt_aversion: "high",
      youth_focus: "low",
      national_identity: "low",
      classics_focus: "low",
      gc_focus: "low",
      sponsor_growth_demand: "high",
    },
    category_alignment: { economy: 1.0, ranking: 0.7, identity: 0.3, results: 0.4 },
    reactions: {
      feedback_positive: [
        "Sponsorerne er glade — det her holder.",
        "Nu kan vi endelig vise tallene frem.",
        "Det her ligner et velsmurt projekt.",
        "Indtjeningen følger med ambitionen — perfekt.",
        "Bestyrelsen har ro i maven nu.",
      ],
      feedback_warning: [
        "Vi skal passe på balancen herfra.",
        "Sponsorerne kigger nervøst på tallene.",
        "Vi skal ikke jagte resultater på lånt tid.",
        "Held er ikke en plan — vi har brug for stabilitet.",
        "Hvis det vender, koster det dyrt.",
      ],
      feedback_negative: [
        "Det her holder ikke i længden.",
        "Sponsorerne ringer — og ikke for at rose os.",
        "Tallene siger det vi ikke vil høre.",
        "Vi mister tillid hver gang det her gentages.",
        "Hvis det fortsætter, er der ingen budget næste år.",
      ],
      goal_proposal: [
        "Det her sikrer pengestrømmen.",
        "Sponsoraftalen vil belønne det her.",
        "Realistisk og budgetvenligt — ja tak.",
        "Det giver os ro til at planlægge.",
        "Konservativt — men det er styrken.",
      ],
      goal_achievement: [
        "Præcis det vi håbede på — godt arbejde.",
        "Sponsorerne ringede selv for at takke.",
        "Det her overholder budgettet til punkt og prikke.",
        "Solide tal — sådan bygger vi videre.",
        "Tilliden vokser med hvert kvartal.",
      ],
      goal_failure: [
        "Vi misser det igen — sponsorerne mærker det.",
        "Det er ikke længere et regnskabsproblem alene.",
        "Vi bløder mere end forventet.",
        "Investorerne stiller spørgsmål nu.",
        "Det her sætter næste sæsons sponsorforhandling i fare.",
      ],
      // #3514 S-M2a · Mandat-buckets, reference-indhold (ejer-tone-prøve 1/9).
      // Sponsoraten taler i tal og risiko, jf. addendummets kontrast-krav.
      receipt_positive: [
        "Budgettet holder, og sponsorerne ringer for at forny.",
        "Vi krydsede målet uden at røre kassen.",
        "Tre kvartaler i træk i sort. Det er ikke held, det er drift.",
        "Regnskabet ser bedre ud end min prognose. Sjældent.",
      ],
      receipt_negative: [
        "Vi bruger af reserven igen. Det tal skal vende.",
        "Sponsorindtægten er under budget tredje måned i træk.",
        "Jeg kan ikke forsvare det her tal på næste møde.",
        "Gælden vokser hurtigere end omsætningen. Det er ikke bæredygtigt.",
      ],
      meeting_easier: [
        "Et lavere mål betyder et lavere loft for sponsorerne. Jeg tager det, men noterer det.",
        "Det her er den forsigtige vej. Fint med mig.",
        "Lempet, men stadig et tal jeg kan stå inde for over for sponsorerne.",
        "Jeg foretrækker et mål vi rammer frem for et vi jagter.",
      ],
      meeting_keep: [
        "Samme tal, samme forventning. Det respekterer jeg.",
        "Ingen ændring i budgettet, ingen ændring i mit blik.",
        "Vi holder kursen. Det er ofte den rigtige beslutning.",
        "Fastholdt, som det bør være når tallene stadig går op.",
      ],
      meeting_stretch: [
        "Et højere mål kræver et bedre regnskab bagved. Vis mig det.",
        "Jeg strammer mit blik lige så meget som målet strammes.",
        "Ambitiøst. Sponsorerne vil spørge hvordan vi finansierer det.",
        "Et stræk-mål jeg accepterer, men jeg fører regnskab med hver måned.",
      ],
      midseason_status: [
        "Vi er midtvejs. Tallene på bordet i dag er dem jeg kan stå inde for.",
        "Halvvejs gennem sæsonen, og bestyrelsen ønsker et ærligt billede, ikke et pyntet.",
        "Status er ikke en dom. Det er et øjebliksbillede vi handler på.",
        "Jeg har set værre halvvejs-regnskaber end det her.",
      ],
      milestone_achieved: [
        "Milepælen er nået, og regnskabet bekræfter det. Det er sjældent begge dele på samme tid.",
        "Vi fejrer det her, og så finder bestyrelsen det næste mål til det tomme felt.",
        "Nået før tid. Sponsorerne lægger mærke til den slags.",
        "Et lukket kapitel med et rent regnskab. Godt arbejde.",
      ],
      milestone_missed: [
        "Milepælen glipper, og det koster på tilliden, ikke kun på tallet.",
        "Vi må se de her tal i øjnene uden at pynte på dem.",
        "Ikke katastrofalt, men bestyrelsen forventede mere på det her tidspunkt.",
        "Jeg skriver det ned. Næste årsmøde tager vi det op igen.",
      ],
      extraordinary_meeting: [
        "Bestyrelsen indkalder til et ekstraordinært møde. Tallene kan ikke vente til næste årsmøde.",
        "Det her er ikke rutine. Vi mødes nu, ikke til sommer.",
        "Jeg har bedt om et ekstra møde. Regnskabet kræver det.",
        "Vi samles udenfor turnus, fordi noget her ikke kan vente.",
      ],
      chairman_departure: [
        "Jeg forlader formandsposten med regnskabet i orden. Det er den arv jeg ville have.",
        "Min tid som formand slutter her. Pas godt på tallene efter mig.",
        "Jeg takker af. Klubbens økonomi står bedre end da jeg overtog.",
        "Formandsposten går videre. Jeg beholder mine bekymringer for mig selv fra nu af.",
      ],
      chairman_arrival: [
        "Jeg overtager formandsposten, og det første jeg gør er at læse regnskabet.",
        "Ny formand, samme krav til tallene.",
        "Jeg går ind i det her med øjnene åbne og lommeregneren klar.",
        "Det er min tur nu. Jeg lover ikke mirakler, kun et ærligt regnskab.",
      ],
    },
  },

  traditionalisten: {
    key: "traditionalisten",
    label: "Traditionalisten",
    emoji: "🎩",
    short_description: "Vægter klubbens arv og national identitet",
    long_description: "Sidder i bestyrelsen fordi han var der i forrige århundrede — eller næsten. Vil have at klubben minder folk om hvor den kommer fra. Mindst begejstret for moderne flair.",
    personality_axes: { sports_ambition: "medium", financial_risk: "cautious", identity_strength: "high" },
    policy_axes: {
      results_pressure: "medium",
      financial_caution: "medium",
      debt_aversion: "medium",
      youth_focus: "low",
      national_identity: "high",
      classics_focus: "medium",
      gc_focus: "medium",
      sponsor_growth_demand: "low",
    },
    category_alignment: { identity: 1.0, results: 0.6, ranking: 0.5, economy: 0.4 },
    reactions: {
      feedback_positive: [
        "Klubben bærer sin arv med stolthed.",
        "Det her er hvad bestyrelsen drømte om i 90'erne.",
        "Holdet ligner sig selv igen.",
        "Folk genkender klubben i pelotonen.",
        "Sjælen er intakt — det vigtigste.",
      ],
      feedback_warning: [
        "Vi mister os selv lidt i jagten.",
        "Hvor er klubbens identitet henne?",
        "Det her ligner andres hold mere end vores.",
        "Tradition er ikke et bonus-felt.",
        "Der mangler noget genkendeligt.",
      ],
      feedback_negative: [
        "Vi er blevet en fremmed på vores egen vej.",
        "Klubben kan ikke kendes længere.",
        "Det er som at se en anden klub køre i vores trøje.",
        "Det her er et brud med alt klubben står for.",
        "Vores fans græder — og det gør jeg næsten med.",
      ],
      goal_proposal: [
        "Det her ligner klubbens DNA.",
        "Sådan har det altid været hos os.",
        "Vores fans vil mærke det.",
        "Det er kontinuitet — ja.",
        "Bestyrelsen genkender klubben i det her.",
      ],
      goal_achievement: [
        "Ægte klubånd — sådan skal det være.",
        "Forfædrene ville smile.",
        "Det her er hvorfor vi findes.",
        "Sådan bygger man en klub der varer.",
        "Identiteten står tydeligere nu.",
      ],
      goal_failure: [
        "Det er et hårdt slag mod arven.",
        "Vi skylder klubben en undskyldning.",
        "Det her ville aldrig ske i de gamle dage.",
        "Vi taber jord på den hjemmebane vi ejer.",
        "Hvor er stoltheden henne?",
      ],
      // #3514 S-M2a · Mandat-buckets, ejer-godkendt 1/9 (tone-prøve-udvidelse).
      // Traditionalisten taler i klubbens historie og arv.
      receipt_positive: [
        "Klubben ligner stadig sig selv. Det er værd mere end noget enkelt resultat.",
        "Vi skriver endnu en side den gamle garde ville genkende.",
        "Det her er klubben jeg meldte mig til at beskytte, i god behold.",
        "Historien gentager sig ikke her, den fortsætter.",
      ],
      receipt_negative: [
        "Vi glider væk fra det klubben altid har stået for.",
        "Klubmærket fortjener bedre end det her.",
        "Jeg genkender os ikke i det her.",
        "De gamle medlemmer ville ikke acceptere det her, og det bør vi heller ikke.",
      ],
      meeting_easier: [
        "Et lettere mål sletter ikke vores historie. Det kan jeg leve med.",
        "Klubben har overlevet stillere sæsoner end den her før.",
        "Lempet, men mærket på trøjen er det samme.",
        "Fint, så længe vi ikke lemper på det vi står for.",
      ],
      meeting_keep: [
        "Fastholdt. Kontinuitet er halvdelen af hvad klubben er.",
        "Ingen ændring, og de gamle medlemmer ville nikke til den stabilitet.",
        "Vi holder linjen, som klubben altid har gjort.",
        "Samme mål. Klubben jagter ikke enhver ny trend.",
      ],
      meeting_stretch: [
        "En større ambition, så længe det stadig ligner os når vi når derhen.",
        "Stræk det, men stræk os ikke væk fra hvem vi er.",
        "Jeg accepterer et hårdere mål for en klub med så meget historie bag sig.",
        "Ambitiøst, og arkiverne vil huske hvilken æra der gjorde det her.",
      ],
      midseason_status: [
        "Halvvejs, og klubben ligner stadig den fra de gamle billeder.",
        "Den her status hører til i klubbens egen historie, godt som skidt.",
        "Vi bedømmes ved midtvejs på samme måde som hver bestyrelse før os er blevet det.",
        "Halvvejs, og jeg genkender stadig holdet vi sendte af sted om foråret.",
      ],
      milestone_achieved: [
        "Milepælen er nået, og den hører hjemme i klubbens egne rekordbøger.",
        "Endnu et kapitel skrevet, som grundlæggerne ville have ønsket det.",
        "Det her er den slags øjeblik de gamle medlemmer taler om i årevis.",
        "Nået, og klubbens historie blev lige en anelse længere.",
      ],
      milestone_missed: [
        "Milepælen glipper, og det gør mere ondt her end et tal burde.",
        "Klubben har stået værre igennem før og forblevet sig selv. Det gør den igen.",
        "Vi skylder de gamle medlemmer bedre end en misset milepæl.",
        "Ikke den slutning det her kapitel fortjente. Vi skriver det næste ordentligt.",
      ],
      extraordinary_meeting: [
        "Bestyrelsen indkalder til et ekstraordinært møde. Nogle ting kan ikke vente på kalenderen.",
        "Det her er ikke rutine, og klubbens historie siger vi handler når det tæller.",
        "Jeg bad om at samles nu. Mærket er et tidligt møde værd.",
        "Ekstraordinært møde, fordi klubben fortjener mere end et skuldertræk.",
      ],
      chairman_departure: [
        "Jeg forlader formandsposten. Klubben stod her længe før mig og vil stå længe efter.",
        "Min tid slutter her, men historien jeg fik betroet fortsætter.",
        "Jeg takker af med klubben stadig lignende sig selv. Det var opgaven.",
        "Formandsposten går videre. En anden bærer det gamle flag nu.",
      ],
      chairman_arrival: [
        "Jeg overtager formandsposten, og det første jeg gør er at læse klubbens egen historie.",
        "Ny formand, samme respekt for det der kom før mig.",
        "Jeg går ind i det her med fuld viden om hvis skuldre jeg står på.",
        "Det er min tur nu. Jeg lover at efterlade mærket lige så stolt som jeg fandt det.",
      ],
    },
  },

  talentspejderen: {
    key: "talentspejderen",
    label: "Talentspejderen",
    emoji: "🔭",
    short_description: "Tror på langsigtet ungdomsudvikling",
    long_description: "Tidligere sportsdirektør for et udviklingshold. Vil hellere se en 22-årig vinde fem år frem end en 32-årig vinde nu. Husker hver U25-stat udenad.",
    personality_axes: { sports_ambition: "medium", financial_risk: "balanced", identity_strength: "high" },
    policy_axes: {
      results_pressure: "low",
      financial_caution: "medium",
      debt_aversion: "medium",
      youth_focus: "high",
      national_identity: "medium",
      classics_focus: "low",
      gc_focus: "low",
      sponsor_growth_demand: "low",
    },
    category_alignment: { identity: 0.9, results: 0.5, ranking: 0.6, economy: 0.5 },
    reactions: {
      feedback_positive: [
        "Talenterne får luft — og leverer.",
        "Det her er præcis sådan man bygger fremtiden.",
        "Om fem år forstår alle det her valg.",
        "Ungdommen blomstrer — sjældent set så tydeligt.",
        "Næste generation tager rolle nu.",
      ],
      feedback_warning: [
        "Vi skal ikke glemme ungdommen i jagten.",
        "Talenterne får for lidt løb.",
        "Hvor er U25-rotationen?",
        "Vi har bedre folk i 2'eren end vi viser.",
        "Vi sælger fremtiden for én sejr.",
      ],
      feedback_negative: [
        "Vi efterlader en hel generation på bænken.",
        "De unge brænder ud uden løb i benene.",
        "Det her er ingen fremtid for klubben.",
        "Talenterne flygter til andre hold næste år.",
        "Vi har misforstået hvad et hold er.",
      ],
      goal_proposal: [
        "Det her åbner døre for de unge.",
        "Kortlagt udvikling — vi tager imod.",
        "De unge har brug for præcis det her.",
        "Sådan vokser man et hold organisk.",
        "Det her vil løfte mere end ét bord-felt.",
      ],
      goal_achievement: [
        "Talenterne leverede — som forudsagt.",
        "Den her udvikling skaber årtiers værdi.",
        "U25 har taget skridtet — herligt at se.",
        "Sådan sender man et signal til scoutsene.",
        "Det her bekræfter hele udviklings-filosofien.",
      ],
      goal_failure: [
        "De unge fik ikke chancen — vores fejl.",
        "Vi bærer ansvaret for stagneret udvikling.",
        "Det her tager talenter længere tid at hele.",
        "Vi mistede noget vi byggede over år.",
        "Bedre rotation havde løst det her.",
      ],
      // #3514 S-M2a · Mandat-buckets, ejer-godkendt 1/9 (tone-prøve-udvidelse).
      // Talentspejderen taler i fund og potentiale (spejder-blik, tal, projektion),
      // ikke i udvikling/debutanter som ungdomsidealisten.
      receipt_positive: [
        "Jeg skrev den rytter ned for to sæsoner siden. Tallene indhenter endelig øjnene.",
        "Endnu et navn fra min liste begynder at levere.",
        "Det her er præcis den slags potentiale jeg spejder efter, og det dukker op til tiden.",
        "Fundet tidligt, udviklet tålmodigt, og nu viser det sig.",
      ],
      receipt_negative: [
        "Et talent jeg pegede på er gået i stå, og det er udviklingsplanen der fejler, ikke rytteren.",
        "Potentialet er ægte. Vejen til at bruge det er det ikke.",
        "Jeg spejder ikke efter ryttere for at se dem sidde stille.",
        "Et sted skriver en spejder fra en anden klub navnet ned på den vi spilder.",
      ],
      meeting_easier: [
        "En lavere bar giver udviklingsrøret mere tid til at modne, den handel tager jeg.",
        "Lempet, og det betyder færre tvungne valg på ryttere der ikke er klar endnu.",
        "Fint med mig. Potentiale kræver tålmodighed mere end pres.",
        "Jeg beskytter hellere det lange spil end jagter denne sæsons tal.",
      ],
      meeting_keep: [
        "Samme mål. Min spejderliste ændrer sig heller ikke på et indfald.",
        "Fastholdt, og de fremskrivninger jeg har lavet holder stadig.",
        "Ingen ændring nødvendig, udviklingsrøret følger den tidslinje jeg lagde.",
        "Fint, de tal jeg følger behøver ikke et nyt mål for at flytte sig.",
      ],
      meeting_stretch: [
        "En højere bar er fin, hvis den ikke tvinger et halvt-klart navn ind på startlisten.",
        "Stræk det, men stræk ikke en nittenårig længere end tallene siger han kan klare.",
        "Jeg accepterer det, så længe udviklingsrøret får den tid det har brug for.",
        "Ambitiøst, og jeg holder klubben til at beskytte udviklingen mens vi jagter det.",
      ],
      midseason_status: [
        "Halvvejs, og jeg vil vide hvilke navne på min liste der faktisk fik minutter.",
        "Statusrapporten skal vise mig kurver, ikke kun denne uges placeringer.",
        "Jeg måler sæsonen på hvor mange emner der er rykket op på min liste, ikke kun på tabellen.",
        "Halvvejs, og tre navne jeg pegede på inden sæsonen udvikler sig præcis som forudsagt.",
      ],
      milestone_achieved: [
        "Milepælen er nået, og et navn fra min gamle liste var med til at gøre det.",
        "Det her beviser at spejder-modellen virker, ikke kun truppen.",
        "Nået, og det startede som en fornemmelse i et regneark for tre år siden.",
        "Det her er gevinsten ved at satse på potentiale før resultaterne fandtes.",
      ],
      milestone_missed: [
        "Milepælen glipper, og jeg tjekker om udviklingsrøret nogensinde fik en reel chance.",
        "Ikke katastrofalt, men et par navne på min liste havde brug for flere minutter end de fik.",
        "Vi skylder udviklingsstien et hårdere kig før næste forsøg.",
        "Jeg noterer hvilke emner der blev holdt tilbage. De data forsvinder ikke.",
      ],
      extraordinary_meeting: [
        "Bestyrelsen indkalder ekstraordinært, og jeg vil have udviklingsrørets behov på bordet.",
        "Det her kan ikke vente, og det kan det vindue nogle af de her emner har heller ikke.",
        "Jeg bad om at samles nu. Et spejder-vindue åbner ikke igen på anmodning.",
        "Ekstraordinært møde, fordi en beslutning her former navne på min liste i årevis.",
      ],
      chairman_departure: [
        "Jeg forlader formandsposten. Listen jeg byggede bliver liggende til den næste.",
        "Min tid slutter her, men navnene jeg pegede på bliver ved med at udvikle sig uden mig.",
        "Jeg takker af efter at have fundet mere talent end jeg fik ære for.",
        "Formandsposten går videre. Hold øje med dem jeg markerede, de er ikke færdige endnu.",
      ],
      chairman_arrival: [
        "Jeg overtager formandsposten, og det første jeg gør er at læse alle spejderrapporter.",
        "Ny formand, samme blik for hvad en rytter kan blive om tre år.",
        "Jeg går ind i det her med blikket forbi denne sæsons trup, mod den næste.",
        "Det er min tur nu. Jeg lover at finde navnene ingen andre holdt øje med endnu.",
      ],
    },
  },

  resultatjaegeren: {
    key: "resultatjaegeren",
    label: "Resultatjægeren",
    emoji: "🏆",
    short_description: "Vil vinde nu — alt andet er undskyldninger",
    long_description: "Eks-sportsdirektør med tre Tour-podier på cv'et. Tål er ikke en personlig styrke. Vurderer et hold på sejre, podier og pointtotaler — punktum.",
    personality_axes: { sports_ambition: "high", financial_risk: "aggressive", identity_strength: "low" },
    policy_axes: {
      results_pressure: "high",
      financial_caution: "low",
      debt_aversion: "low",
      youth_focus: "low",
      national_identity: "low",
      classics_focus: "medium",
      gc_focus: "medium",
      sponsor_growth_demand: "medium",
    },
    category_alignment: { results: 1.0, ranking: 0.9, economy: 0.4, identity: 0.3 },
    reactions: {
      feedback_positive: [
        "Sejre. Endelig sejre.",
        "Det er hvad jeg blev hyret for at se.",
        "Resultaterne taler for sig selv.",
        "Modstanderne kigger nervøst nu.",
        "Det her er et vinderhold — endelig.",
      ],
      feedback_warning: [
        "Sejrene er for få og for små.",
        "Vi kører i top-10 men ikke top-3.",
        "Det er ikke nok at deltage.",
        "Modstanderne mærker os ikke endnu.",
        "Hvor er det knæk der vinder løb?",
      ],
      feedback_negative: [
        "Det her er uacceptabelt.",
        "Resultaterne er en katastrofe.",
        "Vi er usynlige i pelotonen.",
        "Det her hold burde vinde mere — meget mere.",
        "Hvor mange løb skal vi tabe før vi reagerer?",
      ],
      goal_proposal: [
        "Endelig noget med tænder i.",
        "Det her vinder vi — eller skifter vi cykler ud.",
        "Sådan stiller man krav.",
        "Vi tager det. Næste mål?",
        "Det er jagten der gør det sjovt — ind med det.",
      ],
      goal_achievement: [
        "Sejren er hjemme — kør videre.",
        "Det er sådan vi kender klubben fra de gode år.",
        "Modstanderne så det komme — og kunne ikke stoppe os.",
        "Endelig leverer vi — keep going.",
        "Det her er hvad bestyrelsen blev valgt for at se.",
      ],
      goal_failure: [
        "Det her er pinligt.",
        "Vi tabte til hold vi burde knuse.",
        "Stå frem og forklar.",
        "Det er ikke et hold — det er en undskyldning.",
        "Næste plan skærper kravene markant.",
      ],
      // #3514 S-M2a · Mandat-buckets, ejer-godkendt 1/9 (tone-prøve-udvidelse).
      // Resultatjægeren taler i sejre og placeringer, blunt og utålmodig.
      receipt_positive: [
        "En sejr er en sejr. Bliv ved.",
        "Vi klatrer i stillingen, og det er den eneste tabel jeg læser.",
        "Podier. Endelig noget værd at tale om.",
        "Det her er hvad en sejr ligner. Mere af det.",
      ],
      receipt_negative: [
        "Ingen sejre er ingen sejre. Undskyldninger tæller ikke på en tabel.",
        "Vi glider ned i stillingen, og jeg accepterer ikke langsomt.",
        "Andenpladsen er den første taber, og vi har samlet for mange af dem.",
        "Den her tabsstime skal stoppe i denne uge, ikke næste.",
      ],
      meeting_easier: [
        "Et lavere mål skal stadig ende med sejre, ellers er det ikke et mål.",
        "Fint, men let betyder stadig en sejr i mål, ikke et godt forsøg.",
        "Lempet, og jeg forventer det op igen så snart vi begynder at vinde.",
        "Jeg accepterer det nødtvunget. Klubben sigter ikke lavt ret længe.",
      ],
      meeting_keep: [
        "Samme mål. En sejr har ikke brug for rabat.",
        "Fastholdt, fordi standarden ikke skal flyttes for nogen.",
        "Ingen ændring. Vi blev hyret til at vinde, ikke til at genforhandle.",
        "Fint, tallet står. Gå så ud og vind det.",
      ],
      meeting_stretch: [
        "Et hårdere mål. Endelig vil nogen i det her lokale vinde.",
        "Stræk det. Jeg ville have bedt om mere alligevel.",
        "Godt. Ambition er det eneste jeg altid accepterer uden kamp.",
        "Sæt det højere. Klubben skal have ondt i maven ved at jagte mindre end det.",
      ],
      midseason_status: [
        "Halvvejs, og jeg tæller sejre, ikke indsats.",
        "Den her status er ét tal for mig: hvor mange gange har vi vundet.",
        "Midtvejs er ikke til undskyldninger. Det er til en tabel.",
        "Halvvejs, og jeg vil have flere sejre i anden halvdel end vi har nu.",
      ],
      milestone_achieved: [
        "Milepælen er nået, fordi vi vandt da det gjaldt.",
        "Endelig en milepæl der matcher hvad klubben burde levere.",
        "Nået. Find nu den næste, højere.",
        "Sådan skal bestyrelsen altid se ud: sejre på tavlen.",
      ],
      milestone_missed: [
        "Milepælen glipper, og det er uacceptabelt på det her niveau.",
        "Vi havde truppen til at ramme det. Vi ramte det ikke. Forklar det.",
        "At misse det her koster mere end selve milepælen. Det koster troværdighed.",
        "Næste forsøg får et skarpere mål og nul tålmodighed med undskyldninger.",
      ],
      extraordinary_meeting: [
        "Bestyrelsen indkalder ekstraordinært. Den her tabsstime venter ikke på kalenderen.",
        "Det her er ikke rutine. Vi mødes nu, fordi stillingen ikke retter sig selv.",
        "Jeg krævede et ekstra møde. Ingen taber så mange løb uden en hård samtale.",
        "Ekstraordinært møde, fordi acceptabelt ikke er et ord jeg bruger om det her resultat.",
      ],
      chairman_departure: [
        "Jeg forlader formandsposten. Bedøm mig på sejrene, det var altid aftalen.",
        "Min tid slutter her. Jeg bad aldrig om at blive kunne lide, kun om at vinde.",
        "Jeg takker af. Pokalskabet siger om jeg gjorde mit arbejde.",
        "Formandsposten går videre. Den næste bør ville vinde lige så meget som jeg gjorde.",
      ],
      chairman_arrival: [
        "Jeg overtager formandsposten, og det første jeg gør er at se på sidste sæsons resultater.",
        "Ny formand, samme krav: vind nu, forklar aldrig.",
        "Jeg går ind i det her for at vinde, ikke for at forvalte forventninger.",
        "Det er min tur nu. Jeg lover intet, udover at det ikke bliver behageligt at tabe her.",
      ],
    },
  },

  pragmatikeren: {
    key: "pragmatikeren",
    label: "Pragmatikeren",
    emoji: "⚖️",
    short_description: "Søger balancen mellem ambition og forsigtighed",
    long_description: "Tidligere bestyrelsesleder i industrien. Kigger på alt fra et risiko/belønnings-forhold. Sjældent eufirisk, sjældent panisk — sjældent enig med sig selv to dage i træk.",
    personality_axes: { sports_ambition: "medium", financial_risk: "balanced", identity_strength: "medium" },
    policy_axes: {
      results_pressure: "medium",
      financial_caution: "medium",
      debt_aversion: "medium",
      youth_focus: "medium",
      national_identity: "medium",
      classics_focus: "medium",
      gc_focus: "medium",
      sponsor_growth_demand: "medium",
    },
    category_alignment: { ranking: 0.8, economy: 0.7, results: 0.7, identity: 0.7 },
    reactions: {
      feedback_positive: [
        "Det her ligner en sund balance.",
        "Risiko og belønning matches fint.",
        "Holdet leverer på flere fronter — godt.",
        "Det er bæredygtigt — det vi går efter.",
        "Ingen røde flag, mange grønne.",
      ],
      feedback_warning: [
        "Det her er på vippen — hold øje.",
        "Vi taber lidt på alle felter.",
        "Det balancerer for tæt på kanten.",
        "Lidt mere disciplin og det vender.",
        "Vi mangler ét bord der løfter.",
      ],
      feedback_negative: [
        "Risikoen overgår belønningen markant.",
        "Det her holder ikke ved et nyt stresstest.",
        "Vi taber på begge sider af bordet.",
        "Det er ikke en plan længere — det er drift.",
        "Bestyrelsen kan ikke forsvare det her.",
      ],
      goal_proposal: [
        "Realistisk — vi bakker op.",
        "Det matcher hvor vi er nu.",
        "Sådan undgår man overstretching.",
        "Det er pragmatisk og tydeligt — ja.",
        "Det her er en god mellemvej.",
      ],
      goal_achievement: [
        "Som forventet — solidt arbejde.",
        "Det er hvad pragmatik skal kunne.",
        "Holdet leverede uden drama.",
        "Sådan ser bæredygtighed ud.",
        "Næste mål kan bygges ovenpå det her.",
      ],
      goal_failure: [
        "Det burde have været inden for rækkevidde.",
        "Skuffende — uden klare undskyldninger.",
        "Vi vælger næste plan med skærpede krav.",
        "Det her bekymrer mere end det burde.",
        "Bestyrelsen forventer en åben evaluering.",
      ],
      // #3514 S-M2a · Mandat-buckets, ejer-godkendt 1/9 (tone-prøve-udvidelse).
      // Pragmatikeren taler i afvejninger, risiko/belønning, aldrig i yderpunkter.
      receipt_positive: [
        "Risiko og belønning stemmer endelig overens. Det er alt jeg nogensinde beder om.",
        "Ikke spektakulært, men heller ikke udsat noget sted. Det tager jeg.",
        "Det her er den slags afbalanceret uge der faktisk bygger noget.",
        "Vi vinder på flere fronter end vi taber på. Godt nok er godt.",
      ],
      receipt_negative: [
        "Vægten har tippet, og jeg kan ikke lide hvilken vej.",
        "Vi taber lidt på alle fronter. Det lægger sig hurtigere sammen end ét stort tab.",
        "Det her er ikke en krise endnu, men det holder op med at være fint hvis det gentager sig.",
        "Den afvejning vi accepterede betaler sig ikke, som den skulle.",
      ],
      meeting_easier: [
        "Et lavere mål er en fair handel for en sæson der har brug for luft.",
        "Lempet, og det er en fornuftig justering, ikke en tilbagetrækning.",
        "Jeg kan leve med lavere, så længe det er en beslutning og ikke en glidning.",
        "Fint. Nogle gange er det afbalancerede valg det mindre tal.",
      ],
      meeting_keep: [
        "Samme mål. Det var afbalanceret da vi satte det, og intet har ændret det.",
        "Fastholdt. Jeg flytter ikke et tal bare fordi nogen er utålmodig.",
        "Ingen ændring nødvendig, afvejningen holder stadig ved nærmere eftersyn.",
        "Fint som det står. Et stabilt mål er mere værd end et reaktivt et.",
      ],
      meeting_stretch: [
        "Et højere mål, så længe vi er ærlige om hvad vi risikerer for det.",
        "Stræk det, men jeg vil have ulempen skrevet ned før vi underskriver.",
        "Jeg accepterer det, hvis fordelen reelt opvejer det der kan gå galt.",
        "Ambitiøst er fint. Skødesløst er det ikke, og jeg holder øje med grænsen.",
      ],
      midseason_status: [
        "Halvvejs, og billedet er hverken så godt eller så dårligt som det føles.",
        "Den her status er et øjebliksbillede, ikke en dom. Lad os behandle den sådan.",
        "Noget går op, noget går ned. Det er en normal sæson, ikke en krise.",
        "Halvvejs, og balancen holder stadig, lige akkurat, og netop derfor holder vi øje.",
      ],
      milestone_achieved: [
        "Milepælen er nået, og afvejningerne undervejs var det værd.",
        "Nået uden at bryde noget andet for at komme dertil. Det er den rigtige sejr.",
        "Sådan ser en afbalanceret plan ud når den betaler sig.",
        "Godt udfald, og jeg ville tage de samme afvejninger igen.",
      ],
      milestone_missed: [
        "Milepælen glipper. Ikke enden på planen, men et hårdt kig på hvorfor er det værd.",
        "Vi regnede afvejningen forkert et sted. Lad os finde hvor.",
        "Skuffende, men ingen grund til at forlade den afbalancerede tilgang.",
        "Jeg noterer det. Næste plan justerer vægtningen, ikke filosofien.",
      ],
      extraordinary_meeting: [
        "Bestyrelsen indkalder til et ekstraordinært møde. Balancen har tippet nok til at retfærdiggøre det.",
        "Det her er ikke rutine, men det er heller ikke panik. Vi justerer bare tidligt.",
        "Jeg bad om et tidligere møde, fordi at vente ville koste mere end at mødes gør.",
        "Ekstraordinært møde, afvejet roligt mod at vente til den sædvanlige dato.",
      ],
      chairman_departure: [
        "Jeg forlader formandsposten med både regnskab og trup i rimelig form.",
        "Min tid slutter her. Jeg jagtede aldrig det spektakulære, kun det bæredygtige.",
        "Jeg takker af efter at have holdt flere vægtskåle stabile end tippet over.",
        "Formandsposten går videre. Den næste bør altid veje begge sider.",
      ],
      chairman_arrival: [
        "Jeg overtager formandsposten, og det første jeg gør er at veje det der virker mod det der ikke gør.",
        "Ny formand, samme instinkt for at se afvejningen før overskriften.",
        "Jeg går ind i det her for at finde balance, ikke bifald.",
        "Det er min tur nu. Jeg lover afmålte beslutninger, ikke dramatiske.",
      ],
    },
  },

  ungdomsidealisten: {
    key: "ungdomsidealisten",
    label: "Ungdoms-idealisten",
    emoji: "🌱",
    short_description: "Klubbens fremtid bygges på unge ben",
    long_description: "Pædagog og tidligere træner i 1. divisions-systemet. Vil have at klubben er kendt for at fostre talenter — uden at sælge dem ud bagefter. Forstår at hver vinder var ung engang.",
    personality_axes: { sports_ambition: "low", financial_risk: "cautious", identity_strength: "high" },
    policy_axes: {
      results_pressure: "low",
      financial_caution: "high",
      debt_aversion: "high",
      youth_focus: "high",
      national_identity: "medium",
      classics_focus: "low",
      gc_focus: "low",
      sponsor_growth_demand: "low",
    },
    category_alignment: { identity: 1.0, results: 0.4, ranking: 0.4, economy: 0.6 },
    reactions: {
      feedback_positive: [
        "De unge får luft — det er hvad det handler om.",
        "Klubben er en udklækningsplads for fremtiden.",
        "U25-aftrykket er tydeligt og smukt.",
        "Talentet vokser her — som det skal.",
        "Det her vil blive husket positivt.",
      ],
      feedback_warning: [
        "Vi skubber de unge ud i for meget løb.",
        "Eller — er der overhovedet plads til U25?",
        "Talent uden tålmodighed brænder ud.",
        "Vi mister fokus på det vigtigste — ungdommen.",
        "Hvor er den lange linje?",
      ],
      feedback_negative: [
        "De unge lider — det er hjerteskærende at se.",
        "Klubben sælger sin egen fremtid.",
        "Det her hold har glemt hvor det kom fra.",
        "Talenterne flygter til steder hvor de ses.",
        "Vi forrådder en hel generation lige nu.",
      ],
      goal_proposal: [
        "Det giver de unge plads — perfekt.",
        "Bestyrelsen står 100% bag.",
        "Sådan bygger man fremtiden.",
        "Det her vil bære frugt om år.",
        "U25 vil føle sig set af det her.",
      ],
      goal_achievement: [
        "De unge tog ansvaret — og leverede.",
        "Det er belønningen for tålmodighed.",
        "Vi har skabt et miljø de blomstrer i.",
        "Klubben kan være stolt af sit udviklingsarbejde.",
        "Sådan ser en sund generation ud.",
      ],
      goal_failure: [
        "Vi gav dem ikke nok plads — beklageligt.",
        "Det her er en lærepenge for hele systemet.",
        "Vi skylder de unge en bedre struktur.",
        "Skadelig signalværdi for kommende talenter.",
        "Hvis det fortsætter, ringer akademiet ikke.",
      ],
      // #3514 S-M2a · Mandat-buckets, reference-indhold (ejer-tone-prøve 1/9).
      // Ungdomsidealisten taler i udvikling og debutanter, jf. addendummets kontrast-krav.
      receipt_positive: [
        "En debutant fik sin første sejr i dag. Det er hele pointen med det her.",
        "De unge får plads, og de bruger den.",
        "Endnu en U25'er tog et skridt i dag. Sådan bygges en generation.",
        "Det her hold fostrer talent, ikke bare bruger det op.",
      ],
      receipt_negative: [
        "De unge sidder på bænken igen. Det gør ondt at se.",
        "Vi lover udvikling og leverer stilstand.",
        "Endnu en debutant uden løb i benene denne måned.",
        "Talentet er der. Chancen er der ikke.",
      ],
      meeting_easier: [
        "Et lempet mål betyder mere tålmodighed med de unge. Det tager jeg gerne.",
        "Færre point at jagte, mere plads til at lade en debutant lære.",
        "Lempet er fint, så længe udviklingen ikke lempes med.",
        "Jeg accepterer det her, hvis det betyder flere løb til U25-truppen.",
      ],
      meeting_keep: [
        "Samme mål, samme løfte til de unge om at de bliver set.",
        "Fastholdt. De unge fortjener konsistens, ikke omskiftelighed.",
        "Ingen ændring, og det er fint. Udvikling tager den tid den tager.",
        "Vi holder kursen for ungdommens skyld.",
      ],
      meeting_stretch: [
        "Et strammere mål må ikke gå ud over debutanterne.",
        "Jeg accepterer stræk-målet, men jeg holder øje med hvem der får løb.",
        "Ambitiøst er fint, så længe de unge stadig får deres chance.",
        "Sæt målet højere. Bare glem ikke hvem der skal nå det.",
      ],
      midseason_status: [
        "Vi er midtvejs, og jeg vil vide hvor mange debutanter der har fået løb siden sidst.",
        "Halvvejs-billedet skal vise udvikling, ikke kun placeringer.",
        "Jeg måler sæsonen på hvor mange unge der er rykket frem, ikke kun på podier.",
        "Midtvejs, og de unge har stadig min fulde opmærksomhed.",
      ],
      milestone_achieved: [
        "Milepælen er nået, og en debutant var med til at gøre det. Sådan skal det se ud.",
        "Nået, og bestyrelsen finder allerede det næste mål til de unge at vokse mod.",
        "Det her beviser at udviklingssporet virker.",
        "En fremtid der var lovet, er nu en fremtid der er leveret.",
      ],
      milestone_missed: [
        "Milepælen glipper, og jeg spørger mig selv om de unge fik nok tid.",
        "Ikke enden på verden, men udviklingen skal fremskyndes.",
        "Vi skylder de unge en bedre plan herfra.",
        "Jeg noterer det. Næste årsmøde skal give dem en reel chance igen.",
      ],
      extraordinary_meeting: [
        "Bestyrelsen indkalder ekstraordinært. Jeg vil have de unges vilkår på dagsordenen.",
        "Det her møde kan ikke vente, og hverken kan udviklingsarbejdet.",
        "Jeg bad om at samles nu. Talentet må ikke lide mens vi venter.",
        "Ekstraordinært møde, fordi noget her rammer de unge direkte.",
      ],
      chairman_departure: [
        "Jeg forlader formandsposten. Pas godt på akademiet efter mig.",
        "Min tid slutter her, men de unge jeg fik plads til, bliver ved med at vokse.",
        "Jeg takker af med god samvittighed. Ungdommen fik sin chance under mig.",
        "Formandsposten går videre. Glem ikke hvem der bygger fremtiden.",
      ],
      chairman_arrival: [
        "Jeg overtager formandsposten, og de unge får min fulde opmærksomhed fra dag ét.",
        "Ny formand, samme tro på at fremtiden starter i U25-truppen.",
        "Jeg går ind i det her for de unges skyld, ikke for min egen.",
        "Det er min tur nu. Jeg lover plads til dem der endnu ikke har fået deres chance.",
      ],
    },
  },

  nationalist_purist: {
    key: "nationalist_purist",
    label: "Nationalist-purist",
    emoji: "🏳️",
    short_description: "Klubben skal repræsentere sit hjemland",
    long_description: "Eks-landstræner. Mener at en klub uden national kerne er en sponsor med trøjer. Vil hellere have ét hjemligt talent end to udenlandske stjerner.",
    personality_axes: { sports_ambition: "medium", financial_risk: "cautious", identity_strength: "high" },
    policy_axes: {
      results_pressure: "medium",
      financial_caution: "medium",
      debt_aversion: "medium",
      youth_focus: "medium",
      national_identity: "high",
      classics_focus: "low",
      gc_focus: "low",
      sponsor_growth_demand: "low",
    },
    category_alignment: { identity: 1.0, ranking: 0.5, results: 0.5, economy: 0.4 },
    reactions: {
      feedback_positive: [
        "Den hjemlige kerne lyser stadig.",
        "Vi er klubben fra vores land — uden tvivl.",
        "Hjemmebane-stoltheden er intakt.",
        "Vores fans hører deres eget sprog i pelotonen.",
        "Det her er sådan en klub skal lyde.",
      ],
      feedback_warning: [
        "Vores nationale ID er på vej væk.",
        "Færre hjemlige ryttere — det betyder noget.",
        "Vi taber forbindelsen til fanbasen.",
        "Hjem og klub bør hænge tæt sammen.",
        "Hvor er den næste lokale stjerne henne?",
      ],
      feedback_negative: [
        "Klubben er blevet en lufthavn af sponsorer.",
        "Den nationale forbindelse er brudt.",
        "Fansene kan ikke længere se sig selv i holdet.",
        "Det her er en kommerciel transaktion — ikke en klub.",
        "Vi skammer os over rosterets sammensætning.",
      ],
      goal_proposal: [
        "Hjemlige farver — selvfølgelig.",
        "Det her bekræfter klubbens rødder.",
        "Bestyrelsen står stærkt bag det her.",
        "Sådan forbliver klubben sig selv.",
        "Det er hvad den oprindelige sponsor ville have valgt.",
      ],
      goal_achievement: [
        "Den hjemlige kerne leverede — fantastisk.",
        "Det her vil resonere i hele landet.",
        "Sådan bliver man en nationalskat.",
        "Hver hjemlig sejr er dobbelt så meget værd.",
        "Det her gør klubben uerstattelig.",
      ],
      goal_failure: [
        "Hjemlandets blik tynger nu.",
        "Det her sårer klubben på dens kerne.",
        "Vi har skuffet flere end bestyrelsen.",
        "Det her gør rekrutteringen sværere.",
        "Vi taber jord vi ikke kan vinde tilbage let.",
      ],
      // #3514 S-M2a · Mandat-buckets, ejer-godkendt 1/9 (tone-prøve-udvidelse).
      // Nationalist-puristen taler i eget lands ryttere og flaget på trøjen.
      receipt_positive: [
        "Vores egne ryttere bar flaget i dag, og fansene hørte deres eget sprog i feltet.",
        "Det her er et hjemligt resultat, og det betyder mere end pointene.",
        "Den nationale kerne leverede, præcis som en klub som vores bør.",
        "Vores flag var i front i dag. Det er værd mere end marginen.",
      ],
      receipt_negative: [
        "Færre hjemlige ryttere på resultatlisten, og færre fans genkender sig selv i holdet.",
        "Vi bliver en klub af importerede navne, og hjemmepublikummet lægger mærke til det.",
        "Den nationale kerne udtyndes, og det er en langsommere katastrofe end noget nederlag.",
        "Vores eget flag driver mod bagenden af feltet.",
      ],
      meeting_easier: [
        "Et lavere mål for den nationale kerne, så længe kernen selv ikke skrumper.",
        "Lempet, men jeg vil have de hjemlige ryttere stadig på startlisten, ikke bare tallet.",
        "Fint, så længe det er tålmodighed med vores egne, ikke en stille tilbagetrækning fra dem.",
        "Jeg accepterer det, hvis det giver det hjemlige talent mere tid til at vokse ind i rollen.",
      ],
      meeting_keep: [
        "Samme mål. Vores nationale identitet forhandles ikke om på et indfald.",
        "Fastholdt, og hjemmepublikummet fortjener den konsistens.",
        "Ingen ændring. Flaget på trøjen forbliver præcis lige så vigtigt som før.",
        "Fint som det står. Klubbens kerne var aldrig til rabat.",
      ],
      meeting_stretch: [
        "Et højere mål for den nationale kerne, og jeg holder alle fast på det.",
        "Stræk det. Det er på tide klubben læner sig hårdere ind i hvem vi er.",
        "Jeg accepterer det, så længe det betyder flere hjemlige navne, ikke bare et større tal.",
        "Ambitiøst, og hjemmepublikummet vil endelig se sig selv oftere.",
      ],
      midseason_status: [
        "Halvvejs, og jeg vil vide hvor mange hjemlige ryttere der faktisk har kørt løb.",
        "Den her status betyder lidt for mig uden en optælling af vores eget flag på startlisterne.",
        "Jeg måler sæsonen på hvor meget af det her hold der stadig føles hjemligt.",
        "Halvvejs, og den nationale kerne holder, hvilket er det tal der betyder noget for mig.",
      ],
      milestone_achieved: [
        "Milepælen er nået, og en hjemlig rytter var i front da det skete.",
        "Nået, og hele landet kan gøre krav på den her.",
        "Det her er den slags milepæl der gør hjemmepublikummet stolt af at bære farverne.",
        "Vores eget flag leverede da det gjaldt. Det bliver husket.",
      ],
      milestone_missed: [
        "Milepælen glipper, og jeg spørger om de hjemlige ryttere fik chancen til at bære den.",
        "Ikke katastrofalt, men den nationale kerne fortjente bedre placering her.",
        "Vi skylder hjemmepublikummet en klarere vej til den her milepæl næste gang.",
        "Jeg noterer det. Flaget kommer tilbage i front til næste årsmøde.",
      ],
      extraordinary_meeting: [
        "Bestyrelsen indkalder ekstraordinært, og jeg vil have den nationale kernes stilling på dagsordenen.",
        "Det her kan ikke vente, og det kan en svindende forbindelse til hjemmepublikummet heller ikke.",
        "Jeg bad om at samles nu. Vores identitet er ikke noget vi lader drive mens vi venter.",
        "Ekstraordinært møde, fordi noget her rører ved det klubben skal repræsentere.",
      ],
      chairman_departure: [
        "Jeg forlader formandsposten. Flaget flyver stadig i front, og det var altid missionen.",
        "Min tid slutter her, men den hjemlige kerne jeg beskyttede bliver ved med at bære klubben.",
        "Jeg takker af med den nationale identitet intakt. Det er min arv her.",
        "Formandsposten går videre. Lad ikke den hjemlige kerne blive en eftertanke efter mig.",
      ],
      chairman_arrival: [
        "Jeg overtager formandsposten, og det første jeg gør er at tælle hvor mange hjemlige ryttere der er på truppen.",
        "Ny formand, samme tro på at en klub uden national kerne bare er en sponsor med trøjer.",
        "Jeg går ind i det her for hjemmepublikummet, dem der genkender sig selv i holdet.",
        "Det er min tur nu. Jeg lover at flaget forbliver i front af enhver samtale.",
      ],
    },
  },

  klassiker_purist: {
    key: "klassiker_purist",
    label: "Klassiker-purist",
    emoji: "🪨",
    short_description: "Monumenter er hvad der gør en klub udødelig",
    long_description: "Tidligere klassiker-rytter selv. Mener at GC-runder er statistik — Roubaix er historie. Vil hellere have ét monument end fem etapesejre.",
    personality_axes: { sports_ambition: "high", financial_risk: "balanced", identity_strength: "high" },
    policy_axes: {
      results_pressure: "high",
      financial_caution: "medium",
      debt_aversion: "medium",
      youth_focus: "low",
      national_identity: "medium",
      classics_focus: "high",
      gc_focus: "low",
      sponsor_growth_demand: "medium",
    },
    category_alignment: { results: 0.9, identity: 0.8, ranking: 0.6, economy: 0.4 },
    reactions: {
      feedback_positive: [
        "Vi er på vej mod et monument — det kan jeg mærke.",
        "Klassiker-spirit hænger i luften.",
        "Det her er hvor klubben hører hjemme.",
        "Stensikre rolverne for forårs-kampagnen.",
        "Sjælden kvalitet på den vej der tæller.",
      ],
      feedback_warning: [
        "Klassiker-ambitionen er for blød.",
        "Vi mangler en hard man til Roubaix-typen.",
        "Hvor er forårsfokuset henne?",
        "Det her hold ville aldrig vinde Liège.",
        "Det er etapeløb — ikke arven.",
      ],
      feedback_negative: [
        "Vi er klassiker-løse — det her er pinligt.",
        "Forårsmånederne forsvinder uden spor.",
        "Holdet løber forbi monumenterne uden at kigge op.",
        "Det her er forkert klubidentitet for den her sport.",
        "Vi bliver ikke husket for noget af det her.",
      ],
      goal_proposal: [
        "Monumenter — endelig på dagsordenen.",
        "Det her er hvad klubben blev født til.",
        "Forår-fokus — bestyrelsen jubler.",
        "Sådan skriver man historie.",
        "Vi tager det og kører hjem med en sten.",
      ],
      goal_achievement: [
        "Monument! Det er hvor sport bliver evig.",
        "Det her står i bøgerne for evigt.",
        "Foråret er vores — som det burde være.",
        "Sten på sten — sådan bygger man en klub.",
        "Det her er den slags klubmedlemmer husker.",
      ],
      goal_failure: [
        "Forårskampagnen floppede — uacceptabelt.",
        "Monumenterne ler ad os i år.",
        "Det her river hjertet ud af klassikersjælen.",
        "Vi skal genopfinde forårsplanen.",
        "Ingen tager klubben seriøst på Roubaix-rampen efter det her.",
      ],
      // #3514 S-M2a · Mandat-buckets, ejer-godkendt 1/9 (tone-prøve-udvidelse).
      // Klassiker-puristen taler i brosten og monumenter, aldrig i etapeløb.
      receipt_positive: [
        "Det var en ordentlig brostens-præstation. Forårskampagnen lever.",
        "Vi kørte som et klassikerhold i dag, og det viste sig på stenene.",
        "Et resultat som det der hører hjemme på Roubaix-velodromen, ikke bare på resultatlisten.",
        "Sådan ser en monument-formet sæson ud i april.",
      ],
      receipt_negative: [
        "Ingen brosten, ingen forårsform, ingen historie værd at fortælle denne april.",
        "Vi så fortabte ud i det øjeblik vejen blev til sten.",
        "Et klassikerhold der undgår brostenene er ikke et klassikerhold.",
        "Monumenterne vil ikke huske en sæson som den her.",
      ],
      meeting_easier: [
        "Et lettere forårsmål, så længe vi stadig møder op til de sten der tæller.",
        "Lempet, men monumenterne er ligeglade med vores undskyldninger uanset hvad.",
        "Fint, hvis det betyder vi bygger ordentligt mod Roubaix i stedet for at tvinge det.",
        "Jeg accepterer det, så længe det ikke er klassiker-identiteten der blev sænket.",
      ],
      meeting_keep: [
        "Samme mål. Brostenene bliver ikke lettere fordi vi beder pænt.",
        "Fastholdt. Foråret genforhandler ikke sin kalender for nogen.",
        "Ingen ændring. Et klassikerhold holder sin ambition gennem mudderet.",
        "Fint som det står. Monumenterne fortjener et fast mål, ikke et der flytter sig.",
      ],
      meeting_stretch: [
        "Et hårdere forårsmål. Endelig noget brostenene er værd.",
        "Stræk det. Klubben skal have ondt i maven ved at sigte på mindre end et monument.",
        "Jeg accepterer det, med glæde. Klassikerne fortjener ægte ambition, ikke en beskeden en.",
        "Ambitiøst, og forårskampagnen fik lige det pres den havde brug for.",
      ],
      midseason_status: [
        "Halvvejs, og jeg bedømmer stadig sæsonen på hvad der skete i april.",
        "Statusrapporten betyder mindre for mig end om vi havde et ægte forår.",
        "Klubben lever eller dør på brostenene, og resten af sæsonen er bare efterspil.",
        "Halvvejs, og monumenterne fortalte os allerede det meste af det vi behøver at vide.",
      ],
      milestone_achieved: [
        "Milepælen er nået, og det skete på de veje der betyder noget for klubben.",
        "Nået, med brosten under hjulene. Sådan skal det gøres.",
        "Det her er den slags milepæl klassiker-historiebøgerne faktisk vil nævne.",
        "Et monument-værdigt resultat. Det er hvad klubben findes for.",
      ],
      milestone_missed: [
        "Milepælen glipper, og et forår uden et ægte resultat gør mere ondt end nogen anden sæson.",
        "Ikke katastrofalt, men den brostensbelagte kampagne skyldte os mere end det her.",
        "Vi skylder klassiker-identiteten et skarpere forår næste år.",
        "Jeg noterer det. Næste forsøg begynder opbygningen mod april med det samme.",
      ],
      extraordinary_meeting: [
        "Bestyrelsen indkalder til et ekstraordinært møde. Foråret venter ikke på den sædvanlige kalender.",
        "Det her er ikke rutine, men det er at miste vores chance ved monumenterne heller ikke.",
        "Jeg bad om at samles nu. En brostensbelagt kampagne bygget i hast vinder aldrig noget.",
        "Ekstraordinært møde, fordi april er tættere på end bestyrelsen synes at tro.",
      ],
      chairman_departure: [
        "Jeg forlader formandsposten. Vi jagtede monumenterne ærligt, og det var hele pointen.",
        "Min tid slutter her, men klassiker-ånden jeg kæmpede for bør ikke forlade med mig.",
        "Jeg takker af efter aldrig at have ladet klubben glemme brostenene.",
        "Formandsposten går videre. Den næste må hellere stadig tro på april.",
      ],
      chairman_arrival: [
        "Jeg overtager formandsposten, og det første jeg gør er at tjekke forårskalenderen.",
        "Ny formand, samme tro på at Roubaix betyder mere end noget etapeløbs-podie.",
        "Jeg går ind i det her for brostenene, dem der fik mig til at elske sporten.",
        "Det er min tur nu. Jeg lover klubben ikke glemmer hvad april er til for.",
      ],
    },
  },

  gc_elsker: {
    key: "gc_elsker",
    label: "GC-elsker",
    emoji: "⛰️",
    short_description: "Tre uger eller intet — Tour er alt",
    long_description: "Eks-GC-direktør. Bestyrelsens største drømmer. Vil bygge holdet op til at vinde en Grand Tour. Forstår ikke hvorfor andre overhovedet kører cykelløb.",
    personality_axes: { sports_ambition: "high", financial_risk: "aggressive", identity_strength: "medium" },
    policy_axes: {
      results_pressure: "high",
      financial_caution: "low",
      debt_aversion: "low",
      youth_focus: "low",
      national_identity: "low",
      classics_focus: "low",
      gc_focus: "high",
      sponsor_growth_demand: "medium",
    },
    category_alignment: { results: 1.0, ranking: 0.8, identity: 0.4, economy: 0.3 },
    reactions: {
      feedback_positive: [
        "GC-banen er sat — vi bygger mod Tour.",
        "Det her er en ægte runde-rytter-konstruktion.",
        "Bjergene venter på os.",
        "Tre-ugers-formen begynder at lyse.",
        "Vi har et hold der kan vinde stort.",
      ],
      feedback_warning: [
        "GC-strukturen halter for blødt.",
        "Hvor er domestikkerne til klatrebjergene?",
        "Vi mangler den tredje uges robusthed.",
        "Det her hold knækker i Pyrenæerne.",
        "Tour-drømmen er på pause.",
      ],
      feedback_negative: [
        "Vi har ikke en GC-mand på holdet — uacceptabelt.",
        "Det her hold ville miste 20 minutter på dag 1.",
        "Tour er længere væk end nogensinde.",
        "Bestyrelsen fik ikke det vi blev lovet.",
        "Det her er ikke et seriøst World Tour-projekt.",
      ],
      goal_proposal: [
        "GC-fokus — endelig på vej mod stort spil.",
        "Det her er hvor karrieren bygges.",
        "Tour er målet, og det her er trinnet.",
        "Bestyrelsen tager imod uden tøven.",
        "Sådan rejser man et kaptajn-projekt.",
      ],
      goal_achievement: [
        "GC-resultatet er solidt — fortsæt opad.",
        "Det her er hvad Tour-veje er bygget på.",
        "Bjergene gav respekt — godt arbejde.",
        "Vi er på vej mod kapitlet alle vil læse.",
        "Det her er trinnet før de tre uger.",
      ],
      goal_failure: [
        "GC-projektet bløder — det her hjælper ikke.",
        "Vi er længere fra Tour nu end før sæsonen.",
        "Det her er en tilbagegang — ikke en justering.",
        "Bjergene knuste os — det skal aldrig ske igen.",
        "Vi mangler en plan for hvor stjernen skal komme fra.",
      ],
      // #3514 S-M2a · Mandat-buckets, ejer-godkendt 1/9 (tone-prøve-udvidelse).
      // GC-elskeren taler i etapeløb, klassement og de tre uger, aldrig i endagsløb.
      receipt_positive: [
        "Den bakke var Tour-form. Vi bygger noget rigtigt til juli.",
        "GC-billedet ser bedre ud hver uge. Sådan bygger man et etapeløbsprojekt.",
        "En præstation som den der hører hjemme i bjergene på et grand tour, ikke i et endagsløb.",
        "Vi kører endelig som et hold med en treugers-ambition.",
      ],
      receipt_negative: [
        "Ingen GC-tilstedeværelse, ingen bjergben, intet Tour-projekt værd navnet.",
        "Vi faldt fra hinanden i det øjeblik vejen gik opad i mere end én etape.",
        "Et hold uden en reel GC-trussel bygger ikke mod noget jeg interesserer mig for.",
        "Touren er længere væk denne uge end den var sidste måned.",
      ],
      meeting_easier: [
        "Et lettere GC-mål, så længe vi stadig kører de tre uger som om de betyder noget.",
        "Lempet, men jeg vil have bjergbenene bygget uanset tallet.",
        "Fint, hvis det giver klatrerne tid før vi beder dem om et grand tour.",
        "Jeg accepterer det, så længe Touren stadig er den horisont vi kører mod.",
      ],
      meeting_keep: [
        "Samme mål. Bjergene er ligeglade med om vi har lyst denne uge.",
        "Fastholdt. Et treugers-projekt genforhandler ikke sin egen tidslinje.",
        "Ingen ændring. Touren er ikke rykket tilbage fordi vi bad om rabat.",
        "Fint som det står. GC-ambitionen skal ikke være det første vi skærer i.",
      ],
      meeting_stretch: [
        "Et højere GC-mål. Endelig noget med en Tour-stor ambition.",
        "Stræk det. Klubben skal altid sigte mod tre uger, ikke én dag.",
        "Jeg accepterer det med glæde. Bjergene fortjener ægte ambition bag sig.",
        "Ambitiøst, og det er den eneste indstilling det her projekt bør køre i.",
      ],
      midseason_status: [
        "Halvvejs, og jeg bedømmer sæsonen på hvor GC-projektet står, ikke på sprinterne.",
        "Statusrapporten betyder mindre end om vi har en reel kaptajn til juli.",
        "Klubben findes for tre uger om sommeren. Alt andet er forberedelse.",
        "Halvvejs, og bjergbenene er på vej, hvilket er det eneste tal jeg følger.",
      ],
      milestone_achieved: [
        "Milepælen er nået, og den skete med reel GC-tyngde bag sig.",
        "Nået, på den slags bakke der afgør et grand tour.",
        "Det her er den slags resultat der siger Tour-projektet er ægte, ikke en drøm.",
        "Et resultat treugers-turen er værd. Det er det klubben er bygget til at jagte.",
      ],
      milestone_missed: [
        "Milepælen glipper, og et grand tour-projekt uden den mister en hel sæsons momentum.",
        "Ikke katastrofalt, men bjergene skyldte os mere end det her.",
        "Vi skylder GC-projektet en skarpere opbygning mod næste års tre uger.",
        "Jeg noterer det. Vejen mod Touren bliver genopbygget fra i dag.",
      ],
      extraordinary_meeting: [
        "Bestyrelsen indkalder til et ekstraordinært møde. Et Tour-projekt venter ikke på den sædvanlige kalender.",
        "Det her er ikke rutine, men det er at miste vores chance for tre uger i juli heller ikke.",
        "Jeg bad om at samles nu. Bjergben bygges ikke i hast i sidste øjeblik.",
        "Ekstraordinært møde, fordi Touren er tættere på end bestyrelsen synes at tro.",
      ],
      chairman_departure: [
        "Jeg forlader formandsposten. Vi byggede mod bjergene ærligt, og det var hele pointen.",
        "Min tid slutter her, men Tour-ambitionen jeg kæmpede for bør ikke forlade med mig.",
        "Jeg takker af efter aldrig at have ladet klubben glemme hvad tre uger betyder.",
        "Formandsposten går videre. Den næste må hellere stadig drømme om juli.",
      ],
      chairman_arrival: [
        "Jeg overtager formandsposten, og det første jeg gør er at tjekke hvem der kan overleve tre uger i bjergene.",
        "Ny formand, samme tro på at intet i den her sport betyder mere end Touren.",
        "Jeg går ind i det her for juli, den eneste måned der virkelig tæller.",
        "Det er min tur nu. Jeg lover klubben ikke glemmer hvad tre uger betyder.",
      ],
    },
  },
};

// Reaktions-bucket-typer — bruges af sampleReactionForFeedback til at vælge tone.
export const REACTION_BUCKETS = [
  "feedback_positive",
  "feedback_warning",
  "feedback_negative",
  "goal_proposal",
  "goal_achievement",
  "goal_failure",
];

// #3514 S-M2a · Mandat-beat-buckets (addendum "Stemme-kontrakten" punkt 4).
// receipt_* = kvitterings-feedets rækker i mål-ejerens stemme; meeting_* =
// modtilbuds-reaktion fra målets ejer ved årsmødet (Easier/Keep/Stretch);
// resten er formands-beats (midtvejs, milepæle, ekstraordinært møde,
// formandsskifte). Ejer-godkendte tone-prøver 1/9: sponsoraten (tal/risiko)
// og ungdomsidealisten (udvikling/debutanter) blev skrevet først som
// reference; alle 9 arketyper har nu min. 4 varianter pr. bucket, hver med
// sin egen, ikke-forvekslelige stemme (se kommentaren over hver arketypes
// nye buckets). boardVoice.js::sampleVoiceLine() KASTER stadig hvis en
// bucket nogensinde er tom (fx en fremtidig 12. bucket der endnu ikke er
// udfyldt for alle arketyper), aldrig en stille fallback til forkert stemme.
export const MANDATE_VOICE_BUCKETS = [
  "receipt_positive",
  "receipt_negative",
  "meeting_easier",
  "meeting_keep",
  "meeting_stretch",
  "midseason_status",
  "milestone_achieved",
  "milestone_missed",
  "extraordinary_meeting",
  "chairman_departure",
  "chairman_arrival",
];

// Helper: detect conflict mellem to arketyper (kun friction-akser).
// Konflikt = high vs. low på samme akse.
export function archetypesConflict(archetypeA, archetypeB) {
  if (!archetypeA?.policy_axes || !archetypeB?.policy_axes) return false;
  for (const axis of FRICTION_AXES) {
    const a = archetypeA.policy_axes[axis];
    const b = archetypeB.policy_axes[axis];
    if ((a === "high" && b === "low") || (a === "low" && b === "high")) {
      return true;
    }
  }
  return false;
}

// Helper: alignment-score mellem arketype og identity_basis.
// Bruges til top-3 identity-matched + chairman-valg (højeste score).
export function computeArchetypeAlignmentScore(archetype, identityBasis) {
  if (!archetype?.policy_axes || !identityBasis) return 0;
  const axes = archetype.policy_axes;
  let score = 0;

  // Youth-level matching
  if (identityBasis.youth_level === "high") {
    if (axes.youth_focus === "high") score += 4;
    else if (axes.youth_focus === "low") score -= 2;
  } else if (identityBasis.youth_level === "medium") {
    if (axes.youth_focus === "medium") score += 1;
  } else if (identityBasis.youth_level === "low") {
    if (axes.youth_focus === "low") score += 1;
    else if (axes.youth_focus === "high") score -= 1;
  }

  // National core
  if (identityBasis.national_core?.established) {
    const strength = identityBasis.national_core.strength || "low";
    if (axes.national_identity === "high") {
      score += strength === "high" ? 4 : strength === "medium" ? 3 : 2;
    } else if (axes.national_identity === "low") {
      score -= 1;
    }
  }

  // Specialization
  if (identityBasis.primary_specialization === "gc" && axes.gc_focus === "high") score += 4;
  if (identityBasis.primary_specialization === "classics" && axes.classics_focus === "high") score += 4;
  if (identityBasis.primary_specialization === "sprint" && axes.sponsor_growth_demand === "high") score += 2;
  if (identityBasis.primary_specialization === "youth" && axes.youth_focus === "high") score += 3;

  // Star profile → results-pressure
  const starLevel = identityBasis.star_profile?.level;
  if (starLevel === "elite" || starLevel === "high") {
    if (axes.results_pressure === "high") score += 2;
    if (axes.sponsor_growth_demand === "high") score += 2;
  }

  return score;
}

// Helper: returnér arketype-objekt for en key.
export function getArchetypeByKey(key) {
  return BOARD_ARCHETYPES[key] || null;
}
