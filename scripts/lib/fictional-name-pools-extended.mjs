// Udvidede navne-pools til PCM-rename-generatoren (#669, fuld udskiftning af
// 8.699 PCM-navne). Bygger OVENPÅ backend/lib/fictionalRiderNames.js (ejer-
// godkendt hybrid-model 2026-05-31) uden at ændre den — basen deles med
// launch-population-generatoren (#1135), så dens deterministiske output må
// ikke skifte.
//
// Hvorfor udvidelse er nødvendig (mod xlsx-fordelingen, 8.699 ryttere):
//   • Base-pools er dimensioneret til ~800 ryttere (18×28 ≈ 504 kombinationer
//     pr. cluster). Fuld rename belaster fx spanish-clusteret med ~1.400
//     ryttere og anglo med ~1.050 — basen kan ikke levere unikke navne.
//   • ~858 ryttere (TR, PH, ID, TH, KZ, GR, VN, …) falder i basen til en
//     kulturelt forkert "generic"-pool. De får dedikerede clusters her.
//
// Principper (samme som basen):
//   • Almindelige, generiske navne — ALDRIG ikoniske pro-rytter-efternavne
//     (Vingegaard, Pogačar, Evenepoel, …). Meget almindelige civile efternavne
//     som også bæres af proffer (García, Pedersen, …) er OK: generatorens
//     fulde-navne-kollisionscheck (foldNameNordic mod hele DB-korpus)
//     re-sampler ethvert eksakt sammenfald.
//   • Kun mandlige fornavne (spillet har intet gender-felt).
//   • Latin-skrift (matcher eksisterende player-facing navne).
//   • Kulturelle approksimationer er EKSPLICITTE og dokumenterede i
//     CLUSTER_APPROXIMATIONS (kravet fra orkestrator-tasken: "nærmeste
//     kulturelt-plausible mapping, dokumenteret").

import { NAME_CLUSTERS, ISO_TO_CLUSTER } from "../../backend/lib/fictionalRiderNames.js";

