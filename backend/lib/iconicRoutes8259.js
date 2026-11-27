// backend/lib/iconicRoutes8259.js
// #8259 (ejer 26/11 paa #5841, punkt 7): "det er voldsomt vigtigt, at ikoniske loeb forbliver
// ikoniske". Monumenterne har allerede en fast, haandlavet rute (race_pool.authored_route,
// #6857). Denne fil er de naeste: de kendte endagsklassikere i alle fire seniordivisioner,
// hver med de afgoerende stykker (stigninger, mure, brosten- og grussektorer) og en
// afslutning der ligner det rigtige loeb.
//
// STATUS: GODKENDT (ejer 26/11 aften, #8830): alle ruter her er faste fra S6. Migrationen
// database/2026-11-26-8259-iconic-fixed-routes.sql skriver dem i race_pool.authored_route
// (genereret af backend/scripts/dev/buildIconicRoutesMigration8259.mjs; testen holder SQL og
// fil ens). Ungdomsudgaverne (#7471) koerer samme rute skaleret som monumenterne.
// Generatorens vagt for haandlavede ruter tillader monumenterne og netop disse loeb
// (isFixedIconicRouteRace). Navnene paa stigninger og sektorer er spillets egne varianter,
// samme konvention som monumenternes ruter.
//
// Formen er authored_route (raceIdentityTypes.validateAuthoredRoute) uden afledte felter:
// hoejdemeterne regnes af ruten med generatorens egen formel, og finale-rampen for mur,
// bakke og stigende spurt laeses af maalstigningen (#6995). iconicRoutes8259.test.js bygger
// hver rute gennem den rigtige generator og benchmark-gatens etape-tjek.

import { elevationGainS5 } from "./raceRouteGenerator.js";
import { parseMiniEditionExternalId } from "./youthMiniEditions7471.js";

/** @typedef {{ name: string, category: string, crest_km: number, length_km: number, avg_gradient: number, summit_finish: boolean }} AuthoredClimb */

/** @returns {AuthoredClimb} */
function climb(name, category, crestKm, lengthKm, gradient, summit = false) {
  return { name, category, crest_km: crestKm, length_km: lengthKm, avg_gradient: gradient, summit_finish: summit };
}
function cobbles(name, startKm, lengthKm) { return { kind: "cobbles", start_km: startKm, length_km: lengthKm, name }; }
function gravel(name, startKm, lengthKm) { return { kind: "gravel", start_km: startKm, length_km: lengthKm, name }; }

/**
 * @param {string} profileType @param {string} finaleType @param {number} distanceKm
 * @param {AuthoredClimb[]} climbs @param {any[]} [sectors] @param {Array<[string, number]>} [intermediates]
 */
function route(profileType, finaleType, distanceKm, climbs, sectors = [], intermediates = []) {
  const sorted = climbs.slice().sort((a, b) => a.crest_km - b.crest_km);
  return Object.freeze({
    profile_type: profileType,
    finale_type: finaleType,
    distance_km: distanceKm,
    elevation_gain_m: elevationGainS5({ climbs: sorted, distanceKm }),
    climbs: sorted,
    sprints: [...intermediates.map(([name, km]) => ({ name, km, kind: "intermediate" })), { name: "Finish", km: distanceKm, kind: "finish" }],
    sectors: sectors.slice().sort((a, b) => a.start_km - b.start_km),
  });
}

/**
 * Forslagene. `external_id` er race_pool-noeglen; `pool_name` og `race_class` er katalogets
 * (backend/lib/__fixtures__/racePoolCatalog.prod.json), saa testen kan holde dem fast.
 * `model` er det rigtige loeb ruten er bygget efter; `decisive` er de afgoerende stykker i
 * spillerens sprog.
 */
