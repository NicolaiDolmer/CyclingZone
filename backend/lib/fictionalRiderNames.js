// Navne-pools til fiktiv-rytter-generator (#669).
//
// "Hybrid"-model (ejer-beslutning 2026-05-31): kuraterede pools grupperet i
// region/sprog-clusters. Strukturen tillader senere at hænge et eksternt
// navne-bibliotek på de store clusters uden at ændre generatoren — for V1 er
// indlejrede pools nok OG giver fuld determinisme (ingen ekstern RNG/locale-data).
//
// Navnene er bevidst almindelige og generiske. Exact-sammenfald med en ægte
// rytter i vores DB fanges alligevel af unikheds-checket i generatoren
// (foldNameNordic mod alle eksisterende navne) og re-samples.

// ── Clusters: firstnames + lastnames per region/sprogtradition ────────────────
export const NAME_CLUSTERS = {
  french: {
    first: ["Lucas", "Hugo", "Théo", "Nathan", "Maxime", "Antoine", "Julien", "Florian", "Romain", "Clément", "Quentin", "Bastien", "Damien", "Loïc", "Mathis", "Corentin", "Adrien", "Valentin"],
    last: ["Bernard", "Moreau", "Lefèvre", "Girard", "Rousseau", "Vidal", "Faure", "Mercier", "Blanc", "Guerin", "Chevalier", "Lemaire", "Renaud", "Marchand", "Dumas", "Brunet", "Gauthier", "Perrin", "Roussel", "Hervé", "Colin", "Vasseur", "Pichon", "Charpentier", "Delcroix", "Aubert", "Maillot", "Sauvage"],
  },
  italian: {
    first: ["Marco", "Luca", "Matteo", "Davide", "Andrea", "Simone", "Federico", "Lorenzo", "Alessandro", "Giacomo", "Stefano", "Nicolò", "Riccardo", "Tommaso", "Filippo", "Gabriele", "Cristian", "Manuel"],
    last: ["Conti", "Ferrari", "Riva", "Galli", "Costa", "Greco", "Bruno", "Marini", "Longo", "Serra", "Vitali", "Caruso", "Fontana", "Moretti", "Barbieri", "Sartori", "Pellegrini", "Rizzo", "Donati", "Ferrara", "Bianchi", "Gentile", "Valli", "Orlando", "Palmieri", "Sorrentino", "Brivio", "Tonti"],
  },
  dutchFlemish: {
    first: ["Daan", "Sven", "Bram", "Lars", "Niels", "Thijs", "Wout", "Jasper", "Ruben", "Tijl", "Sander", "Koen", "Maarten", "Joris", "Pieter", "Stijn", "Bart", "Wessel"],
    last: ["De Vries", "Janssen", "Vermeulen", "De Jong", "Bakker", "Visser", "Smit", "Maes", "Peeters", "Claes", "Wouters", "Hendrickx", "Aerts", "Verhoeven", "Dekker", "Mertens", "Coppens", "Van Dijk", "Van Loon", "Vandeput", "Goossens", "Lenaerts", "Cornelis", "Segers", "Brughmans", "Van Hecke", "Roelofs", "Tielemans"],
  },
  spanish: {
    first: ["Carlos", "Javier", "Diego", "Pablo", "Sergio", "Alejandro", "Daniel", "Adrián", "Iván", "Rubén", "Óscar", "Marcos", "Andrés", "Raúl", "Gonzalo", "Hugo", "Mario", "Aitor"],
    last: ["García", "Martínez", "López", "Sánchez", "Romero", "Torres", "Ramírez", "Vargas", "Castro", "Ortega", "Rubio", "Molina", "Delgado", "Cabrera", "Reyes", "Aguilar", "Mendoza", "Herrera", "Iglesias", "Campos", "Vega", "Fuentes", "Carmona", "Pardo", "Quintero", "Bravo", "Sierra", "Lozano"],
  },
  german: {
    first: ["Lukas", "Jonas", "Felix", "Max", "Tim", "Niklas", "Jan", "Leon", "Moritz", "Florian", "Tobias", "Philipp", "Sebastian", "Fabian", "Lennard", "Marvin", "Julian", "Kilian"],
    last: ["Müller", "Schmidt", "Fischer", "Weber", "Wagner", "Becker", "Hoffmann", "Schäfer", "Koch", "Richter", "Klein", "Wolf", "Schröder", "Neumann", "Schwarz", "Zimmermann", "Braun", "Krüger", "Hofmann", "Lange", "Werner", "Krause", "Lehmann", "Brandt", "Engel", "Vogt", "Sommer", "Frank"],
  },
  nordic: {
    first: ["Emil", "Magnus", "Oliver", "William", "Noah", "Frederik", "Mathias", "Kasper", "Sander", "Henrik", "Jakob", "Anders", "Mads", "Viktor", "Erik", "Sebastian", "Johan", "Tobias"],
    last: ["Hansen", "Nielsen", "Larsen", "Andersen", "Pedersen", "Kristiansen", "Olsen", "Berg", "Lund", "Dahl", "Holm", "Moen", "Haugen", "Lie", "Strand", "Sørensen", "Bakke", "Nyström", "Lindqvist", "Sandberg", "Eriksson", "Holmberg", "Aas", "Vik", "Solberg", "Bergström", "Lindholm", "Mathisen"],
  },
  anglo: {
    first: ["Jack", "Harry", "Oliver", "George", "James", "Thomas", "Ethan", "Mason", "Cooper", "Liam", "Ryan", "Connor", "Lachlan", "Cody", "Dylan", "Blake", "Owen", "Toby"],
    last: ["Smith", "Brown", "Taylor", "Wilson", "Walker", "Hughes", "Turner", "Carter", "Mitchell", "Cooper", "Bennett", "Ward", "Foster", "Reid", "Murphy", "Kelly", "Hayes", "Fletcher", "Pearce", "Dawson", "Crawford", "Holland", "Newton", "Whitfield", "Ramsay", "Sinclair", "Doyle", "Marsh"],
  },
  portuguese: {
    first: ["João", "Tiago", "Rui", "Miguel", "André", "Bruno", "Diogo", "Ricardo", "Nuno", "Gonçalo", "Henrique", "Rafael", "Vasco", "Duarte", "Fábio", "Hélder", "Tomás", "Gustavo"],
    last: ["Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues", "Martins", "Sousa", "Fernandes", "Gonçalves", "Lopes", "Marques", "Almeida", "Ribeiro", "Pinto", "Carvalho", "Teixeira", "Moreira", "Correia", "Nogueira", "Azevedo", "Cardoso", "Coelho", "Macedo", "Branco", "Tavares", "Antunes"],
  },
  slavic: {
    first: ["Jakub", "Tomáš", "Marek", "Filip", "Ondřej", "Michał", "Piotr", "Kamil", "Bartosz", "Matej", "Luka", "Jan", "Adam", "Patryk", "Vojtěch", "Dawid", "Rok", "Žan"],
    last: ["Novák", "Kovač", "Horák", "Kowalski", "Nowak", "Wójcik", "Kaminski", "Zieliński", "Marek", "Polák", "Kučera", "Pospíšil", "Krajnc", "Zupan", "Hribar", "Wiśniewski", "Lewandowski", "Dvořák", "Černý", "Procházka", "Mazur", "Sokol", "Jelen", "Vrba", "Kozłowski", "Adamczyk", "Brož", "Sedlák"],
  },
  japanese: {
    first: ["Haruto", "Yuto", "Sota", "Ren", "Riku", "Kaito", "Sho", "Daiki", "Kenta", "Yuki", "Takumi", "Ryo", "Hiroto", "Kosei", "Naoki", "Shun", "Taiga", "Yamato"],
    last: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato", "Yoshida", "Yamada", "Sasaki", "Matsumoto", "Inoue", "Kimura", "Hayashi", "Shimizu", "Mori", "Abe", "Ikeda", "Hashimoto", "Ishikawa", "Ogawa", "Maeda", "Fujita", "Okada", "Goto"],
  },
  korean: {
    first: ["Minjun", "Seojun", "Doyun", "Jiho", "Hyun", "Junseo", "Jihoon", "Sungmin", "Woojin", "Hajun", "Eunwoo", "Taeyang", "Yeonjun", "Daehyun", "Seungho", "Jinwoo", "Hoyeon", "Kangmin"],
    last: ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", "Han", "Oh", "Seo", "Shin", "Kwon", "Hwang", "Ahn", "Song", "Hong", "Bae"],
  },
  chinese: {
    first: ["Wei", "Hao", "Lei", "Jun", "Bo", "Tao", "Peng", "Yang", "Chen", "Kai", "Ming", "Feng", "Jie", "Long", "Bin", "Cheng", "Hui", "Qiang"],
    last: ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou", "Xu", "Sun", "Ma", "Zhu", "Hu", "Guo", "He", "Gao", "Lin", "Luo", "Zheng", "Liang", "Xie", "Tang", "Han", "Feng", "Deng", "Cao"],
  },
  maghreb: {
    first: ["Youssef", "Karim", "Mehdi", "Amine", "Bilal", "Hamza", "Walid", "Anis", "Reda", "Sofiane", "Nabil", "Ayoub", "Ismail", "Tarek", "Yassine", "Adel", "Riad", "Zakaria"],
    last: ["Benali", "Haddad", "Mansouri", "Cherif", "Boukhari", "Saidi", "Ziani", "Bouazza", "Belkacem", "Khelifi", "Hamdi", "Toumi", "Brahimi", "Saadi", "Lahlou", "Bennani", "Ouedraogo", "Meziane", "Ferhat", "Guerrouj", "Slimani", "Bakkali", "Naceri", "Tahar"],
  },
  eastAfrican: {
    first: ["Daniel", "Samuel", "Robel", "Henok", "Amanuel", "Yonas", "Biniam", "Natnael", "Merhawi", "Mekseb", "Joseph", "Eric", "Moise", "Didier", "Bonaventure", "Patrick", "Emmanuel", "Aron"],
    last: ["Tesfay", "Habtom", "Ghebremedhin", "Berhane", "Tekle", "Kidane", "Goitom", "Mulueta", "Hagos", "Weldu", "Niyonshuti", "Nsengimana", "Hakizimana", "Manizabayo", "Munyaneza", "Bizimana", "Uwizeyimana", "Habineza", "Mugisha", "Ndayisenga", "Tadesse", "Girmay", "Solomon", "Yohannes"],
  },
  generic: {
    first: ["Alex", "Daniel", "David", "Adam", "Mark", "Leo", "Max", "Sam", "Eric", "Paul", "Ivan", "Omar", "Nikola", "Stefan", "Andrei", "Marco", "Luca", "Kevin"],
    last: ["Petrov", "Kovacs", "Popov", "Nagy", "Stojan", "Ivanov", "Horvat", "Antic", "Marin", "Dimitrov", "Georgiev", "Toth", "Varga", "Kraus", "Babic", "Pavlov", "Ramos", "Costa", "Khan", "Ali", "Reyes", "Soto", "Vega", "Cruz", "Mejia", "Castro", "Lima", "Rios"],
  },
};