// ── Ekstra navne til eksisterende clusters (kun ADDITIONER — basen røres ikke) ─
const CLUSTER_EXTENSIONS = {
  french: {
    first: ["Étienne", "Baptiste", "Guillaume", "Thibault", "Aurélien", "Benjamin", "Cédric", "Fabien", "Gaëtan", "Jérémy", "Ludovic", "Mickaël", "Olivier", "Pierre", "Rémi", "Simon", "Tristan", "Yann", "Alexis", "Dorian", "Enzo", "Mathieu"],
    last: ["Fournier", "Bonnet", "Lambert", "Durand", "Petit", "Leroy", "Caron", "Picard", "Gaillard", "Barbier", "Berger", "Carpentier", "Lefort", "Masson", "Pasquier", "Reynaud", "Tessier", "Vincent", "Bouvier", "Chauvin", "Delorme", "Fabre", "Granger", "Joubert", "Lacroix", "Millet", "Rey", "Toussaint"],
  },
  italian: {
    first: ["Giulio", "Edoardo", "Pietro", "Antonio", "Emanuele", "Fabio", "Giovanni", "Jacopo", "Leonardo", "Michele", "Mirko", "Paolo", "Samuele", "Vincenzo", "Dario", "Enrico", "Massimo", "Claudio", "Elia", "Alberto", "Franco"],
    last: ["Romano", "Colombo", "Ricci", "Esposito", "Russo", "De Luca", "Mancini", "Villa", "Cattaneo", "Marchetti", "Santoro", "Farina", "Leone", "Martini", "Mariani", "Rinaldi", "Testa", "Grassi", "Pagano", "Battaglia", "D'Amico", "Parisi", "Bellini", "Negri", "Sala", "Monti", "Corti", "Ferri", "Gatti", "De Santis", "Lombardi"],
  },
  dutchFlemish: {
    first: ["Tom", "Gijs", "Teun", "Floris", "Jelle", "Luuk", "Mees", "Sem", "Timo", "Cas", "Niek", "Rens", "Siebe", "Wannes", "Jens", "Brent", "Robbe", "Senne", "Arne", "Milan", "Stan", "Ward", "Lowie", "Emiel"],
    last: ["Mulder", "Bos", "Vos", "De Boer", "Kuipers", "Hoekstra", "Meijer", "De Groot", "Brouwer", "Koster", "Postma", "Veenstra", "Timmermans", "Jacobs", "Willems", "Pauwels", "De Smet", "De Clercq", "Vandenberghe", "Van Damme", "Michiels", "Smets", "Van den Berg", "Van Leeuwen", "Driessen", "Hermans", "Stevens", "Geerts", "Lambrechts", "Verlinden", "Vervoort", "Coenen", "Theunissen", "Lemmens", "Daems", "Cools", "Baert", "De Ridder", "Verbeke", "Callens", "Bogaert", "De Backer", "Wuyts"],
  },
  spanish: {
    first: ["Fernando", "Alberto", "Jorge", "Luis", "Miguel", "Antonio", "Manuel", "Francisco", "Vicente", "Emilio", "Ignacio", "Rodrigo", "Cristian", "Esteban", "Felipe", "Gabriel", "Hernán", "Joaquín", "Julio", "Leandro", "Martín", "Mateo", "Nicolás", "Ramón", "Salvador", "Santiago", "Tomás", "Camilo", "Sebastián", "Eduardo"],
    last: ["Navarro", "Domínguez", "Gil", "Serrano", "Blanco", "Suárez", "Ortiz", "Marín", "Soto", "Crespo", "Cano", "Prieto", "Calvo", "Gallego", "Vidal", "León", "Peña", "Flores", "Acosta", "Aguirre", "Arias", "Benítez", "Bermúdez", "Bustos", "Cárdenas", "Carrillo", "Cordero", "Cortés", "Duarte", "Escobar", "Figueroa", "Guzmán", "Ibarra", "Lara", "Maldonado", "Medina", "Mejía", "Montoya", "Morales", "Núñez", "Ochoa", "Osorio", "Palacios", "Paredes", "Quiroga", "Rincón", "Robles", "Rojas", "Salazar", "Salinas", "Sandoval", "Tapia", "Valdés", "Velasco", "Villalba", "Zambrano", "Zapata", "Cifuentes", "Pinilla", "Saavedra"],
  },
  german: {
    first: ["Andreas", "Benedikt", "Christoph", "Daniel", "Dominik", "Erik", "Hannes", "Jannik", "Konstantin", "Lasse", "Linus", "Matthias", "Nico", "Paul", "Simon", "Stefan", "Thorben", "Till"],
    last: ["Bauer", "Fuchs", "Graf", "Haas", "Hartmann", "Herrmann", "Huber", "Jung", "Kaiser", "Keller", "König", "Kraus", "Kuhn", "Maier", "Mayer", "Peters", "Pohl", "Roth", "Sauer", "Schmitt", "Schneider", "Schulz", "Seidel", "Stein", "Voigt", "Winkler", "Ziegler", "Albrecht"],
  },
  nordic: {
    first: ["Aksel", "Birk", "Eskil", "Gustav", "Halvor", "Jeppe", "Jonas", "Lasse", "Malte", "Nikolaj", "Oskar", "Rasmus", "Sigurd", "Simon", "Storm", "Thor", "Valdemar", "Vetle", "Aron", "Elias"],
    last: ["Madsen", "Mortensen", "Jespersen", "Thomsen", "Poulsen", "Knudsen", "Henriksen", "Lauridsen", "Østergaard", "Nygaard", "Brandt", "Friis", "Skov", "Winther", "Juhl", "Bjerre", "Iversen", "Karlsen", "Johansen", "Halvorsen", "Engen", "Fossum", "Myhre", "Sandvik", "Tangen", "Rønning", "Sletten", "Brekke", "Lindgren", "Åkesson", "Blomqvist", "Hedlund", "Forsberg", "Nilsson", "Wikström", "Korhonen", "Mäkinen", "Laine", "Salonen"],
  },
  anglo: {
    first: ["Luke", "Daniel", "Samuel", "Joel", "Nathan", "Aaron", "Callum", "Jacob", "Lewis", "Finn", "Charlie", "Archie", "Henry", "Alfie", "Joshua", "Patrick", "Sean", "Cameron", "Brody", "Hayden", "Tyler", "Logan", "Caleb", "Declan"],
    last: ["Edwards", "Roberts", "Phillips", "Campbell", "Parker", "Evans", "Collins", "Stewart", "Morris", "Rogers", "Reed", "Cook", "Morgan", "Bell", "Bailey", "Murray", "Brooks", "Sanders", "Price", "Barnes", "Ross", "Henderson", "Coleman", "Jenkins", "Perry", "Powell", "Long", "Patterson", "Flynn", "Webster", "Sutton", "Harmon", "Gallagher", "Donnelly", "Burke", "Nolan", "O'Connor", "O'Brien", "Maguire", "Whelan"],
  },
  portuguese: {
    first: ["Afonso", "Bernardo", "Eduardo", "Leandro", "Mateus", "Salvador"],
    last: ["Neves", "Cunha", "Vieira", "Monteiro", "Faria", "Baptista", "Camacho", "Freitas"],
  },
  slavic: {
    first: ["Szymon", "Mateusz", "Krzysztof", "Łukasz", "Wojciech", "Paweł", "Radek", "Petr", "Martin", "Miroslav", "Pavel", "Roman", "Andrej", "Boris", "Milan", "Marko", "Nikola", "Aleksandar", "Dmytro", "Oleh", "Anton", "Viktor", "Bohdan", "Taras", "Janez", "Tine", "Domen", "Anže", "Urban", "Bence"],
    last: ["Svoboda", "Novotný", "Veselý", "Hájek", "Beneš", "Růžička", "Fiala", "Urbánek", "Walczak", "Górski", "Pawlak", "Michalski", "Witkowski", "Jankowski", "Grabowski", "Olszewski", "Król", "Wieczorek", "Stępień", "Petrović", "Jovanović", "Nikolić", "Stojanović", "Ilić", "Marković", "Savić", "Kovačič", "Potočnik", "Golob", "Turk", "Bizjak", "Kotnik", "Shevchuk", "Bondarenko", "Kovalenko", "Melnyk", "Tkachenko", "Kravets", "Smirnov", "Volkov", "Kuznetsov", "Morozov", "Fedorov", "Sokolov", "Pavlenko", "Petkov", "Iliev", "Kolev", "Stoyanov", "Popescu", "Ionescu", "Dumitrescu", "Stancu", "Marinescu", "Radu", "Stoica", "Nagy", "Szabó", "Kiss", "Horváth", "Molnár", "Farkas", "Balogh", "Takács"],
  },
  chinese: {
    first: ["Xin", "Yu", "Zhi", "Guang", "Liang", "Dong", "Sheng", "Rui", "Tian", "Zhen", "Wen", "Xiang", "Yong", "Hua", "Jian", "Ping"],
    last: ["Song", "Yu", "Pan", "Du", "Yan", "Cai", "Jiang", "Wei", "Shi", "Lu", "Ding", "Yao", "Qin", "Kong", "Cui", "Hou"],
  },
  maghreb: {
    first: ["Omar", "Khalid", "Samir", "Rachid", "Farid", "Hassan", "Hossein", "Ali", "Reza", "Mahdi", "Saeed", "Arash", "Nader", "Kamran", "Salim", "Fouad", "Jamal", "Mounir"],
    last: ["Amrani", "Berrada", "Chaoui", "Daoudi", "El Fassi", "Ghazali", "Hammoudi", "Idrissi", "Jaziri", "Karimi", "Lamrani", "Mokhtari", "Nasri", "Othmani", "Rahimi", "Sebai", "Tahiri", "Zerhouni", "Hosseini", "Ahmadi", "Moradi", "Jafari", "Kazemi", "Sadeghi", "Ebrahimi", "Gholami", "Bakhtiari", "Sharifi"],
  },
  eastAfrican: {
    first: ["Dawit", "Filmon", "Mussie", "Semere", "Tesfalem", "Yemane", "Awet", "Sirak", "Jean-Claude", "Valens", "Innocent", "Fabrice", "Olivier", "Théoneste", "Abdoulaye", "Mamadou", "Ousmane", "Ibrahima", "Seydou", "Moussa", "Cheikh", "Souleymane"],
    last: ["Estifanos", "Mehari", "Russom", "Tewelde", "Zerai", "Asmerom", "Tesfamariam", "Weldemichael", "Andemariam", "Ndizeye", "Tuyishime", "Niyigena", "Iradukunda", "Nshimiyimana", "Uwimana", "Diallo", "Traoré", "Keita", "Coulibaly", "Diop", "Ndiaye", "Sangaré", "Cissé", "Fofana", "Touré", "Koné", "Mensah", "Owusu", "Boateng", "Asante", "Okonkwo", "Adeyemi", "Eze", "Banda", "Moyo", "Ncube"],
  },
};

