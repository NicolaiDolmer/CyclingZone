// #6080: en ÆGTE v4-etape (kuperet, 165 km, 1/10 2026) som fixture til
// mellemtider/tidstab i løbsfilmen. Tidslinjen er motorens egen, uændret
// bortset fra at rytter-id'er er erstattet med et løbenummer (r0..r144) og
// holdet anonymiseret: "own" = ét menneskehold (Hold A), resten Hold B.
// Rytternavne er spillets egne (genererede) ryttere.

const RIDERS = [
  "Harry|Foster|GB|1|66|+16:53", "Pieter|Cornelis|NL|0|112|+17:36", "Óscar|Reyes|CO|0|45|+16:53", "Qiang|Li|CN|0|71|+17:36",
  "Yuto S.|Abe|JP|0|61|+16:53", "Alejandro A.|Ortega|CO|0|138|+17:36", "Dylan|Fletcher|NZ|0|90|+17:36", "Julian|Albrecht|CH|0|119|+17:36",
  "Bin|Chen|CN|0|124|+17:36", "Jie|Lin|CN|0|100|+17:36", "Leon|Müller|AT|0|74|+17:36", "Iván A.|Quintero|CO|0|130|+17:36",
  "Tyler|Radcliffe|US|0|70|+17:36", "William|Eriksson|DK|0|133|+17:36", "Julien|Faure|FR|0|43|+16:53", "Romain|Girard|FR|0|42|+16:53",
  "Iván A.|Bravo|CO|0|64|+16:53", "Qiang|Yang|CN|0|58|+16:53", "Javier M.|Delgado|ES|0|120|+17:36", "Hamza|Saadi|DZ|0|59|+16:53",
  "Seojun H.|Oh|KR|0|131|+17:36", "Alessandro|Bianchi|IT|0|55|+16:53", "Diego|Pardo|ES|0|41|+16:53", "Diego|Vega|CO|0|37|+16:06",
  "Mason|Hunt|GB|0|123|+17:36", "Long|Sun|CN|0|115|+17:36", "Marc|Vega|ES|0|89|+17:36", "Viktor|Mathisen|DK|0|23|+6:42",
  "Yuto|Takahashi|JP|1|82|+17:36", "Kilian|Schäfer|DE|0|15|+5:16", "Valentin|Vasseur|FR|0|68|+17:36", "Bram|Vermeulen|NL|0|110|+17:36",
  "Florian|Brunet|FR|0|52|+16:53", "Tarek|Khelifi|DZ|0|106|+17:36", "Eunwoo|Yoon|KR|0|26|+7:18", "Yuto|Inoue|JP|0|31|+13:07",
  "Žan|Jelen|CZ|0|39|+16:06", "Mario|López|AR|0|56|+16:53", "Tobias|Ngata|AU|0|84|+17:36", "Kaito T.|Goto|JP|0|99|+17:36",
  "Gašper|Šuštar|CZ|0|76|+17:36", "Cristian S.|Gentile|IT|0|27|+7:18", "James|Dawson|GB|0|116|+17:36", "Andrés|Castro|CO|0|72|+17:36",
  "Oliver|Whitfield|AU|0|19|+5:36", "Hugo|Moreau|FR|0|32|+13:31", "Viktor|Andersen|DK|0|24|+7:18", "Jasper|Segers|BE|0|47|+16:53",
  "Hugo P.|Torres|AR|0|85|+17:36", "Mathis|Bernard|FR|0|65|+16:53", "Marco|Brivio|IT|0|91|+17:36", "Daniel|Quintero|CO|0|9|+1:35",
  "Leon|Duda|PL|0|145|+17:36", "Piotr|Zieliński|CZ|0|6|+1:35", "Federico|Brivio|IT|0|5|+1:35", "Daan|Goossens|NL|0|18|+5:16",
  "Andrés|Lozano|ES|0|127|+17:36", "Taiga|Hayashi|JP|0|35|+16:06", "Axel|Aas|SE|0|79|+17:36", "Ruben|Coppens|BE|0|44|+16:53",
  "Shun|Kimura|JP|0|21|+6:42", "Tobias|Sørensen|NO|0|88|+17:36", "Joris|Hendrickx|BE|0|14|+5:16", "Cheng W.|Zhao|CN|0|97|+17:36",
  "Riccardo|Sartori|IT|0|118|+17:36", "Amanuel|Habineza|ER|0|93|+17:36", "Jie|Chen|CN|0|28|+7:18", "Tomáš|Sokol|SI|0|81|+17:36",
  "Maarten|Segers|BE|0|11|+1:35", "Gabriele|Ferrara|IT|0|48|+16:53", "Connor J.|Smith|US|0|60|+16:53", "Adel|Ouedraogo|DZ|1|73|+17:36",
  "Théo|Colin|FR|0|144|+17:36", "Andrea|Riva|IT|0|1|+0:00", "Merhawi|Tekle|RW|0|36|+16:06", "Charlie|Thomas|GB|0|125|+17:36",
  "Andrea|Rizzo|IT|0|40|+16:33", "Carlos|Sánchez|ES|0|12|+1:35", "Aitor H.|Pardo|CO|0|126|+17:36", "Jakob|Holm|NO|0|50|+16:53",
  "Anders|Sandberg|NO|0|134|+17:36", "Hugo|Delgado|CO|0|20|+6:42", "Anders|Larsen|DK|0|129|+17:36", "Kai H.|Xie|CN|0|103|+17:36",
  "Florian|Vasseur|FR|0|136|+17:36", "Frederik|Vik|DK|0|122|+17:36", "Ayoub|Ouedraogo|DZ|0|78|+17:36", "Gonzalo|Vega|ES|0|80|+17:36",
  "Valentin|Colin|FR|0|95|+17:36", "Miłosz|Pietrzak|PL|0|121|+17:36", "Diego|Torres|ES|1|135|+17:36", "Daan|Hendrickx|BE|1|114|+17:36",
  "Daan|Janssen|NL|0|63|+16:53", "Qiang L.|Ma|CN|0|107|+17:36", "Thomas|Mitchell|AU|0|75|+17:36", "Miloš|Rus|CZ|0|139|+17:36",
  "Mads|Solberg|NO|0|8|+1:35", "Andrés|Ortega|ES|0|101|+17:36", "Hanbin|Hong|KR|0|137|+17:36", "Žan|Horák|PL|0|132|+17:36",
  "Bilal|Bouazza|DZ|1|143|+17:36", "Hui|Gao|CN|0|34|+16:06", "George|Whitfield|AU|0|16|+5:16", "Mehdi|Mansouri|DZ|0|96|+17:36",
  "Sven|Mertens|NL|0|25|+7:18", "Luka|Kučera|SI|0|38|+16:06", "Changmin|Yu|KR|0|105|+17:36", "Iván G.|Aguilar|CO|0|140|+17:36",
  "Niels|Vermeulen|BE|0|67|+17:36", "Antoni|Kozak|PL|0|57|+16:53", "Wout|Peeters|BE|0|17|+5:16", "Yamato|Hashimoto|JP|0|94|+17:36",
  "Vojtěch|Procházka|SI|0|54|+16:53", "Patryk|Kučera|SI|0|77|+17:36", "Kilian|Brandt|DE|0|30|+7:37", "Hao|Huang|CN|0|46|+16:53",
  "Pablo|Pardo|AR|0|102|+17:36", "Mathias|Andersen|DK|0|62|+16:53", "Sebastian|Larsen|DK|0|69|+17:36", "Blake|Whitfield|CA|0|7|+1:35",
  "Tao|Gao|CN|0|33|+16:06", "Alessandro|Palmieri|IT|0|111|+17:36", "Henrique|Lopes|BR|0|87|+17:36", "Bert|De Smet|NL|0|92|+17:36",
  "Matheus|Mendes|PT|0|113|+17:36", "Hugo|Marchand|FR|0|141|+17:36", "Nicolò|Riva|IT|0|29|+7:37", "Pieter|Vermeulen|NL|0|86|+17:36",
  "Dawid|Zupan|PL|0|51|+16:53", "Sander|Mertens|BE|0|10|+1:35", "Pieter|De Jong|BE|0|2|+0:00", "Owen|Hughes|AU|0|22|+6:42",
  "Jasper|Tielemans|BE|0|49|+16:53", "Yonas|Mulueta|ER|0|53|+16:53", "Anders|Nieminen|NO|0|104|+17:36", "Hyun|Oh|KR|0|128|+17:36",
  "Nicolás|Escobar|CO|0|83|+17:36", "Jinwoo|Oh|KR|0|108|+17:36", "Carlos|Fuentes|CO|0|117|+17:36", "Taeyang|Shin|KR|0|98|+17:36",
  "Adrien|Charpentier|FR|0|4|+0:00", "Johan|Aas|NO|1|13|+2:32", "Jakub|Adamczyk|PL|0|3|+0:00", "Minjun|Jung|KR|0|109|+17:36",
  "Caleb|Jamieson|AU|0|142|+17:36",
];