export const ICONIC_ROUTE_PROPOSALS_8259 = Object.freeze([
  // ── Ardennerne ───────────────────────────────────────────────────────────────────
  {
    external_id: "7afe652a93f56e13", pool_name: "Le Mur de Huy", race_class: "OtherWorldTourB", group: "Ardennerne",
    model: "La Flèche Wallonne",
    decisive: "Tre gange op ad muren i Huy, Côte d'Ereffe og Cherave i finalen, mål på toppen af muren.",
    route: route("hilly", "wall_finish", 199, [
      climb("Côte de Haut-Bois", "3", 62, 1.4, 7.0),
      climb("Côte de Bohissau", "4", 88, 1.8, 4.4),
      climb("Mur de Huy", "2", 111, 1.3, 9.6),
      climb("Côte d'Ereffe", "3", 141, 2.1, 5.9),
      climb("Mur de Huy", "2", 165, 1.3, 9.6),
      climb("Côte d'Ereffe", "3", 181, 2.1, 5.9),
      climb("Côte de Cherave", "3", 193, 1.3, 8.1),
      climb("Mur de Huy", "2", 199, 1.3, 9.6, true),
    ]),
  },
  {
    external_id: "f1c33846c869ff29", pool_name: "Limburgse Klassieker", race_class: "OtherWorldTourB", group: "Ardennerne",
    model: "Amstel Gold Race (klassisk Cauberg-mål)",
    decisive: "Over 30 korte bakker i Limburg, Keutenberg, Eyserbosweg og tre gange Caubergen, mål på toppen.",
    route: route("hilly", "punch", 254, [
      climb("Maasberg", "4", 24, 1.2, 4.6),
      climb("Adsteeg", "4", 40, 0.9, 5.2),
      climb("Gulperberg", "3", 118, 0.9, 8.1),
      climb("Kruisberg", "3", 142, 0.8, 7.9),
      climb("Eyserbosweg", "3", 147, 1.1, 8.1),
      climb("Fromberg", "4", 152, 1.6, 4.2),
      climb("Keutenberg", "3", 160, 1.2, 9.4),
      climb("Caubergen", "3", 190, 1.5, 5.8),
      climb("Geulhemmerberg", "4", 198, 1.0, 6.2),
      climb("Bemelerberg", "4", 211, 0.9, 4.5),
      climb("Caubergen", "3", 230, 1.5, 5.8),
      climb("Geulhemmerberg", "4", 238, 1.0, 6.2),
      climb("Caubergen", "3", 254, 1.5, 5.8, true),
    ]),
  },
  {
    external_id: "50c62405df6384e4", pool_name: "Brabantse Klassieker", race_class: "ProSeries", group: "Ardennerne",
    model: "De Brabantse Pijl",
    decisive: "Lokalrunder i Overijse med Moskesstraat og Schavei, stigende spurt op til stregen.",
    route: route("hilly", "uphill_sprint", 205, [
      climb("Hertstraat", "4", 96, 0.8, 5.5),
      climb("Moskesstraat", "3", 128, 0.6, 9.5),
      climb("Schavei", "3", 142, 1.1, 6.8),
      climb("Moskesstraat", "3", 165, 0.6, 9.5),
      climb("Schavei", "3", 180, 1.1, 6.8),
      climb("Moskesstraat", "3", 194, 0.6, 9.5),
      climb("Hagaard", "4", 205, 0.8, 4.0, true),
    ], [cobbles("Moskesstraat", 127, 0.6), cobbles("Moskesstraat", 164, 0.6), cobbles("Moskesstraat", 193, 0.6)]),
  },
  {
    external_id: "93b6f6325eece92d", pool_name: "Grand Prix de Wallonie Neuf", race_class: "Class1", group: "Ardennerne",
    model: "Grand Prix de Wallonie",
    decisive: "Kuperet tur gennem Namur-provinsen, mål på toppen af Citadellet i Namur.",
    route: route("hilly", "punch", 196, [
      climb("Côte de Floreffe", "4", 72, 1.6, 4.5),
      climb("Côte de Wépion", "3", 141, 2.4, 5.8),
      climb("Côte de la Marlagne", "3", 172, 1.9, 6.1),
      climb("Citadelle de Namur", "3", 196, 2.2, 6.4, true),
    ]),
  },
  // ── Brostensklassikerne ──────────────────────────────────────────────────────────
  {
    external_id: "cz4270-wtb-geraardsberg", pool_name: "Kasseienklassieker van Geraardsbergen", race_class: "OtherWorldTourB", group: "Brosten",
    model: "Omloop Het Nieuwsblad (Muur-finalen)",
    decisive: "Muren i Geraardsbergen og Bosberg til sidst, så 12 flade km til en spurt eller et lille hold.",
    route: route("cobbles", "flat_sprint", 202, [
      climb("Leberg", "4", 120, 0.9, 6.1),
      climb("Berendries", "3", 131, 0.9, 7.0),
      climb("Molenhoek", "4", 150, 0.8, 5.2),
      climb("Muur van Geraardsbergen", "3", 186, 1.1, 9.3),
      climb("Bosberg", "4", 190, 1.0, 5.8),
    ], [
      cobbles("Haaghoek", 112, 2.0), cobbles("Leberg", 119, 0.9), cobbles("Lippenhovestraat", 143, 1.3),
      cobbles("Paddestraat", 148, 2.4), cobbles("Muur van Geraardsbergen", 185, 1.1), cobbles("Bosberg", 189, 1.0),
    ]),
  },
  {
    external_id: "ec2db56c9dacccd5", pool_name: "De Openingsklassieker", race_class: "OtherWorldTourC", group: "Brosten",
    model: "Omloop Het Nieuwsblad (klassisk Gent-mål)",
    decisive: "Sæsonens første brosten: Molenberg, Berendries og Haaghoek, finalen med Lange Munte ind mod Gent.",
    route: route("cobbles", "flat_sprint", 199, [
      climb("Wolvenberg", "4", 82, 0.7, 7.9),
      climb("Molenberg", "3", 128, 0.5, 7.0),
      climb("Berendries", "3", 141, 0.9, 7.0),
      climb("Valkenberg", "4", 148, 0.9, 6.0),
      climb("Eikenberg", "4", 160, 1.2, 5.2),
    ], [
      cobbles("Kerkgate", 77, 1.4), cobbles("Molenberg", 127, 0.5), cobbles("Haaghoek", 152, 2.0),
      cobbles("Paddestraat", 166, 2.4), cobbles("Lange Munte", 180, 2.5),
    ]),
  },
  {
    external_id: "eb71c9752a295a2f", pool_name: "Klassieker van Harelbeke", race_class: "OtherWorldTourB", group: "Brosten",
    model: "E3 Saxo Classic",
    decisive: "Taaienberg, Paterhelling og Oude Kwaremberg i finalen, Tiegemberg som sidste chance, flad målstrækning.",
    route: route("cobbles", "flat_sprint", 208, [
      climb("La Houppe", "4", 54, 1.4, 4.5),
      climb("Kanarieberg", "3", 118, 1.0, 7.7),
      climb("Taaienberg", "3", 131, 0.5, 8.6),
      climb("Boigneberg", "4", 140, 1.2, 5.5),
      climb("Stationberg", "4", 158, 0.7, 3.2),
      climb("Paterhelling", "3", 166, 0.4, 12.5),
      climb("Oude Kwaremberg", "3", 175, 2.2, 4.2),
      climb("Karnemelkbeekstraat", "4", 182, 1.5, 4.6),
      climb("Tiegemberg", "4", 193, 0.8, 5.6),
    ], [
      cobbles("Taaienberg", 130, 0.5), cobbles("Paterhelling", 165, 0.4), cobbles("Oude Kwaremberg", 173, 2.2),
    ]),
  },
  {
    external_id: "d2e66c0bcaff51c3", pool_name: "Westkust Klassieker", race_class: "OtherWorldTourB", group: "Brosten",
    model: "Gent-Wevelgem",
    decisive: "Vind ved kysten, Plugstreets-grusvejene og to gange den stejle Kemmelberg, så flad finale til Wevelgem.",
    route: route("cobbles", "flat_sprint", 251, [
      climb("Mont Noir", "4", 120, 1.0, 5.4),
      climb("Baneberg", "4", 160, 0.8, 7.0),
      climb("Kemmelberg", "3", 172, 0.7, 11.0),
      climb("Monteberg", "4", 185, 0.8, 5.9),
      climb("Kemmelberg", "3", 207, 0.7, 11.0),
      climb("Monteberg", "4", 215, 0.8, 5.9),
    ], [
      gravel("Plugstreets", 142, 1.6), gravel("Plugstreets II", 146, 1.2), cobbles("Kemmelberg", 171, 0.7), cobbles("Kemmelberg", 206, 0.7),
    ]),
  },
  {
    external_id: "870ce2ec9a0e7752", pool_name: "Vlaamse Doortocht", race_class: "OtherWorldTourC", group: "Brosten",
    model: "Dwars door Vlaanderen",
    decisive: "Berg Ten Houte, Oude Kwaremberg og Paterhelling, Nokereberg som sidste stykke før Waregem.",
    route: route("cobbles", "flat_sprint", 184, [
      climb("Kanarieberg", "3", 98, 1.0, 7.7),
      climb("Berg Ten Houte", "3", 112, 1.1, 6.0),
      climb("Oude Kwaremberg", "3", 131, 2.2, 4.2),
      climb("Paterhelling", "3", 136, 0.4, 12.5),
      climb("Vossenhol", "4", 150, 0.9, 6.2),
      climb("Nokereberg", "4", 174, 0.4, 5.7),
    ], [
      cobbles("Holleweg", 104, 1.1), cobbles("Oude Kwaremberg", 129, 2.2), cobbles("Paterhelling", 135, 0.4),
      cobbles("Varent", 156, 1.2), cobbles("Nokereberg", 173, 0.4),
    ]),
  },
  {
    external_id: "cf07b4158a776295", pool_name: "Klassieker van Kuurne", race_class: "ProSeries", group: "Brosten",
    model: "Kuurne-Brussel-Kuurne",
    decisive: "Kluisberg, Oude Kwaremberg og Kanarieberg, så lange flade runder hvor sprinterne kommer tilbage.",
    route: route("cobbles", "flat_sprint", 196, [
      climb("La Houppe", "4", 72, 1.4, 4.5),
      climb("Kluisberg", "3", 96, 1.0, 6.4),
      climb("Oude Kwaremberg", "3", 115, 2.2, 4.2),
      climb("Kanarieberg", "3", 142, 1.0, 7.7),
    ], [cobbles("Oude Kwaremberg", 113, 2.2), cobbles("Ruiterstraat", 125, 0.8), cobbles("Kapelstraat", 136, 1.3)]),
  },
  {
    external_id: "a82d1210a449a18e", pool_name: "Koerse van Nokere", race_class: "ProSeries", group: "Brosten",
    model: "Nokere Koerse",
    decisive: "Runder over den brostensbelagte Nokereberg, mål på toppen af den.",
    route: route("cobbles", "uphill_sprint", 191, [
      climb("Nokereberg", "4", 124, 0.4, 5.7),
      climb("Nokereberg", "4", 145, 0.4, 5.7),
      climb("Nokereberg", "4", 170, 0.4, 5.7),
      climb("Nokereberg", "4", 191, 0.4, 5.7, true),
    ], [cobbles("Herlegemstraat", 115, 1.4), cobbles("Nokereberg", 123, 0.4), cobbles("Nokereberg", 144, 0.4), cobbles("Nokereberg", 169, 0.4), cobbles("Nokereberg", 190, 0.4)]),
  },
  {
    external_id: "cz4270-pro-scheldeprijs", pool_name: "Prijs van de Beneden-Schelde", race_class: "ProSeries", group: "Brosten",
    model: "Scheldeprijs",
    decisive: "Fladt og blæsende med en håndfuld brostensstykker, massespurt i Schoten.",
    route: route("cobbles", "flat_sprint", 199, [], [
      cobbles("Broekstraat", 62, 1.1), cobbles("Hoogstraat", 81, 1.5), cobbles("Kasteeldreef", 104, 1.8), cobbles("Huikstraat", 138, 1.4),
    ]),
  },
  // ── Grus ─────────────────────────────────────────────────────────────────────────
  {
    external_id: "6ada4b5428dfd7b2", pool_name: "Terre di Toscana", race_class: "OtherWorldTourB", group: "Grus",
    model: "Strade Bianche",
    decisive: "Hvide grusveje i Toscana med Monte Sante Marie og Le Tolfe, mål op ad den stejle Via Santa Caterina i Siena.",
    route: route("gravel", "wall_finish", 184, [
      climb("Montaperti", "4", 32, 1.6, 4.5),
      climb("Lucignano d'Asso", "3", 92, 2.6, 5.6),
      climb("Monte Sante Marie", "3", 123, 2.1, 6.3),
      climb("Colle Pinzuto", "3", 166, 1.2, 8.1),
      climb("Le Tolfe", "3", 173, 1.1, 9.3),
      climb("Via Santa Caterina", "3", 184, 0.9, 11.4, true),
    ], [
      gravel("Vidritta", 20, 2.1), gravel("Radi", 39, 4.4), gravel("La Piana", 48, 5.5), gravel("Lucignano", 82, 11.9),
      gravel("Pieve a Salti", 98, 8.0), gravel("San Martino in Grania", 112, 9.5), gravel("Monte Sante Marie", 117, 11.5),
      gravel("Monteaperti", 145, 0.8), gravel("Colle Pinzuto", 163, 2.4), gravel("Le Tolfe", 171, 1.1),
    ]),
  },
  {
    external_id: "cz4270-wta-strade-nord", pool_name: "Strade Bianche del Nord", race_class: "OtherWorldTourA", group: "Grus",
    model: "Paris-Tours (vinmarkernes grusveje)",
    decisive: "Grusveje gennem vinmarkerne og tre korte stigninger de sidste 20 km, flad finale.",
    route: route("gravel", "flat_sprint", 213, [
      climb("Côte de Crochu", "4", 196, 0.6, 7.2),
      climb("Côte de Rochecorbon", "4", 205, 0.5, 8.0),
      climb("Côte de Vouvray", "4", 208, 0.4, 7.4),
    ], [
      gravel("Chemin de la Vallée", 168, 1.8), gravel("Chemin des Vignes", 176, 2.2), gravel("Chemin de Pocé", 184, 1.3),
      gravel("Chemin de Vernou", 190, 1.6), gravel("Chemin de Rochecorbon", 200, 1.1),
    ]),
  },
  // ── Bakkeklassikere og kredsløb ──────────────────────────────────────────────────
  {
    external_id: "8e03312380623984", pool_name: "Clásica del Cantábrico", race_class: "OtherWorldTourB", group: "Bakkeklassikere",
    model: "Clásica San Sebastián",
    decisive: "Jaizkibel og Erlaitz i finalen, den stejle Murgil-top 8 km før mål, nedkørsel og kort flad finale i byen.",
    route: route("hilly", "descent", 223, [
      climb("Alto de Garate", "3", 52, 4.1, 5.1),
      climb("Alto de Gurutze", "3", 108, 4.5, 4.8),
      climb("Alto de Jaizkibel", "2", 170, 7.9, 5.6),
      climb("Alto de Erlaitz", "2", 190, 4.6, 9.4),
      climb("Murgil Tontorra", "2", 215, 1.9, 10.1),
    ]),
  },
  {
    external_id: "efb4c1e793743dbf", pool_name: "Hamburger Klassiker", race_class: "OtherWorldTourB", group: "Bakkeklassikere",
    model: "Hamburg Cyclassics",
    decisive: "Fladt med fire passager af den korte, stejle Waseberg, massespurt i byen.",
    route: route("rolling", "flat_sprint", 205, [
      climb("Waseberg", "4", 120, 0.7, 7.0),
      climb("Waseberg", "4", 152, 0.7, 7.0),
      climb("Waseberg", "4", 172, 0.7, 7.0),
      climb("Waseberg", "4", 190, 0.7, 7.0),
    ]),
  },
  {
    external_id: "64a2a18688621713", pool_name: "Grand Prix du Saint-Laurent", race_class: "OtherWorldTourB", group: "Bakkeklassikere",
    model: "Grand Prix Cycliste de Québec",
    decisive: "Runder i den gamle by med tre korte mure pr. omgang, stigende spurt op ad Grande Allée.",
    route: route("hilly", "uphill_sprint", 201, [
      climb("Côte de la Montagne", "3", 151, 0.4, 10.0),
      climb("Côte de la Potasse", "4", 152, 0.4, 9.0),
      climb("Côte de la Montagne", "3", 163, 0.4, 10.0),
      climb("Côte de la Potasse", "4", 164, 0.4, 9.0),
      climb("Côte de la Montagne", "3", 176, 0.4, 10.0),
      climb("Côte de la Potasse", "4", 177, 0.4, 9.0),
      climb("Côte de la Montagne", "3", 188, 0.4, 10.0),
      climb("Côte de la Potasse", "4", 189, 0.4, 9.0),
      climb("Grande Allée", "4", 201, 1.0, 4.0, true),
    ]),
  },
  {
    external_id: "fa86d85ee0dd3268", pool_name: "Grand Prix du Mont-Royal", race_class: "OtherWorldTourB", group: "Bakkeklassikere",
    model: "Grand Prix Cycliste de Montréal",
    decisive: "Runder over Mont-Royal med Camillien-Houde og Polytechnique, stigende spurt op ad Avenue du Parc.",
    route: route("hilly", "uphill_sprint", 221, [
      climb("Côte Camillien-Houde", "3", 166, 1.8, 8.0),
      climb("Côte de la Polytechnique", "4", 170, 0.8, 6.0),
      climb("Côte Camillien-Houde", "3", 179, 1.8, 8.0),
      climb("Côte de la Polytechnique", "4", 182, 0.8, 6.0),
      climb("Côte Camillien-Houde", "3", 191, 1.8, 8.0),
      climb("Côte de la Polytechnique", "4", 194, 0.8, 6.0),
      climb("Côte Camillien-Houde", "3", 203, 1.8, 8.0),
      climb("Côte de la Polytechnique", "4", 207, 0.8, 6.0),
      climb("Côte Camillien-Houde", "3", 215, 1.8, 8.0),
      climb("Avenue du Parc", "4", 221, 0.6, 4.0, true),
    ]),
  },
  {
    external_id: "6f347eeb9c92269a", pool_name: "Giro Emiliano", race_class: "ProSeries", group: "Bakkeklassikere",
    model: "Giro dell'Emilia",
    decisive: "Fem gange op ad San Luca over Bologna, mål på toppen af den sidste.",
    route: route("hilly", "punch", 199, [
      climb("Monte Calderaro", "3", 62, 3.4, 5.6),
      climb("San Luca", "2", 147, 2.1, 9.7),
      climb("San Luca", "2", 160, 2.1, 9.7),
      climb("San Luca", "2", 173, 2.1, 9.7),
      climb("San Luca", "2", 186, 2.1, 9.7),
      climb("San Luca", "2", 199, 2.1, 9.7, true),
    ]),
  },
  {
    external_id: "a279269a83cbcb86", pool_name: "Trofeo delle Tre Valli", race_class: "ProSeries", group: "Bakkeklassikere",
    model: "Tre Valli Varesine",
    decisive: "Runder ved Varese med Casbeno og Montello, stigende spurt op til stregen i Varese.",
    route: route("hilly", "uphill_sprint", 196, [
      climb("Brinzio", "3", 58, 4.2, 4.6),
      climb("Casbeno", "4", 142, 1.1, 5.0),
      climb("Montello", "3", 148, 1.0, 8.0),
      climb("Casbeno", "4", 166, 1.1, 5.0),
      climb("Montello", "3", 172, 1.0, 8.0),
      climb("Casbeno", "4", 190, 1.1, 5.0),
      climb("Via Sacco", "4", 196, 0.7, 4.0, true),
    ]),
  },
  {
    external_id: "2e2665f78d6c5aa7", pool_name: "Milano–Piemonte", race_class: "ProSeries", group: "Bakkeklassikere",
    model: "Milano-Torino",
    decisive: "Flad vej fra Milano, så to gange op ad Superga, mål på toppen ved basilikaen.",
    route: route("mountain", "long_climb", 186, [
      climb("Superga", "1", 160, 4.9, 9.1),
      climb("Superga", "1", 186, 4.9, 9.1, true),
    ]),
  },
  {
    external_id: "fa891fca48cb42a4", pool_name: "Classique du Morbihan", race_class: "ProSeries", group: "Bakkeklassikere",
    model: "Grand Prix de Plumelec-Morbihan",
    decisive: "Runder i Bretagne over Côte de Cadoudal, mål på toppen af den.",
    route: route("hilly", "punch", 186, [
      climb("Côte de Cadoudal", "3", 137, 1.7, 6.2),
      climb("Côte de Cadoudal", "3", 150, 1.7, 6.2),
      climb("Côte de Cadoudal", "3", 163, 1.7, 6.2),
      climb("Côte de Cadoudal", "3", 176, 1.7, 6.2),
      climb("Côte de Cadoudal", "3", 186, 1.7, 6.2, true),
    ]),
  },
  {
    external_id: "d54bc27ea5e20a56", pool_name: "Coppa di Peccioli", race_class: "ProSeries", group: "Bakkeklassikere",
    model: "Coppa Sabatini",
    decisive: "Runder i de toscanske bakker med stigningen til Peccioli, mål på toppen.",
    route: route("hilly", "punch", 199, [
      climb("Montefoscoli", "3", 74, 3.0, 5.1),
      climb("Peccioli", "3", 158, 1.6, 5.4),
      climb("Peccioli", "3", 175, 1.6, 5.4),
      climb("Peccioli", "3", 199, 1.6, 5.4, true),
    ]),
  },
  {
    external_id: "9dab19acc94fe360", pool_name: "Classique de l'Ardèche", race_class: "ProSeries", group: "Bakkeklassikere",
    model: "Faun-Ardèche Classic",
    decisive: "Lange stigninger i Ardèche, sidste top ved Saint-Romain-de-Lerps 10 km før mål, nedkørsel til Guilherand-Granges.",
    route: route("hilly", "descent", 171, [
      climb("Col de la Mûre", "3", 48, 4.6, 5.0),
      climb("Côte de Lalouvesc", "3", 98, 4.2, 4.8),
      climb("Col des Mûres", "3", 132, 4.6, 5.0),
      climb("Côte de Saint-Romain-de-Lerps", "3", 161, 4.5, 5.6),
    ]),
  },
  {
    external_id: "0ddf3336139701a9", pool_name: "Trofeo Laigueglia Minore", race_class: "Class2", group: "Bakkeklassikere",
    model: "Trofeo Laigueglia",
    decisive: "Runder ved den liguriske kyst over Colla Micheri, sidste top 7 km før mål, nedkørsel til Laigueglia.",
    route: route("hilly", "descent", 202, [
      climb("Testico", "3", 64, 6.1, 4.4),
      climb("Colla Micheri", "3", 150, 2.3, 6.1),
      climb("Colla Micheri", "3", 172, 2.3, 6.1),
      climb("Colla Micheri", "3", 195, 2.3, 6.1),
    ]),
  },
  {
    external_id: "cz4215-c1-fourmies", pool_name: "Grand Prix de Fourmies Neuf", race_class: "Class1", group: "Bakkeklassikere",
    model: "Grand Prix de Fourmies",
    decisive: "Runder i Avesnois med to korte bakker pr. omgang, massespurt i Fourmies.",
    route: route("rolling", "flat_sprint", 205, [
      climb("Côte de Wignehies", "4", 138, 0.9, 4.6),
      climb("Côte de Rue de la République", "4", 158, 0.6, 5.0),
      climb("Côte de Wignehies", "4", 178, 0.9, 4.6),
    ]),
  },
]);

