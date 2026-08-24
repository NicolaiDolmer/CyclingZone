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
//
// ── #4178 (ejer-godkendt 24/8): udvidet fra 15 til 22 clusters, 18×28 → 40×60 ──
//
// BAGGRUND: 34 % af alle ryttere (2.194 af 6.530) bar et kunstigt mellem-initial
// ("Carlos M. García"), fordi makeUniqueName løb tør for unikke fornavn+efternavn-
// kombinationer og faldt tilbage på initial-varianten. Værst: Argentina 68 %,
// Colombia 64 %, Spanien 64 %, Korea 53 %. Frankrig (2 %) og Italien (6 %) var
// rene, fordi de havde clusteret for sig selv.
//
// TO ÅRSAGER, begge adresseret her:
//   1. Spansk delte ÉT cluster mellem ES, CO, AR, MX, PE + 15 andre lande. De store
//      cykelnationer spiste af samme 504 kombinationer. Løst ved at splitte de
//      overbelastede clusters (spansk, anglo, slavisk) i sprogligt nærmere grupper.
//   2. Listerne var for korte (18 fornavne × 20-28 efternavne = 360-504 kombi).
//      Nu 40 × 60 = 2.400 pr. cluster.
//
// Kapacitet: ~7.000 → ~52.800 basis-kombinationer. Med bestanden (6.530) plus
// #4172's AI-fyld (3.456) falder mætningen fra >100 % til ~19 %, så mellem-initialer
// bliver undtagelsen i stedet for hver tredje rytter.
//
// INGEN cluster-nøgler er fjernet eller omdøbt — kun tilføjet. `anglo` bevares
// bevidst, fordi boardMandateNames.js bruger NAME_CLUSTERS.anglo som fallback.
//
// DETERMINISME: at udvide listerne ændrer hvilke navne en given seed producerer.
// Det er ufarligt for eksisterende ryttere (de er persisteret i DB), men betyder at
// en re-generering fra samme seed ikke reproducerer den gamle population. Se
// determinisme-kontrakten i docs/RIDER_GENERATION.md.