export const OWN_TEAM_ID = "team-a";
const OTHER_TEAM_ID = "team-b";
const id = (i) => `r${i}`;

export const SPLIT_RIDERS = RIDERS.map((line, i) => {
  const [firstname, lastname, nat, own, rank, finishTime] = line.split("|");
  return {
    id: id(i), firstname, lastname, nationality_code: nat.toLowerCase(),
    teamId: own === "1" ? OWN_TEAM_ID : OTHER_TEAM_ID, rank: Number(rank), finishTime,
  };
});

const ids = (list) => list.map(id);
const range = (spec) => spec.flatMap((s) => (Array.isArray(s) ? Array.from({ length: s[1] - s[0] + 1 }, (_, k) => s[0] + k) : [s]));

const GRUPPETTO_4001 = range([[0, 26], 28, [30, 33], [36, 40], 42, 43, [47, 50], 52, 56, 57, 58, 59, 61, 63, 64, 65, 67, [69, 72], [74, 76], [78, 80], [82, 95], [97, 101], 103, [105, 109], [111, 113], [115, 118], [120, 125], 127, 128, [132, 139], 143, 144]);
const CHASE_7002 = range([[0, 3], [5, 16], [18, 22], [24, 26], 28, [30, 31], 33, [37, 40], 42, 43, [47, 50], 52, 56, 58, 59, 61, [63, 65], 67, 69, 71, 72, 75, 78, 80, [82, 91], [93, 95], [97, 100], 103, [106, 109], [111, 113], 115, 116, 118, [121, 125], 127, 128, [132, 139], 143, 144]);
const CHASE_12001 = range([1, 3, [5, 13], 18, 20, [24, 26], 28, [30, 31], 33, [38, 40], 42, 43, 48, 50, 52, 56, 58, 61, [63, 65], 67, 71, 72, 75, 78, 80, [82, 91], [93, 95], [97, 100], 103, [106, 108], 111, 113, 116, 118, [121, 125], 127, [134, 139], 143, 144]);