// ── NYE clusters for nationaliteter der i basen faldt til "generic" ────────────
const NEW_CLUSTERS = {
  turkish: {
    first: ["Emre", "Mert", "Burak", "Kaan", "Arda", "Cem", "Deniz", "Efe", "Furkan", "Hakan", "Kerem", "Murat", "Onur", "Serkan", "Tolga", "Umut", "Volkan", "Yusuf"],
    last: ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Aydın", "Öztürk", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Koç", "Kurt", "Özdemir", "Polat", "Güneş", "Bulut", "Aksoy", "Avcı", "Türkmen", "Yıldız", "Yıldırım"],
  },
  greek: {
    first: ["Giorgos", "Dimitris", "Nikos", "Kostas", "Vasilis", "Christos", "Panagiotis", "Stavros", "Andreas", "Petros", "Ilias", "Spyros"],
    last: ["Papadopoulos", "Nikolaou", "Georgiou", "Dimitriou", "Vlachos", "Economou", "Makris", "Alexiou", "Christodoulou", "Antoniou", "Karagiannis", "Stavrou", "Lambrou", "Kotsis", "Doukas", "Galanis"],
  },
  filipino: {
    first: ["Jomar", "Ronnel", "Marvin", "Jayson", "Arnel", "Rodel", "Joel", "Dexter", "Ramil", "Erwin", "Jhon", "Marlon", "Reynaldo", "Alvin", "Junrey", "Cris"],
    last: ["Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Villanueva", "Ramos", "Castillo", "Soriano", "Dela Cruz", "Domingo", "Salazar", "Mercado", "Pascual", "Aguilar", "Manalo", "Galang", "Dizon", "Magsino", "Lagman"],
  },
  indonesianMalay: {
    first: ["Agus", "Budi", "Dedi", "Eko", "Hendra", "Rizki", "Andi", "Bayu", "Dimas", "Fajar", "Gilang", "Putra", "Wahyu", "Yudha", "Azlan", "Farid", "Hafiz", "Iskandar", "Syafiq", "Amir"],
    last: ["Susanto", "Wibowo", "Santoso", "Saputra", "Hidayat", "Kurniawan", "Setiawan", "Pratama", "Nugroho", "Firmansyah", "Ramli", "Hashim", "Ismail", "Rahman", "Yusof", "Abdullah", "Zulkifli", "Osman"],
  },
  thai: {
    first: ["Somchai", "Anan", "Kittisak", "Niran", "Prasert", "Sakda", "Thanawat", "Wichai", "Chaiwat", "Decha", "Kraisorn", "Phanuwat", "Tawan", "Korn"],
    last: ["Srisawat", "Chaiyasit", "Phromsri", "Kaewkla", "Suwannarat", "Thongsuk", "Rattanakorn", "Boonmee", "Saengthong", "Wattana", "Phongsri", "Inthara", "Chanthavong", "Sysavath"],
  },
  vietnamese: {
    first: ["Minh", "Quang", "Duc", "Hieu", "Tuan", "Khanh", "Long", "Phong", "Thanh", "Trung"],
    last: ["Nguyen", "Tran", "Le", "Pham", "Hoang", "Vu", "Dang", "Bui", "Do", "Ngo", "Duong", "Ly"],
  },
  centralAsian: {
    first: ["Aibek", "Daniyar", "Yerlan", "Nurlan", "Timur", "Ruslan", "Azamat", "Bekzat", "Sanzhar", "Olzhas", "Marat", "Rustam", "Bakhtiyor", "Jasur", "Ulugbek", "Sardor"],
    last: ["Abdullayev", "Akhmetov", "Bekov", "Ismailov", "Mamyrov", "Nurgaliyev", "Omarov", "Rakhimov", "Sattarov", "Toktogulov", "Usenov", "Yusupov", "Zhumagulov", "Saidov", "Mirzaev", "Kasymov", "Seitkali", "Dosmukhamedov"],
  },
  mongolian: {
    first: ["Batbayar", "Ganzorig", "Otgonbayar", "Enkhbat", "Naranbaatar", "Tumur", "Bat-Erdene", "Ganbold", "Tulga", "Temuulen"],
    last: ["Erdenebat", "Ganbaatar", "Munkhbat", "Altangerel", "Bayarsaikhan", "Dorj", "Sukhbat", "Tsogt", "Chuluun", "Jargal"],
  },
  southAsian: {
    first: ["Arjun", "Rahul", "Vikram", "Rohan", "Karan", "Aditya", "Sanjay", "Nikhil", "Tharindu", "Kasun", "Dinesh", "Imran", "Bilal", "Asad"],
    last: ["Sharma", "Verma", "Patel", "Mehta", "Joshi", "Nair", "Rana", "Perera", "Fernando", "Jayasinghe", "Bandara", "Khan", "Hussain", "Malik", "Chauhan"],
  },
  albanian: {
    first: ["Arben", "Blerim", "Driton", "Endrit", "Fatos", "Gentian", "Ilir", "Kreshnik", "Luan", "Valon"],
    last: ["Krasniqi", "Gashi", "Shala", "Morina", "Bytyqi", "Rexhepi", "Dema", "Leka", "Marku", "Prifti"],
  },
  georgian: {
    first: ["Giorgi", "Levan", "Irakli", "Davit", "Zurab", "Nika", "Tornike", "Sandro"],
    last: ["Beridze", "Kapanadze", "Lomidze", "Gelashvili", "Tsiklauri", "Japaridze", "Khurtsidze", "Maisuradze", "Abuladze", "Giorgadze"],
  },
  armenian: {
    first: ["Aram", "Tigran", "Vahan", "Narek", "Hayk", "Artur", "Gor", "Sargis"],
    last: ["Petrosyan", "Hakobyan", "Grigoryan", "Harutyunyan", "Avetisyan", "Mkrtchyan", "Vardanyan", "Karapetyan"],
  },
};