// ── Clusters: firstnames + lastnames per region/sprogtradition ────────────────
export const NAME_CLUSTERS = {
  french: {
    first: ["Lucas", "Hugo", "Théo", "Nathan", "Maxime", "Antoine", "Julien", "Florian", "Romain", "Clément", "Quentin", "Bastien", "Damien", "Loïc", "Mathis", "Corentin", "Adrien", "Valentin", "Guillaume", "Baptiste", "Alexis", "Émile", "Gaël", "Thibault", "Arnaud", "Pierre", "Olivier", "Cédric", "Fabien", "Sylvain", "Vincent", "Benoît", "Marius", "Léo", "Axel", "Enzo", "Noé", "Tristan", "Yannick", "Gabin"],
    last: ["Bernard", "Moreau", "Lefèvre", "Girard", "Rousseau", "Vidal", "Faure", "Mercier", "Blanc", "Guerin", "Chevalier", "Lemaire", "Renaud", "Marchand", "Dumas", "Brunet", "Gauthier", "Perrin", "Roussel", "Hervé", "Colin", "Vasseur", "Pichon", "Charpentier", "Delcroix", "Aubert", "Maillot", "Sauvage", "Bonnet", "Dupont", "Lambert", "Fontaine", "Robin", "Masson", "Noël", "Meunier", "Berger", "Fournier", "Leroy", "Morel", "Simon", "Laurent", "Michel", "Garnier", "Clément", "Denis", "Duval", "Joly", "Roy", "Barbier", "Schmitt", "Picard", "Roger", "Leclerc", "Payet", "Carpentier", "Menard", "Bourgeois", "Prevost", "Baron"],
  },
  italian: {
    first: ["Marco", "Luca", "Matteo", "Davide", "Andrea", "Simone", "Federico", "Lorenzo", "Alessandro", "Giacomo", "Stefano", "Nicolò", "Riccardo", "Tommaso", "Filippo", "Gabriele", "Cristian", "Manuel", "Giovanni", "Antonio", "Francesco", "Michele", "Emanuele", "Diego", "Samuele", "Alberto", "Daniele", "Pietro", "Enrico", "Fabio", "Giulio", "Leonardo", "Massimo", "Paolo", "Roberto", "Sergio", "Vittorio", "Edoardo", "Mirco", "Elia"],
    last: ["Conti", "Ferrari", "Riva", "Galli", "Costa", "Greco", "Bruno", "Marini", "Longo", "Serra", "Vitali", "Caruso", "Fontana", "Moretti", "Barbieri", "Sartori", "Pellegrini", "Rizzo", "Donati", "Ferrara", "Bianchi", "Gentile", "Valli", "Orlando", "Palmieri", "Sorrentino", "Brivio", "Tonti", "Rossi", "Russo", "Esposito", "Romano", "Colombo", "Ricci", "Marino", "Rinaldi", "Leone", "Villa", "Monti", "Coppola", "De Luca", "Mancini", "Lombardi", "Martini", "Giordano", "Santoro", "Mariani", "Fabbri", "Amato", "Silvestri", "Testa", "Grassi", "Farina", "Bellini", "Guerra", "Basso", "Pagani", "Rosso", "Neri", "Milani"],
  },
  dutchFlemish: {
    first: ["Daan", "Sven", "Bram", "Lars", "Niels", "Thijs", "Wout", "Jasper", "Ruben", "Tijl", "Sander", "Koen", "Maarten", "Joris", "Pieter", "Stijn", "Bart", "Wessel", "Jeroen", "Tim", "Rik", "Gijs", "Teun", "Sem", "Jelle", "Roel", "Bas", "Kobe", "Arne", "Senne", "Lode", "Wannes", "Dries", "Jonas", "Milan", "Robbe", "Seppe", "Vincent", "Bert", "Nick"],
    last: ["De Vries", "Janssen", "Vermeulen", "De Jong", "Bakker", "Visser", "Smit", "Maes", "Peeters", "Claes", "Wouters", "Hendrickx", "Aerts", "Verhoeven", "Dekker", "Mertens", "Coppens", "Van Dijk", "Van Loon", "Vandeput", "Goossens", "Lenaerts", "Cornelis", "Segers", "Brughmans", "Van Hecke", "Roelofs", "Tielemans", "Willems", "Jacobs", "Van den Berg", "Meijer", "Mulder", "De Boer", "Bos", "Vos", "Kok", "Huisman", "Prins", "Blom", "Verbeek", "Van Dam", "Schouten", "Kuipers", "Post", "Timmermans", "Verstraeten", "De Smet", "Van Damme", "Declercq", "Vermeersch", "Verschueren", "Deneve", "Verhulst", "Baert", "Naessens", "Devos", "Lammens", "Verbruggen", "Stevens"],
  },
  spanish: {
    first: ["Carlos", "Javier", "Diego", "Pablo", "Sergio", "Alejandro", "Daniel", "Adrián", "Iván", "Rubén", "Óscar", "Marcos", "Andrés", "Raúl", "Gonzalo", "Hugo", "Mario", "Aitor", "Álvaro", "Jorge", "Miguel", "David", "Fernando", "Ignacio", "Rodrigo", "Alberto", "Manuel", "Enrique", "Guillermo", "Roberto", "Xabier", "Unai", "Iker", "Joan", "Marc", "Pau", "Nicolás", "Víctor", "Samuel", "Tomás"],
    last: ["García", "Martínez", "López", "Sánchez", "Romero", "Torres", "Ramírez", "Vargas", "Castro", "Ortega", "Rubio", "Molina", "Delgado", "Cabrera", "Reyes", "Aguilar", "Mendoza", "Herrera", "Iglesias", "Campos", "Vega", "Fuentes", "Carmona", "Pardo", "Quintero", "Bravo", "Sierra", "Lozano", "Fernández", "González", "Rodríguez", "Pérez", "Gómez", "Díaz", "Álvarez", "Moreno", "Muñoz", "Jiménez", "Ruiz", "Navarro", "Domínguez", "Gil", "Serrano", "Blanco", "Suárez", "Ortiz", "Ramos", "Marín", "Sanz", "Núñez", "Medina", "Cortés", "Castillo", "Garrido", "Santos", "Lorenzo", "Montero", "Hidalgo", "Vicente", "Arias"],
  },
  latinAmerican: {
    first: ["Nairo", "Egan", "Esteban", "Rigoberto", "Sebastián", "Santiago", "Juan", "Camilo", "Fernando", "Julián", "Brandon", "Wilson", "Édgar", "Óscar", "Álex", "Jhonatan", "Yeison", "Freddy", "Nelson", "Cristian", "Emiliano", "Facundo", "Matías", "Lautaro", "Agustín", "Franco", "Joaquín", "Bautista", "Thiago", "Benjamín", "Maximiliano", "Nicolás", "Leandro", "Gastón", "Ezequiel", "Rodrigo", "Mauricio", "Andrés", "Héctor", "Luis"],
    last: ["Quintana", "Bernal", "Chaves", "Urán", "Gaviria", "Higuita", "Martínez", "Buitrago", "Sosa", "Molano", "Pantano", "Rubiano", "Sevilla", "Osorio", "Villalba", "Caicedo", "Restrepo", "Zapata", "Ospina", "Cardona", "Betancur", "Muñoz", "Arango", "Valencia", "Mesa", "Duarte", "Correa", "Salazar", "Guerrero", "Pineda", "Escobar", "Acosta", "Rojas", "Peña", "Cáceres", "Benítez", "Ferreyra", "Gutiérrez", "Ledesma", "Maldonado", "Ibarra", "Coronel", "Aguirre", "Sandoval", "Villalobos", "Paredes", "Bustos", "Cabral", "Godoy", "Miranda", "Olivera", "Sarmiento", "Tapia", "Vera", "Zárate", "Alvarado", "Bermúdez", "Carrillo", "Duque", "Franco"],
  },
  german: {
    first: ["Lukas", "Jonas", "Felix", "Max", "Tim", "Niklas", "Jan", "Leon", "Moritz", "Florian", "Tobias", "Philipp", "Sebastian", "Fabian", "Lennard", "Marvin", "Julian", "Kilian", "Simon", "David", "Nico", "Marcel", "Dominik", "Patrick", "Christoph", "Andreas", "Michael", "Stefan", "Thomas", "Matthias", "Benedikt", "Jannik", "Luca", "Elias", "Emil", "Paul", "Anton", "Rafael", "Silvan", "Mauro"],
    last: ["Müller", "Schmidt", "Fischer", "Weber", "Wagner", "Becker", "Hoffmann", "Schäfer", "Koch", "Richter", "Klein", "Wolf", "Schröder", "Neumann", "Schwarz", "Zimmermann", "Braun", "Krüger", "Hofmann", "Lange", "Werner", "Krause", "Lehmann", "Brandt", "Engel", "Vogt", "Sommer", "Frank", "Schulz", "Hartmann", "Meyer", "Schneider", "Bauer", "Keller", "Roth", "Beck", "Winkler", "Böhm", "Seidel", "Graf", "Kuhn", "Ziegler", "Bergmann", "Franke", "Albrecht", "Baumann", "Ludwig", "Peters", "Jung", "Haas", "Fuchs", "Berger", "Herrmann", "Walter", "König", "Huber", "Mayer", "Gruber", "Steiner", "Moser"],
  },
  nordic: {
    first: ["Emil", "Magnus", "Oliver", "William", "Noah", "Frederik", "Mathias", "Kasper", "Sander", "Henrik", "Jakob", "Anders", "Mads", "Viktor", "Erik", "Sebastian", "Johan", "Tobias", "Rasmus", "Lucas", "Oscar", "Elias", "Alexander", "Nikolaj", "Christian", "Marius", "Håkon", "Sindre", "Even", "Kristoffer", "Axel", "Hugo", "Linus", "Gustav", "Anton", "Filip", "Ville", "Eetu", "Aleksi", "Joonas"],
    last: ["Hansen", "Nielsen", "Larsen", "Andersen", "Pedersen", "Kristiansen", "Olsen", "Berg", "Lund", "Dahl", "Holm", "Moen", "Haugen", "Lie", "Strand", "Sørensen", "Bakke", "Nyström", "Lindqvist", "Sandberg", "Eriksson", "Holmberg", "Aas", "Vik", "Solberg", "Bergström", "Lindholm", "Mathisen", "Johansen", "Jensen", "Christensen", "Rasmussen", "Jørgensen", "Madsen", "Poulsen", "Thomsen", "Møller", "Knudsen", "Mortensen", "Johansson", "Andersson", "Karlsson", "Nilsson", "Svensson", "Gustafsson", "Persson", "Lindgren", "Åberg", "Ekström", "Forsberg", "Virtanen", "Korhonen", "Mäkinen", "Nieminen", "Heikkinen", "Laine", "Halonen", "Ranta", "Salo", "Hakala"],
  },
  anglo: {
    first: ["Jack", "Harry", "Oliver", "George", "James", "Thomas", "Ethan", "Mason", "Cooper", "Liam", "Ryan", "Connor", "Lachlan", "Cody", "Dylan", "Blake", "Owen", "Toby", "Charlie", "Alfie", "Freddie", "Archie", "Joseph", "Samuel", "Daniel", "Benjamin", "Edward", "Henry", "Alexander", "Jacob", "Callum", "Finlay", "Rhys", "Cameron", "Declan", "Niall", "Eoin", "Fergus", "Isaac", "Louis"],
    last: ["Smith", "Brown", "Taylor", "Wilson", "Walker", "Hughes", "Turner", "Carter", "Mitchell", "Cooper", "Bennett", "Ward", "Foster", "Reid", "Murphy", "Kelly", "Hayes", "Fletcher", "Pearce", "Dawson", "Crawford", "Holland", "Newton", "Whitfield", "Ramsay", "Sinclair", "Doyle", "Marsh", "Jones", "Williams", "Davies", "Evans", "Thomas", "Roberts", "Johnson", "Robinson", "Wright", "Thompson", "White", "Green", "Hall", "Wood", "Clarke", "Jackson", "Harris", "Baker", "Morris", "Barnes", "Gibson", "Palmer", "Rowe", "Chapman", "Lowe", "Bradley", "Sutton", "Ellis", "Webb", "Hunt", "Fox", "Bailey"],
  },
  northAmerican: {
    first: ["Tyler", "Brandon", "Austin", "Chase", "Hunter", "Colton", "Trevor", "Garrett", "Spencer", "Preston", "Wyatt", "Zachary", "Nathaniel", "Grant", "Brady", "Logan", "Carson", "Dawson", "Peyton", "Bryce", "Cole", "Devin", "Jared", "Keegan", "Landon", "Miles", "Parker", "Reed", "Shane", "Travis", "Weston", "Beau", "Clay", "Drew", "Gavin", "Hayden", "Jesse", "Kyle", "Luke", "Nolan"],
    last: ["Anderson", "Peterson", "Sullivan", "Fitzgerald", "Callahan", "Donovan", "Gallagher", "Hendricks", "Lockhart", "Marshall", "Nichols", "Osborne", "Prescott", "Quinlan", "Ramsey", "Sheridan", "Thatcher", "Vaughn", "Whitaker", "Zimmerman", "Boyd", "Carlisle", "Delaney", "Ellsworth", "Farrell", "Granger", "Hartley", "Ingram", "Jennings", "Kendrick", "Langley", "Merritt", "Norton", "Overton", "Paxton", "Radcliffe", "Stanton", "Tremblay", "Gagnon", "Bouchard", "Lavoie", "Fortin", "Beaulieu", "Pelletier", "Levesque", "Bergeron", "Caron", "Cloutier", "Dubois", "Poirier", "Thibault", "Gauthier", "Morin", "Lapointe", "Simard", "Bell", "Hayward", "Sterling", "Winslow", "Ashford"],
  },
  oceanian: {
    first: ["Jarrah", "Kai", "Tane", "Rangi", "Ashton", "Braden", "Caleb", "Darcy", "Fletcher", "Harrison", "Jesse", "Kade", "Levi", "Mitchell", "Nathan", "Riley", "Tobias", "Xavier", "Zane", "Angus", "Baxter", "Corey", "Dean", "Eli", "Flynn", "Grady", "Heath", "Jayden", "Kieran", "Lincoln", "Marcus", "Noah", "Oscar", "Patrick", "Quinn", "Rhys", "Seth", "Tyson", "Wade", "Zac"],
    last: ["Cooper", "Hayes", "Nolan", "Sutherland", "Kirkland", "Beattie", "Chalmers", "Dunlop", "Ferguson", "Gillespie", "Hamilton", "Irvine", "Jamieson", "Kerr", "Lawson", "McKenzie", "Nairn", "Ogilvie", "Patterson", "Rutherford", "Stirling", "Tasker", "Urquhart", "Waddell", "Yates", "Bligh", "Corrigan", "Delaney", "Everett", "Fairbairn", "Gawler", "Hobson", "Jeffries", "Keighley", "Lonsdale", "Mowbray", "Newland", "Oakley", "Pritchard", "Quayle", "Rowntree", "Somerville", "Thornton", "Vickers", "Wentworth", "Ngata", "Rewiti", "Tamati", "Wiremu", "Hohepa", "Paniora", "Kahui", "Manaia", "Ropata", "Waitere", "Broadbent", "Cadwallader", "Fitzsimmons", "Hargreaves", "Mainwaring"],
  },
  portuguese: {
    first: ["João", "Tiago", "Rui", "Miguel", "André", "Bruno", "Diogo", "Ricardo", "Nuno", "Gonçalo", "Henrique", "Rafael", "Vasco", "Duarte", "Fábio", "Hélder", "Tomás", "Gustavo", "Pedro", "Luís", "Carlos", "Filipe", "Sérgio", "Marco", "Hugo", "Daniel", "Alexandre", "Eduardo", "Francisco", "Manuel", "Paulo", "Vitor", "Afonso", "Salvador", "Martim", "Dinis", "Simão", "Leonardo", "Matheus", "Caio"],
    last: ["Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues", "Martins", "Sousa", "Fernandes", "Gonçalves", "Lopes", "Marques", "Almeida", "Ribeiro", "Pinto", "Carvalho", "Teixeira", "Moreira", "Correia", "Nogueira", "Azevedo", "Cardoso", "Coelho", "Macedo", "Branco", "Tavares", "Antunes", "Alves", "Barbosa", "Cunha", "Dias", "Esteves", "Faria", "Freitas", "Gomes", "Henriques", "Leal", "Machado", "Matos", "Melo", "Mendes", "Monteiro", "Neves", "Pacheco", "Pinheiro", "Queirós", "Ramos", "Reis", "Rocha", "Salgado", "Sampaio", "Simões", "Soares", "Torres", "Valente", "Vaz", "Veloso", "Vieira", "Xavier"],
  },
  slavic: {
    first: ["Jakub", "Tomáš", "Marek", "Filip", "Ondřej", "Matej", "Luka", "Jan", "Adam", "Vojtěch", "Rok", "Žan", "Martin", "Petr", "Lukáš", "David", "Michal", "Daniel", "Štěpán", "Vít", "Radek", "Zdeněk", "Miloš", "Aleš", "Primož", "Matevž", "Domen", "Tadej", "Jaka", "Nejc", "Blaž", "Gašper", "Anže", "Miha", "Klemen", "Uroš", "Bojan", "Dejan", "Igor", "Sašo"],
    last: ["Novák", "Kovač", "Horák", "Polák", "Kučera", "Pospíšil", "Krajnc", "Zupan", "Hribar", "Dvořák", "Černý", "Procházka", "Jelen", "Vrba", "Brož", "Sedlák", "Svoboda", "Novotný", "Marek", "Fiala", "Beneš", "Král", "Doležal", "Zeman", "Kolář", "Nový", "Šimek", "Bláha", "Konečný", "Malý", "Urban", "Hájek", "Bureš", "Vlček", "Kříž", "Mareš", "Šťastný", "Hruška", "Pavlík", "Kadlec", "Golob", "Kos", "Novak", "Potočnik", "Kovačič", "Turk", "Bizjak", "Oblak", "Mlakar", "Petek", "Rozman", "Vidmar", "Zajc", "Božič", "Košir", "Lah", "Perko", "Rus", "Šuštar", "Žagar"],
  },
  polish: {
    first: ["Michał", "Piotr", "Kamil", "Bartosz", "Patryk", "Dawid", "Rafał", "Mateusz", "Jakub", "Szymon", "Krzysztof", "Tomasz", "Marcin", "Paweł", "Łukasz", "Grzegorz", "Wojciech", "Maciej", "Adrian", "Damian", "Sebastian", "Przemysław", "Arkadiusz", "Radosław", "Mariusz", "Karol", "Filip", "Igor", "Oskar", "Antoni", "Franciszek", "Stanisław", "Wiktor", "Alan", "Nikodem", "Borys", "Ksawery", "Leon", "Miłosz", "Tymon"],
    last: ["Kowalski", "Nowak", "Wójcik", "Kamiński", "Zieliński", "Wiśniewski", "Lewandowski", "Mazur", "Kozłowski", "Adamczyk", "Szymański", "Woźniak", "Dąbrowski", "Kozak", "Jankowski", "Mazurek", "Kwiatkowski", "Krawczyk", "Piotrowski", "Grabowski", "Nowicki", "Pawłowski", "Michalski", "Nowakowski", "Wieczorek", "Wróbel", "Jabłoński", "Król", "Majewski", "Olszewski", "Jaworski", "Malinowski", "Pawlak", "Witkowski", "Walczak", "Stępień", "Górski", "Rutkowski", "Michalak", "Sikora", "Baran", "Duda", "Szewczyk", "Tomaszewski", "Pietrzak", "Marciniak", "Wróblewski", "Zalewski", "Jasiński", "Zawadzki", "Sadowski", "Bąk", "Chmielewski", "Borkowski", "Sokołowski", "Szczepański", "Kucharski", "Wilk", "Kalinowski", "Lis"],
  },
  eastSlavic: {
    first: ["Ivan", "Dmitri", "Sergei", "Andrei", "Alexei", "Nikolai", "Mikhail", "Vladimir", "Pavel", "Roman", "Artem", "Maxim", "Denis", "Egor", "Kirill", "Ilya", "Anton", "Yuri", "Oleg", "Vadim", "Vitali", "Bohdan", "Taras", "Yaroslav", "Oleksandr", "Volodymyr", "Serhiy", "Andriy", "Mykola", "Petro", "Vasyl", "Ihor", "Danylo", "Ostap", "Marko", "Stanislav", "Valentin", "Grigori", "Leonid", "Fedor"],
    last: ["Ivanov", "Petrov", "Sidorov", "Smirnov", "Kuznetsov", "Popov", "Vasiliev", "Sokolov", "Mikhailov", "Novikov", "Fedorov", "Morozov", "Volkov", "Alekseev", "Lebedev", "Semenov", "Egorov", "Pavlov", "Kozlov", "Stepanov", "Nikolaev", "Orlov", "Andreev", "Makarov", "Nikitin", "Zakharov", "Zaitsev", "Solovyov", "Borisov", "Yakovlev", "Shevchenko", "Kovalenko", "Bondarenko", "Tkachenko", "Kravchenko", "Oliynyk", "Shevchuk", "Polishchuk", "Boyko", "Melnyk", "Marchenko", "Savchenko", "Rudenko", "Lysenko", "Moroz", "Tkachuk", "Kravchuk", "Pavlenko", "Romanenko", "Zhuk", "Bondar", "Kolesnyk", "Panasyuk", "Danylchenko", "Hrytsenko", "Yatsenko", "Nazarenko", "Vasylenko", "Sydorenko", "Karpenko"],
  },
  balkan: {
    first: ["Nikola", "Marko", "Stefan", "Miloš", "Aleksandar", "Dušan", "Vladimir", "Nemanja", "Uroš", "Filip", "Lazar", "Petar", "Ivan", "Bojan", "Dragan", "Goran", "Zoran", "Milan", "Branko", "Slobodan", "Georgi", "Dimitar", "Ivaylo", "Todor", "Stoyan", "Kiril", "Andrei", "Cristian", "Mihai", "Alexandru", "Vlad", "Bogdan", "Răzvan", "Sorin", "Cătălin", "Ionuț", "Marius", "Florin", "Adrian", "Gabriel"],
    last: ["Petrović", "Jovanović", "Nikolić", "Marković", "Đorđević", "Stojanović", "Ilić", "Stanković", "Pavlović", "Milošević", "Popović", "Todorović", "Ristić", "Kostić", "Lukić", "Milić", "Simić", "Radovanović", "Vuković", "Božović", "Georgiev", "Dimitrov", "Ivanov", "Petrov", "Stoyanov", "Todorov", "Nikolov", "Angelov", "Hristov", "Vasilev", "Popescu", "Ionescu", "Popa", "Radu", "Dumitru", "Stoica", "Constantin", "Gheorghe", "Marin", "Tudor", "Barbu", "Nistor", "Oprea", "Stan", "Munteanu", "Șerban", "Ciobanu", "Lungu", "Dragomir", "Enache", "Iliev", "Kolev", "Marinov", "Rusev", "Zlatev", "Mitrović", "Savić", "Živković", "Perić", "Babić"],
  },
  baltic: {
    first: ["Mārtiņš", "Jānis", "Kārlis", "Roberts", "Edgars", "Rihards", "Toms", "Emīls", "Artūrs", "Gatis", "Rein", "Kaarel", "Marten", "Mihkel", "Rasmus", "Sander", "Tanel", "Kristjan", "Priit", "Jaan", "Mantas", "Tomas", "Lukas", "Matas", "Dovydas", "Rokas", "Nerijus", "Darius", "Gintaras", "Vytautas", "Aivaras", "Paulius", "Ignas", "Justas", "Karolis", "Mindaugas", "Ramūnas", "Šarūnas", "Tadas", "Žygimantas"],
    last: ["Bērziņš", "Kalniņš", "Ozoliņš", "Jansons", "Krūmiņš", "Liepiņš", "Zariņš", "Balodis", "Eglītis", "Vītols", "Tamm", "Saar", "Sepp", "Mägi", "Kask", "Kukk", "Rebane", "Ilves", "Pärn", "Koppel", "Kazlauskas", "Petrauskas", "Jankauskas", "Stankevičius", "Vasiliauskas", "Butkus", "Paulauskas", "Urbonas", "Žukauskas", "Navickas", "Ramanauskas", "Baranauskas", "Sakalauskas", "Adomaitis", "Grigas", "Motiejūnas", "Šimkus", "Vaitkus", "Kavaliauskas", "Rimkus", "Ozols", "Priede", "Skujiņš", "Auziņš", "Grigalis", "Lepik", "Raudsepp", "Kütt", "Sild", "Toom", "Vaher", "Aavik", "Peterson", "Lill", "Kikas", "Karpavičius", "Mickevičius", "Zubrus", "Daukšas", "Butkevičius"],
  },
  japanese: {
    first: ["Haruto", "Yuto", "Sota", "Ren", "Riku", "Kaito", "Sho", "Daiki", "Kenta", "Yuki", "Takumi", "Ryo", "Hiroto", "Kosei", "Naoki", "Shun", "Taiga", "Yamato", "Souta", "Hinata", "Aoto", "Itsuki", "Haruki", "Yusei", "Kaede", "Rikuto", "Tatsuya", "Keita", "Shota", "Yuma", "Kazuki", "Masaki", "Takuya", "Yuya", "Ryota", "Koki", "Tomoya", "Hayato", "Shohei", "Genki"],
    last: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato", "Yoshida", "Yamada", "Sasaki", "Matsumoto", "Inoue", "Kimura", "Hayashi", "Shimizu", "Mori", "Abe", "Ikeda", "Hashimoto", "Ishikawa", "Ogawa", "Maeda", "Fujita", "Okada", "Goto", "Saito", "Yamaguchi", "Matsuda", "Nakajima", "Ishii", "Ono", "Sakamoto", "Endo", "Aoki", "Fujii", "Nishimura", "Fukuda", "Ota", "Miura", "Fujiwara", "Okamoto", "Matsui", "Nakagawa", "Nakano", "Harada", "Kondo", "Tamura", "Takeuchi", "Kaneko", "Wada", "Nakayama", "Ishida", "Ueda", "Morita", "Hara", "Shibata", "Sakai"],
  },
  korean: {
    first: ["Minjun", "Seojun", "Doyun", "Jiho", "Hyun", "Junseo", "Jihoon", "Sungmin", "Woojin", "Hajun", "Eunwoo", "Taeyang", "Yeonjun", "Daehyun", "Seungho", "Jinwoo", "Hoyeon", "Kangmin", "Jiwoo", "Yunho", "Seokjin", "Minho", "Chanwoo", "Dohyun", "Geonwoo", "Hyunwoo", "Jaehyun", "Kyungsoo", "Namjoon", "Sangmin", "Taemin", "Wonjae", "Yeonwoo", "Bumjun", "Changmin", "Donghyun", "Gunwoo", "Hanbin", "Jungkook", "Siwoo"],
    last: ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", "Han", "Oh", "Seo", "Shin", "Kwon", "Hwang", "Ahn", "Song", "Hong", "Bae", "Yoo", "Nam", "Shim", "Noh", "Ha", "Jeon", "Ko", "Moon", "Son", "Yang", "Baek", "Heo", "Yu", "Cha", "Ju", "Woo", "Ryu", "Min", "Chae", "Gu", "Bang", "Byun", "Seok", "Do", "Jin", "Ma", "Pyo", "Sung", "Tak", "Wi", "Bong", "Chun", "Gil", "Hyun", "In", "Kwak", "Myung", "Ok", "Pi", "Sun"],
  },
  chinese: {
    first: ["Wei", "Hao", "Lei", "Jun", "Bo", "Tao", "Peng", "Yang", "Chen", "Kai", "Ming", "Feng", "Jie", "Long", "Bin", "Cheng", "Hui", "Qiang", "Xin", "Yu", "Zhen", "Dong", "Gang", "Hua", "Jian", "Liang", "Ning", "Ping", "Rui", "Sheng", "Tian", "Wen", "Xiang", "Yong", "Zhi", "Chao", "Fei", "Guo", "Kun", "Lin"],
    last: ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou", "Xu", "Sun", "Ma", "Zhu", "Hu", "Guo", "He", "Gao", "Lin", "Luo", "Zheng", "Liang", "Xie", "Tang", "Han", "Feng", "Deng", "Cao", "Peng", "Zeng", "Xiao", "Tian", "Dong", "Yuan", "Pan", "Yu", "Jiang", "Cai", "Yan", "Wei", "Shen", "Fu", "Zhong", "Lu", "Qian", "Dai", "Cui", "Ren", "Liao", "Yao", "Fang", "Jin", "Qiu", "Xia", "Tan", "Su", "Shi", "Bai", "Duan", "Hou"],
  },
  maghreb: {
    first: ["Youssef", "Karim", "Mehdi", "Amine", "Bilal", "Hamza", "Walid", "Anis", "Reda", "Sofiane", "Nabil", "Ayoub", "Ismail", "Tarek", "Yassine", "Adel", "Riad", "Zakaria", "Omar", "Rachid", "Samir", "Khalid", "Farid", "Jamal", "Hicham", "Nourdine", "Abdel", "Mounir", "Salim", "Tahar", "Younes", "Zoubir", "Brahim", "Chakib", "Djamel", "Fouad", "Hakim", "Kamel", "Lotfi", "Mourad"],
    last: ["Benali", "Haddad", "Mansouri", "Cherif", "Boukhari", "Saidi", "Ziani", "Bouazza", "Belkacem", "Khelifi", "Hamdi", "Toumi", "Brahimi", "Saadi", "Lahlou", "Bennani", "Ouedraogo", "Meziane", "Ferhat", "Guerrouj", "Slimani", "Bakkali", "Naceri", "Tahar", "Amrani", "Azzouz", "Belaid", "Chaoui", "Dahmani", "El Amrani", "Fassi", "Ghali", "Hammadi", "Idrissi", "Jelloun", "Kadiri", "Laroussi", "Madani", "Nasri", "Ouali", "Rahmani", "Sabri", "Tounsi", "Zerouali", "Aboud", "Barkaoui", "Chelbi", "Douiri", "Essaidi", "Fahmi", "Gharbi", "Hazem", "Jaziri", "Kacem", "Larbi", "Mrabet", "Nouri", "Ouazzani", "Riahi", "Sassi"],
  },
  eastAfrican: {
    first: ["Daniel", "Samuel", "Robel", "Henok", "Amanuel", "Yonas", "Biniam", "Natnael", "Merhawi", "Mekseb", "Joseph", "Eric", "Moise", "Didier", "Bonaventure", "Patrick", "Emmanuel", "Aron", "Dawit", "Filmon", "Ghebre", "Hailu", "Kidus", "Meron", "Nahom", "Petros", "Russom", "Sirak", "Tesfom", "Yemane", "Abel", "Bereket", "Efrem", "Gebre", "Isaac", "Kaleb", "Mesfin", "Nebiyu", "Selam", "Tewodros"],
    last: ["Tesfay", "Habtom", "Ghebremedhin", "Berhane", "Tekle", "Kidane", "Goitom", "Mulueta", "Hagos", "Weldu", "Niyonshuti", "Nsengimana", "Hakizimana", "Manizabayo", "Munyaneza", "Bizimana", "Uwizeyimana", "Habineza", "Mugisha", "Ndayisenga", "Tadesse", "Girmay", "Solomon", "Yohannes", "Amanuel", "Beyene", "Desta", "Fikadu", "Gebremariam", "Haile", "Kebede", "Lemma", "Mekonnen", "Negash", "Okubay", "Petros", "Russom", "Sereke", "Tewelde", "Woldu", "Zeray", "Abraha", "Bahta", "Debesay", "Estifanos", "Fessehaye", "Ghebreigzabhier", "Hadgu", "Iyasu", "Kflay", "Mehari", "Nguse", "Ogbay", "Rezene", "Semere", "Teklehaimanot", "Weldemichael", "Yosief", "Zeremariam", "Asefa"],
  },
  generic: {
    first: ["Alex", "Daniel", "David", "Adam", "Mark", "Leo", "Max", "Sam", "Eric", "Paul", "Ivan", "Omar", "Nikola", "Stefan", "Andrei", "Marco", "Luca", "Kevin", "Nick", "Chris", "Tony", "Victor", "Julio", "Ali", "Hassan", "Amir", "Rahul", "Arjun", "Ravi", "Sanjay", "Tarun", "Vikram", "Aziz", "Emre", "Kerem", "Mert", "Onur", "Serkan", "Burak", "Cem"],
    last: ["Petrov", "Kovacs", "Popov", "Nagy", "Stojan", "Ivanov", "Horvat", "Antic", "Marin", "Dimitrov", "Georgiev", "Toth", "Varga", "Kraus", "Babic", "Pavlov", "Ramos", "Costa", "Khan", "Ali", "Reyes", "Soto", "Vega", "Cruz", "Mejia", "Castro", "Lima", "Rios", "Kis", "Szabo", "Molnar", "Farkas", "Balogh", "Lakatos", "Juhasz", "Meszaros", "Simon", "Racz", "Fekete", "Feher", "Yilmaz", "Demir", "Sahin", "Celik", "Kaya", "Arslan", "Dogan", "Aydin", "Ozturk", "Kurt", "Sharma", "Patel", "Singh", "Kumar", "Reddy", "Nair", "Iyer", "Bose", "Chowdhury", "Malhotra"],
  },
};

