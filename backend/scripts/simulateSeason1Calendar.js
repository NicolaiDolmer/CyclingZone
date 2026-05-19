// Engangs-simulation: kør selectFirstSeasonRaces mod fuld produktion-pool
// for at verificere algoritmens output FØR brugeren bruger admin-UI.
//
// Brug:
//   node backend/scripts/simulateSeason1Calendar.js
//
// Pool-data er hentet via supabase MCP 2026-05-19; opdatér ved schema-ændring.

import { selectFirstSeasonRaces, STAGE_RACE_PRIORITY } from "../lib/seasonRaceSelection.js";

const POOL = [
  { id: "eedcedd3", name: "4 Jours de Dunkerque / Grand Prix des Hauts-de-France", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "5b2aa06a", name: "ADAC Cyclassics", race_class: "OtherWorldTourB", race_type: "single", stages: 1 },
  { id: "8b438339", name: "AlUla Tour", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "37bb66d1", name: "Amstel Gold Race", race_class: "OtherWorldTourB", race_type: "single", stages: 1 },
  { id: "0e153d92", name: "Arctic Race of Norway", race_class: "ProSeries", race_type: "stage_race", stages: 4 },
  { id: "75d47887", name: "Baloise Belgium Tour", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "3ac153fd", name: "Boucles de la Mayenne - Crédit Mutuel", race_class: "ProSeries", race_type: "stage_race", stages: 4 },
  { id: "86d04b40", name: "Bredene Koksijde Classic", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "6b68f823", name: "Bretagne Classic - CIC", race_class: "OtherWorldTourB", race_type: "single", stages: 1 },
  { id: "9044c74f", name: "Brussels Cycling Classic", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "7a44744f", name: "Circuit Franco-Belge", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "da6c983f", name: "Clasica de Almeria", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "a7495fac", name: "Classique Dunkerque / Grand Prix des Hauts-de-France", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "3b9debe0", name: "Copenhagen Sprint", race_class: "OtherWorldTourC", race_type: "single", stages: 1 },
  { id: "4b3a0665", name: "Coppa Bernocchi - GP Banco BPM", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "4d18100c", name: "CRO Race", race_class: "ProSeries", race_type: "stage_race", stages: 6 },
  { id: "f4570416", name: "Czech Tour", race_class: "ProSeries", race_type: "stage_race", stages: 4 },
  { id: "664906ad", name: "Danilith Nokere Koerse", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "dcca2458", name: "De Brabantse Pijl - La Flèche Brabançonne", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "4ed04e13", name: "Donostia San Sebastian Klasikoa", race_class: "OtherWorldTourB", race_type: "single", stages: 1 },
  { id: "f76412f1", name: "Dwars door Vlaanderen - A travers la Flandre", race_class: "OtherWorldTourC", race_type: "single", stages: 1 },
  { id: "d9dfd627", name: "E3 Saxo Classic", race_class: "OtherWorldTourB", race_type: "single", stages: 1 },
  { id: "18aa9106", name: "Eschborn-Frankfurt", race_class: "OtherWorldTourC", race_type: "single", stages: 1 },
  { id: "b3fcb61a", name: "Ethias-Tour de Wallonie", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "c1e96454", name: "Faun Drôme Classic", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "f4a5194b", name: "Faun-Ardèche Classic", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "cf33157d", name: "Figueira Champions Classic", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "c04f7065", name: "Flandrien O Classic", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "406275cb", name: "Giro d'Italia", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 },
  { id: "3ebe0154", name: "Giro del Veneto", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "673de2d2", name: "Giro dell'Emilia", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "8cae4ab6", name: "GP de Fourmies / La Voix du Nord", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "5eeaac4e", name: "GP Industria & Artigianato", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "3086910c", name: "Gran Piemonte", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "34d88ff0", name: "Gran Premio città di Peccioli - Coppa Sabatini", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "e4c3b3f8", name: "Gran Premio Miguel Indurain", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "35e2f8db", name: "Grand Prix Cycliste de Montréal", race_class: "OtherWorldTourB", race_type: "single", stages: 1 },
  { id: "0695ba90", name: "Grand Prix Cycliste de Québec", race_class: "OtherWorldTourB", race_type: "single", stages: 1 },
  { id: "f23aefa2", name: "Grand Prix de Denain - Porte du Hainaut", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "a32480cd", name: "Grand Prix du Morbihan", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "85c9ec25", name: "Il Lombardia", race_class: "Monuments", race_type: "single", stages: 1 },
  { id: "7da93703", name: "In Flanders Fields - From Middelkerke", race_class: "OtherWorldTourB", race_type: "single", stages: 1 },
  { id: "43324da3", name: "Itzulia Basque Country", race_class: "OtherWorldTourB", race_type: "stage_race", stages: 6 },
  { id: "911e7be0", name: "Kuurne - Brussel - Kuurne", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "7ec617f1", name: "La Flèche Wallonne", race_class: "OtherWorldTourB", race_type: "single", stages: 1 },
  { id: "9f19dae2", name: "La Vuelta Ciclista a España", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 },
  { id: "74ddd2fb", name: "Lidl Deutschland Tour", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "d3e0c532", name: "Liège-Bastogne-Liège", race_class: "Monuments", race_type: "single", stages: 1 },
  { id: "91074383", name: "Lloyds Tour of Britain", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "82b7b4d1", name: "Lotto Grand Prix de Wallonie", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "12db2474", name: "Mapei Cadel Evans Great Ocean Road Race", race_class: "OtherWorldTourC", race_type: "single", stages: 1 },
  { id: "271f2f4c", name: "Maryland Cycling Classic", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "4c0bb6de", name: "Milano - Torino", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "e2d345eb", name: "Milano-Sanremo", race_class: "Monuments", race_type: "single", stages: 1 },
  { id: "40822b67", name: "Muscat Classic", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "1bed556b", name: "Omloop Nieuwsblad", race_class: "OtherWorldTourC", race_type: "single", stages: 1 },
  { id: "96a21771", name: "Paris - Tours Elite", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "dfd7f272", name: "Paris-Nice", race_class: "OtherWorldTourA", race_type: "stage_race", stages: 8 },
  { id: "0ff1afb8", name: "Paris-Roubaix", race_class: "Monuments", race_type: "single", stages: 1 },
  { id: "9eb734cd", name: "Petronas Le Tour de Langkawi", race_class: "ProSeries", race_type: "stage_race", stages: 8 },
  { id: "6fb8ea71", name: "PostNord Tour of Denmark", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "01a018d8", name: "Presidential Cycling Tour of Türkiye", race_class: "ProSeries", race_type: "stage_race", stages: 8 },
  { id: "b07893d9", name: "Région Pays de la Loire Tour", race_class: "ProSeries", race_type: "stage_race", stages: 4 },
  { id: "6e7c05e3", name: "Renewi Tour", race_class: "OtherWorldTourB", race_type: "stage_race", stages: 5 },
  { id: "410b6daf", name: "Ronde Van Brugge - Tour of Bruges", race_class: "OtherWorldTourC", race_type: "single", stages: 1 },
  { id: "eb6c5692", name: "Ronde van Vlaanderen", race_class: "Monuments", race_type: "single", stages: 1 },
  { id: "aed6773c", name: "Santos Tour Down Under", race_class: "OtherWorldTourA", race_type: "stage_race", stages: 6 },
  { id: "0d87890e", name: "Scheldeprijs", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "80fec0c7", name: "Skoda Tour de Luxembourg", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "7ab779bc", name: "Sparkassen Münsterland Giro", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "c6825b5d", name: "Strade Bianche", race_class: "OtherWorldTourB", race_type: "single", stages: 1 },
  { id: "c6de8d61", name: "Surf Coast Classic", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "4d944a46", name: "Tirreno-Adriatico", race_class: "OtherWorldTourA", race_type: "stage_race", stages: 7 },
  { id: "eadc7044", name: "Tour Auvergne - Rhône-Alpes", race_class: "OtherWorldTourA", race_type: "stage_race", stages: 8 },
  { id: "68a40816", name: "Tour de France", race_class: "TourFrance", race_type: "stage_race", stages: 21 },
  { id: "877779f4", name: "Tour de Hongrie", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "d357ba7a", name: "Tour de Pologne", race_class: "OtherWorldTourB", race_type: "stage_race", stages: 7 },
  { id: "1e74bd3e", name: "Tour de Romandie", race_class: "OtherWorldTourA", race_type: "stage_race", stages: 6 },
  { id: "0d8005fd", name: "Tour de Suisse", race_class: "OtherWorldTourA", race_type: "stage_race", stages: 5 },
  { id: "2c4e3193", name: "Tour of Guangxi", race_class: "OtherWorldTourC", race_type: "stage_race", stages: 6 },
  { id: "fa14cf94", name: "Tour of Hainan", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "42dd9c27", name: "Tour of Magnificent Qinghai", race_class: "ProSeries", race_type: "stage_race", stages: 8 },
  { id: "50efe705", name: "Tour of Norway", race_class: "ProSeries", race_type: "stage_race", stages: 4 },
  { id: "1139087d", name: "Tour of Oman", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "a7d79bfa", name: "Tour of Slovenia", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "8727c10e", name: "Tour of the Alps", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "5bd3fb8c", name: "Tre Valli Varesine", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "7594dab7", name: "Tro-Bro Léon", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "af6002c0", name: "Trofeo Laigueglia", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "f7fb5abf", name: "UAE Tour", race_class: "OtherWorldTourC", race_type: "stage_race", stages: 7 },
  { id: "9b1cb32f", name: "Utsunomiya Japan Cup Road Race", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "c383a23d", name: "Veneto Classic", race_class: "ProSeries", race_type: "single", stages: 1 },
  { id: "8a28d8fc", name: "Volta ao Algarve em Bicicleta", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "840a26b2", name: "Volta Ciclista a Catalunya", race_class: "OtherWorldTourB", race_type: "stage_race", stages: 7 },
  { id: "d9482816", name: "Volta Comunitat Valenciana", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "fd89317e", name: "Vuelta a Andalucía Ruta Ciclista del Sol", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
  { id: "d7b0b4b6", name: "Vuelta a Burgos", race_class: "ProSeries", race_type: "stage_race", stages: 5 },
];

console.log(`\n=== POOL ===\n${POOL.length} races total`);
console.log(`ProSeries: ${POOL.filter((r) => r.race_class === "ProSeries").length}`);
console.log(`WT-classes: ${POOL.filter((r) => r.race_class !== "ProSeries").length}`);

const result = selectFirstSeasonRaces(POOL, { raceDaysTarget: 60 });

console.log(`\n=== RESULT (quota=8, target=60) ===`);
console.log(`Selected: ${result.selectedCount} races, ${result.totalRaceDays} race-days`);
console.log(`Omitted: ${result.omitted.length} races`);

const stageRaces = result.selected.filter((r) => r.race_type === "stage_race");
const singles = result.selected.filter((r) => r.race_type === "single");
console.log(`\nBreakdown: ${stageRaces.length} stage races (${stageRaces.reduce((s, r) => s + r.stages, 0)} race-days) + ${singles.length} singles (${singles.length} race-days)`);

console.log(`\n=== STAGE RACES (in selection order) ===`);
stageRaces.forEach((r, i) => {
  const fromWhitelist = STAGE_RACE_PRIORITY.includes(r.name) ? "★" : " ";
  console.log(`  ${i + 1}. ${fromWhitelist} ${r.name} (${r.stages}d)`);
});

console.log(`\n=== SINGLES (alphabetic) ===`);
singles.forEach((r, i) => console.log(`  ${i + 1}. ${r.name}`));

console.log(`\n=== OMITTED ===`);
const omittedStage = result.omitted.filter((r) => r.race_type === "stage_race");
const omittedSingle = result.omitted.filter((r) => r.race_type === "single");
console.log(`  Stage races skipped: ${omittedStage.length}`);
omittedStage.forEach((r) => console.log(`    - ${r.name} (${r.stages}d, ${r.reason})`));
console.log(`  Singles skipped: ${omittedSingle.length}`);
omittedSingle.forEach((r) => console.log(`    - ${r.name} (${r.reason})`));