// ── ISO-mapping: tilføjelser + overrides oven på basens ISO_TO_CLUSTER ─────────
// Approksimationer (nærmeste kulturelt-plausible pool) er markeret i
// CLUSTER_APPROXIMATIONS nedenfor og dokumenteret i audit-doc'en.
const ISO_ADDITIONS = {
  TR: "turkish", AZ: "turkish",
  GR: "greek", CY: "greek",
  PH: "filipino", GU: "filipino",
  ID: "indonesianMalay", MY: "indonesianMalay", BN: "indonesianMalay",
  TH: "thai", LA: "thai", KH: "thai",
  VN: "vietnamese",
  KZ: "centralAsian", KG: "centralAsian", UZ: "centralAsian",
  MN: "mongolian",
  IN: "southAsian", LK: "southAsian", PK: "southAsian",
  AL: "albanian",
  AM: "armenian",
  MU: "french",       // Mauritius: fransk-kreolske efternavne dominerer
  PR: "spanish",      // Puerto Rico
  BZ: "spanish",      // Belize: spansktalende flertal
  AD: "spanish",      // Andorra: catalansk ≈ spansk pool
  GY: "anglo",        // Guyana: engelsktalende
  GD: "anglo",        // Grenada: engelsktalende
  CW: "dutchFlemish", // Curaçao: hollandsk Caribien
  MT: "italian",      // Malta: italiensk-påvirkede efternavne
  TL: "portuguese",   // Timor-Leste: portugisisk-påvirkede navne
  PS: "maghreb",      // Palæstina: arabiske navne
  GA: "eastAfrican",  // Gabon: pan-subsaharisk pool (frankofon Vestafrika-navne)
  LS: "eastAfrican",  // Lesotho: pan-subsaharisk pool
};
const ISO_OVERRIDES = {
  XK: "albanian",  // Kosovo er albansk-sproget — basens "slavic" var kulturelt forkert
  GE: "georgian",  // Georgiske navne (-shvili/-adze) er ikke slaviske
};