// ── ISO2-nationalitet → cluster ───────────────────────────────────────────────
// Dækker alle nationaliteter observeret i prod-riders (2026-05-31) + REGION_TO_ISO.
// Ukendte koder falder til "generic" og rapporteres af generatoren (no silent caps).
export const ISO_TO_CLUSTER = {
  FR: "french", MC: "french",
  IT: "italian", SM: "italian",
  NL: "dutchFlemish", BE: "dutchFlemish",
  ES: "spanish", CO: "spanish", AR: "spanish", MX: "spanish", VE: "spanish",
  EC: "spanish", CL: "spanish", CR: "spanish", GT: "spanish", PE: "spanish",
  UY: "spanish", BO: "spanish", PY: "spanish", DO: "spanish", CU: "spanish",
  PA: "spanish", HN: "spanish",
  DE: "german", AT: "german", CH: "german", LI: "german", LU: "german",
  DK: "nordic", NO: "nordic", SE: "nordic", FI: "nordic", IS: "nordic",
  GB: "anglo", IE: "anglo", AU: "anglo", NZ: "anglo", US: "anglo",
  ZA: "anglo", CA: "anglo", BM: "anglo", BS: "anglo", JM: "anglo", TT: "anglo",
  PT: "portuguese", BR: "portuguese", AO: "portuguese",
  PL: "slavic", CZ: "slavic", SK: "slavic", SI: "slavic", RU: "slavic",
  UA: "slavic", BY: "slavic", HR: "slavic", RS: "slavic", BG: "slavic",
  RO: "slavic", HU: "slavic", EE: "slavic", LV: "slavic", LT: "slavic",
  BA: "slavic", MK: "slavic", ME: "slavic", XK: "slavic", MD: "slavic", GE: "slavic",
  JP: "japanese",
  KR: "korean",
  CN: "chinese", HK: "chinese", TW: "chinese", SG: "chinese",
  DZ: "maghreb", MA: "maghreb", TN: "maghreb", EG: "maghreb", LY: "maghreb",
  SA: "maghreb", AE: "maghreb", QA: "maghreb", KW: "maghreb", BH: "maghreb",
  OM: "maghreb", IR: "maghreb", IQ: "maghreb", SY: "maghreb", IL: "maghreb",
  ER: "eastAfrican", RW: "eastAfrican", ET: "eastAfrican", KE: "eastAfrican",
  UG: "eastAfrican", ZW: "eastAfrican", NA: "eastAfrican", NG: "eastAfrican",
  GH: "eastAfrican", CM: "eastAfrican", BF: "eastAfrican", CI: "eastAfrican",
  SN: "eastAfrican", ML: "eastAfrican", BJ: "eastAfrican", CD: "eastAfrican",
};

export function clusterForNationality(iso2) {
  return ISO_TO_CLUSTER[iso2] || "generic";
}