// ── ISO2-nationalitet → cluster ───────────────────────────────────────────────
// Dækker alle nationaliteter observeret i prod-riders (2026-05-31) + REGION_TO_ISO.
// Ukendte koder falder til "generic" og rapporteres af generatoren (no silent caps).
//
// #4178: spansk/anglo/slavisk er splittet i sprogligt nærmere grupper, så de store
// cykelnationer ikke længere deler én navnepulje. Nye lande er tilføjet undervejs.
export const ISO_TO_CLUSTER = {
  FR: "french", MC: "french", BE_FR: "french",
  IT: "italian", SM: "italian", VA: "italian",
  NL: "dutchFlemish", BE: "dutchFlemish", SR: "dutchFlemish", AW: "dutchFlemish",
  // Spanien for sig; Latinamerika har sin egen pulje (#4178 — CO/AR/ES bar 64-68 % initialer).
  ES: "spanish", AD: "spanish", GQ: "spanish",
  CO: "latinAmerican", AR: "latinAmerican", MX: "latinAmerican", VE: "latinAmerican",
  EC: "latinAmerican", CL: "latinAmerican", CR: "latinAmerican", GT: "latinAmerican",
  PE: "latinAmerican", UY: "latinAmerican", BO: "latinAmerican", PY: "latinAmerican",
  DO: "latinAmerican", CU: "latinAmerican", PA: "latinAmerican", HN: "latinAmerican",
  NI: "latinAmerican", SV: "latinAmerican", PR: "latinAmerican",
  DE: "german", AT: "german", CH: "german", LI: "german", LU: "german",
  DK: "nordic", NO: "nordic", SE: "nordic", FI: "nordic", IS: "nordic", FO: "nordic",
  // Anglo bevares som britisk/irsk (boardMandateNames.js bruger den som fallback).
  GB: "anglo", IE: "anglo", MT: "anglo",
  US: "northAmerican", CA: "northAmerican", BM: "northAmerican",
  BS: "northAmerican", JM: "northAmerican", TT: "northAmerican", BB: "northAmerican",
  AU: "oceanian", NZ: "oceanian", FJ: "oceanian", PG: "oceanian",
  ZA: "anglo", NAM_EN: "anglo",
  PT: "portuguese", BR: "portuguese", AO: "portuguese", MZ: "portuguese", CV: "portuguese",
  // Slavisk splittet: central (CZ/SK/SI/HR), polsk, østslavisk, balkan, baltisk.
  CZ: "slavic", SK: "slavic", SI: "slavic", HR: "slavic",
  PL: "polish",
  RU: "eastSlavic", UA: "eastSlavic", BY: "eastSlavic", MD: "eastSlavic",
  RS: "balkan", BG: "balkan", RO: "balkan", MK: "balkan", BA: "balkan",
  ME: "balkan", XK: "balkan", AL: "balkan", GR: "balkan", CY: "balkan",
  EE: "baltic", LV: "baltic", LT: "baltic",
  GE: "eastSlavic", AM: "eastSlavic", AZ: "eastSlavic",
  KZ: "eastSlavic", UZ: "eastSlavic", KG: "eastSlavic", TJ: "eastSlavic", TM: "eastSlavic",
  JP: "japanese",
  KR: "korean", KP: "korean",
  CN: "chinese", HK: "chinese", TW: "chinese", SG: "chinese", MO: "chinese",
  DZ: "maghreb", MA: "maghreb", TN: "maghreb", EG: "maghreb", LY: "maghreb",
  SA: "maghreb", AE: "maghreb", QA: "maghreb", KW: "maghreb", BH: "maghreb",
  OM: "maghreb", IR: "maghreb", IQ: "maghreb", SY: "maghreb", IL: "maghreb",
  JO: "maghreb", LB: "maghreb", YE: "maghreb", SD: "maghreb", MR: "maghreb",
  ER: "eastAfrican", RW: "eastAfrican", ET: "eastAfrican", KE: "eastAfrican",
  UG: "eastAfrican", ZW: "eastAfrican", NA: "eastAfrican", NG: "eastAfrican",
  GH: "eastAfrican", CM: "eastAfrican", BF: "eastAfrican", CI: "eastAfrican",
  SN: "eastAfrican", ML: "eastAfrican", BJ: "eastAfrican", CD: "eastAfrican",
  TZ: "eastAfrican", BI: "eastAfrican", ZM: "eastAfrican", MW: "eastAfrican",
  BW: "eastAfrican", TG: "eastAfrican", GA: "eastAfrican", CG: "eastAfrican",
  TR: "generic", IN: "generic", PK: "generic", BD: "generic", LK: "generic",
  TH: "generic", VN: "generic", MY: "generic", ID: "generic", PH: "generic",
  HU: "generic",
};

export function clusterForNationality(iso2) {
  return ISO_TO_CLUSTER[iso2] || "generic";
}