// Kulturelle approksimationer der skal dokumenteres player-facing-reviewbart.
// Format: ISO → kort begrundelse (bruges direkte i audit-doc'en).
export const CLUSTER_APPROXIMATIONS = {
  AZ: "Aserbajdsjan → turkish (tyrkisk-sproglig navnetradition)",
  CY: "Cypern → greek (græsk-cypriotisk flertal)",
  GU: "Guam → filipino (chamorro-navne er spansk/filippinsk-påvirkede)",
  LA: "Laos → thai (nærmeste sydøstasiatiske pool)",
  KH: "Cambodja → thai (nærmeste sydøstasiatiske pool; khmer-navne afviger)",
  MN: "Mongoliet → mongolian (egen mini-pool)",
  LK: "Sri Lanka → southAsian (blandet indisk/singalesisk pool)",
  PK: "Pakistan → southAsian (muslimske navne indgår i poolen)",
  MU: "Mauritius → french (fransk-kreolske efternavne)",
  BZ: "Belize → spanish (spansktalende flertal)",
  AD: "Andorra → spanish (catalansk navnetradition)",
  CW: "Curaçao → dutchFlemish (hollandsk Caribien)",
  MT: "Malta → italian (italiensk-påvirkede efternavne)",
  TL: "Timor-Leste → portuguese (portugisisk kolonihistorie)",
  GA: "Gabon → eastAfrican (pan-subsaharisk pool, frankofone navne)",
  LS: "Lesotho → eastAfrican (pan-subsaharisk pool)",
  IS: "Island → nordic (basens valg; ægte islandske patronymer findes ikke i poolen)",
  BE: "Belgien → dutchFlemish (basens valg; vallonske ryttere får flamske navne)",
  RO: "Rumænien/Moldova → slavic (pan-østeuropæisk pool inkl. rumænske efternavne)",
  HU: "Ungarn → slavic (pan-østeuropæisk pool inkl. ungarske efternavne)",
};