const gap = (km, groupId, s) => ({ km, type: "gap_update", params: { group_id: groupId, gap_seconds: s } });

export const SPLIT_TIMELINE = {
  race_id: "race-6080",
  stage_number: 1,
  timeline_version: 2,
  events: [
    { km: 0, type: "stage_start", params: { distance_km: 165, field_count: 145, profile_type: "hilly" } },
    { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ids([35, 44, 73, 114, 126, 130, 140, 142]) } },
    gap(16.75, "peloton-0", 82), gap(33.5, "peloton-0", 283),
    { km: 43.41, type: "incident", params: { kind: "crash", outcome: "time_loss", rider_id: id(51), severity: "light", injury_days: null, helper_assist: false, time_loss_seconds: 14.19 } },
    gap(50.25, "peloton-0", 387.64), gap(50.25, "solo-m10-2-0", 401.83), gap(67, "solo-m10-2-0", 393.45),
    { km: 72, type: "peloton_splits", params: { cause: "mixed", group_id: "chase-4000", rider_ids: ids([35, 44, 114, 126]), gap_seconds: 41.48, source_group_id: "breakaway-0" } },
    { km: 72, type: "peloton_splits", params: { cause: "mixed", group_id: "gruppetto-4001", rider_ids: ids(GRUPPETTO_4001), gap_seconds: 46.98, source_group_id: "peloton-0" } },
    gap(72, "chase-4000", 41.48), gap(72, "peloton-0", 407.75), gap(72, "solo-m10-2-0", 410.09), gap(72, "gruppetto-4001", 454.73),
    { km: 72, type: "kom_passage", params: { top: [{ points: 2, rider_id: id(73) }, { points: 1, rider_id: id(130) }], name: "Mont Saint-Roch", category: "3" } },
    { km: 77.8, type: "group_merged", params: { group_id: "solo-m10-2-0", rider_ids: ids([51]), into_group_id: "peloton-0" } },
    gap(77.8, "chase-4000", 49.84), gap(77.8, "peloton-0", 403.17), gap(77.8, "gruppetto-4001", 459.06),
    gap(95.8, "chase-4000", 123.62), gap(95.8, "peloton-0", 368.63), gap(95.8, "gruppetto-4001", 521.64),
    { km: 102, type: "peloton_splits", params: { cause: "climb_deficit", group_id: "solo-7000", rider_ids: ids([140]), gap_seconds: 27.96, source_group_id: "breakaway-0" } },
    { km: 102, type: "peloton_splits", params: { cause: "climb_deficit", group_id: "chase-7001", rider_ids: ids([35, 114, 126]), gap_seconds: 27.71, source_group_id: "chase-4000" } },
    { km: 102, type: "peloton_splits", params: { cause: "mixed", group_id: "chase-7002", rider_ids: ids(CHASE_7002), gap_seconds: 49.64, source_group_id: "gruppetto-4001" } },
    { km: 102, type: "peloton_splits", params: { cause: "mixed", group_id: "gruppetto-7003", rider_ids: ids([27, 34, 41, 45, 46, 60, 66, 81, 104, 131]), gap_seconds: 45.54, source_group_id: "peloton-0" } },
    gap(102, "solo-7000", 12.89), gap(102, "chase-4000", 223.11), gap(102, "chase-7001", 250.81), gap(102, "peloton-0", 361.22),
    gap(102, "gruppetto-7003", 406.76), gap(102, "gruppetto-4001", 684.18), gap(102, "chase-7002", 733.82),
    { km: 102, type: "kom_passage", params: { top: [{ points: 5, rider_id: id(142) }, { points: 3, rider_id: id(130) }], name: "Col de la Colombière", category: "2" } },
    { km: 107, type: "intermediate_sprint", params: { top: [{ points: 20, rider_id: id(73), bonus_seconds: 2 }], name: "Intermediate Sprint" } },
    { km: 109.1, type: "finale_attack", params: { group_id: "chase-8000", direction: "descent", rider_ids: ids([126, 114]), gained_seconds: 10 } },
    { km: 109.1, type: "finale_attack", params: { group_id: "breakaway-8001", direction: "descent", rider_ids: ids([29, 62, 110, 102, 55]), gained_seconds: 10 } },
    { km: 109.1, type: "finale_attack", params: { group_id: "solo-8002", direction: "descent", rider_ids: ids([45]), gained_seconds: 20 } },
    { km: 109.1, type: "finale_attack", params: { group_id: "gruppetto-8003", direction: "descent", rider_ids: ids([23, 57, 76, 105, 74, 120, 36, 101]), gained_seconds: 14 } },
    { km: 109.1, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ids([73, 130, 142]) } },
    { km: 109.1, type: "group_merged", params: { group_id: "solo-7000", rider_ids: ids([140]), into_group_id: "breakaway-0" } },
    { km: 109.1, type: "group_merged", params: { group_id: "chase-7002", rider_ids: ids(CHASE_7002), into_group_id: "gruppetto-4001" } },
    gap(109.1, "chase-4000", 235.94), gap(109.1, "chase-8000", 246.17), gap(109.1, "chase-7001", 256.17), gap(109.1, "breakaway-8001", 345.78),
    gap(109.1, "peloton-0", 349.22), gap(109.1, "solo-8002", 384.03), gap(109.1, "gruppetto-7003", 404.03), gap(109.1, "gruppetto-8003", 673.49),
    gap(109.1, "gruppetto-4001", 687.49),
    { km: 125.9, type: "breakaway_caught", params: { group_id: "breakaway-8001", rider_ids: ids([29, 62, 110, 102, 55]) } },
    { km: 125.9, type: "group_merged", params: { group_id: "chase-4000", rider_ids: ids([44]), into_group_id: "breakaway-8001" } },
    gap(125.9, "chase-8000", 261.09), gap(125.9, "peloton-0", 332.65), gap(125.9, "breakaway-8001", 335.72), gap(125.9, "chase-7001", 377.52),
    gap(125.9, "gruppetto-7003", 398.8), gap(125.9, "solo-8002", 533.1), gap(125.9, "gruppetto-8003", 726.64), gap(125.9, "gruppetto-4001", 735.51),
    { km: 140.32, type: "incident", params: { kind: "mechanical", outcome: "time_loss", rider_id: id(8), severity: null, injury_days: null, helper_assist: true, time_loss_seconds: 10.37 } },
    { km: 142.7, type: "group_merged", params: { group_id: "solo-m10-10-0", rider_ids: ids([8]), into_group_id: "gruppetto-4001" } },
    gap(142.7, "peloton-0", 240.85), gap(142.7, "chase-8000", 319.42), gap(142.7, "breakaway-8001", 327.86), gap(142.7, "gruppetto-7003", 389.71),
    gap(142.7, "chase-7001", 498.66), gap(142.7, "solo-8002", 632.07), gap(142.7, "gruppetto-8003", 783.23), gap(142.7, "gruppetto-4001", 786.34),
    gap(159.5, "peloton-0", 131.88), gap(159.5, "breakaway-8001", 320.01), gap(159.5, "chase-8000", 362.54), gap(159.5, "gruppetto-7003", 383.94),
    gap(159.5, "chase-7001", 621.39), gap(159.5, "solo-8002", 723.12), gap(159.5, "gruppetto-4001", 840.87), gap(159.5, "gruppetto-8003", 843.6),
    { km: 165, type: "peloton_splits", params: { cause: "wprime_depleted", group_id: "solo-12000", rider_ids: ids([44]), gap_seconds: 39.39, source_group_id: "breakaway-8001" } },
    { km: 165, type: "peloton_splits", params: { cause: "mixed", group_id: "chase-12001", rider_ids: ids(CHASE_12001), gap_seconds: 42.83, source_group_id: "gruppetto-4001" } },
    { km: 165, type: "peloton_splits", params: { cause: "mixed", group_id: "chase-12002", rider_ids: ids([34, 41, 46, 66, 104]), gap_seconds: 36.09, source_group_id: "gruppetto-7003" } },
    { km: 165, type: "peloton_splits", params: { cause: "climb_deficit", group_id: "solo-12003", rider_ids: ids([76]), gap_seconds: 26.76, source_group_id: "gruppetto-8003" } },
    { km: 165, type: "peloton_splits", params: { cause: "climb_deficit", group_id: "solo-12004", rider_ids: ids([141]), gap_seconds: 26.11, source_group_id: "peloton-0" } },
    { km: 165, type: "breakaway_survived", params: { group_id: "breakaway-0", rider_ids: ids([73, 130, 142, 140]), gap_seconds: 95.86 } },
    { km: 165, type: "breakaway_caught", params: { group_id: "breakaway-8001", rider_ids: ids([29, 62, 110, 102, 55]) } },
    { km: 165, type: "finale_attack", params: { kind: "gap_survived", group_id: "peloton-0", gap_seconds: 94.99 } },
    { km: 165, type: "group_merged", params: { group_id: "breakaway-0", rider_ids: ids([73, 130, 142, 140]), into_group_id: "finale-bunch-0" } },
    { km: 165, type: "finale_attack", params: { kind: "stage_decided", group_id: "finale-bunch-0", win_type: "close_win", finale_type: "reduced_sprint", winner_rider_id: id(73) } },
    gap(165, "peloton-0", 94.99), gap(165, "solo-12004", 151.81), gap(165, "breakaway-8001", 315.62), gap(165, "solo-12000", 335.73),
    gap(165, "gruppetto-7003", 401.9), gap(165, "chase-12002", 437.99), gap(165, "chase-8000", 456.65), gap(165, "chase-7001", 786.73),
    gap(165, "solo-8002", 811.49), gap(165, "gruppetto-8003", 966.49), gap(165, "solo-12003", 993.25), gap(165, "gruppetto-4001", 1013.34),
    gap(165, "chase-12001", 1056.17),
    { km: 165, type: "kom_passage", params: { top: [{ points: 5, rider_id: id(73) }], name: "Mont Portet", category: "2" } },
    { km: 165, type: "finish", params: { top: [{ gap: 0, rank: 1, rider_id: id(73) }, { gap: 0, rank: 2, rider_id: id(130) }, { gap: 0, rank: 3, rider_id: id(142) }], win_type: "close_win" } },
  ],
};
