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