function dedupe(arr) {
  return [...new Set(arr)];
}

// ── Byg de endelige pools: base + extensions + nye clusters ────────────────────
export const EXTENDED_CLUSTERS = (() => {
  const merged = {};
  for (const [key, base] of Object.entries(NAME_CLUSTERS)) {
    const ext = CLUSTER_EXTENSIONS[key] || { first: [], last: [] };
    merged[key] = {
      first: dedupe([...base.first, ...ext.first]),
      last: dedupe([...base.last, ...ext.last]),
    };
  }
  for (const [key, pool] of Object.entries(NEW_CLUSTERS)) {
    if (merged[key]) throw new Error(`Cluster-navnekollision med basen: ${key}`);
    merged[key] = { first: dedupe(pool.first), last: dedupe(pool.last) };
  }
  return merged;
})();

export const EXTENDED_ISO_TO_CLUSTER = { ...ISO_TO_CLUSTER, ...ISO_ADDITIONS, ...ISO_OVERRIDES };

export function extendedClusterForNationality(iso2) {
  return EXTENDED_ISO_TO_CLUSTER[iso2] || "generic";
}

// Kapacitets-rapport (kombinationer pr. cluster) — bruges af generatorens
// utilization-statistik og af testen der håndhæver head-room.
export function clusterCapacities() {
  const out = {};
  for (const [key, pool] of Object.entries(EXTENDED_CLUSTERS)) {
    out[key] = pool.first.length * pool.last.length;
  }
  return out;
}