/** De faste ruters race_pool-noegler (seniorens external_id). */
export const ICONIC_ROUTE_EXTERNAL_IDS_8259 = Object.freeze(new Set(ICONIC_ROUTE_PROPOSALS_8259.map((p) => p.external_id)));

/**
 * #8830: maa loebet koere en haandlavet rute ud over monumenterne? Ja for de faste ruter
 * her og for deres ungdomsudgaver (U23/junior har seniorens noegle bag et praefiks).
 * @param {{ external_id?: string | null } | null | undefined} race
 */
export function isFixedIconicRouteRace(race) {
  const id = race?.external_id;
  if (id == null) return false;
  const senior = parseMiniEditionExternalId(id)?.seniorExternalId ?? String(id);
  return ICONIC_ROUTE_EXTERNAL_IDS_8259.has(senior);
}

/** Ruterne som race_identity-seedens form (database/seed/race_identity.json), til migrationen. */
export function iconicRouteSeedEntries8259(externalIds = ICONIC_ROUTE_PROPOSALS_8259.map((p) => p.external_id)) {
  const wanted = new Set(externalIds);
  return ICONIC_ROUTE_PROPOSALS_8259.filter((p) => wanted.has(p.external_id))
    .map((p) => ({ external_id: p.external_id, race_identity_type: null, signature: null, authored_route: p.route }));
}
