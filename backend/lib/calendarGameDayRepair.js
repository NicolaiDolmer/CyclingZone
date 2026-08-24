// backend/lib/calendarGameDayRepair.js
// #4161: udled en GYLDIG in-game-akse (`game_day`) direkte fra de datoer og tidsslots der
// allerede står i race_stage_schedule.
//
// Baggrund: #4155-reparationen overskrev `game_day` med en ren dato-offset og fladede
// dermed in-game-aksen ud (D1: 84+ værdier → 27). `scheduled_at` blev IKKE rørt og er
// stadig korrekt, så aksen kan genskabes uden at flytte en eneste etape.
//
// Hvorfor udlede frem for at gen-køre pakkeren: pakkerens output afhænger af seed, kvote og
// katalog-tilstand på generings-tidspunktet. At ramme den historiske kørsel bit-for-bit er
// arkæologi. Datoerne i databasen ER derimod sandheden om hvornår etaperne kører, og en
// gyldig akse kan udledes af dem alene — deterministisk og verificerbart.
//
// Regler aksen skal opfylde (samme som calendarOverlapInvariant.js håndhæver):
//   1. Et løb har højst ÉN etape pr. in-game-dag.
//   2. Højst `cap` FORSKELLIGE løb pr. in-game-dag (TIER_OVERLAP_CAP, ejer-låst).
//   3. Aksen er monotont voksende med kalenderdagen: alle in-game-dage på dato D ligger
//      før alle in-game-dage på dato D+1. Uden det ville "Race Day N" læse forkert.
//   4. Inden for en dato følger rækkefølgen tidsslottet (11:00 før 13:00 osv.), så den
//      tidligste etape på dagen også er den laveste in-game-dag.
//
// REN + deterministisk (ingen DB, ingen Date, ingen random).

/**
 * @param {{ scheduleRows: Array<{race_id, stage_number, scheduled_at, game_day?}>,
 *           overlapCap: number, startGameDay?: number }} args
 *   `scheduleRows` = ÉN pulje (league_division_id). `scheduled_at` skal være en
 *   ISO-streng i UTC; datodelen udledes i Europe/Copenhagen af kalderen og sendes med
 *   som `local_date` hvis den afviger (ellers bruges de første 10 tegn).
 * @returns {{ rows: Array<{race_id, stage_number, scheduled_at, old_game_day, game_day}>,
 *             gameDayCount: number, dateCount: number, gameDaysPerDate: object,
 *             changed: number }}
 */
export function deriveGameDayAxis({ scheduleRows = [], overlapCap = 2, startGameDay = 0 } = {}) {
  const cap = Math.max(1, overlapCap);

  const byDate = new Map();
  for (const row of scheduleRows) {
    const date = row.local_date ?? String(row.scheduled_at).slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }

  const out = [];
  const gameDaysPerDate = {};
  let nextGameDay = startGameDay;

  for (const date of [...byDate.keys()].sort()) {
    const stages = byDate.get(date).slice().sort((a, b) => {
      const t = String(a.scheduled_at).localeCompare(String(b.scheduled_at));
      if (t !== 0) return t;
      const r = String(a.race_id).localeCompare(String(b.race_id));
      if (r !== 0) return r;
      return (a.stage_number ?? 0) - (b.stage_number ?? 0);
    });

    // Sub-dage inden for datoen. En etape lander i den LAVESTE sub-dag der hverken
    // indeholder dens løb i forvejen eller allerede er fuld (cap forskellige løb).
    // Fordi listen er tidssorteret, får den tidligste etape den laveste sub-dag, og et
    // løbs etaper fordeles automatisk på stigende sub-dage i etape-rækkefølge.
    const subDays = []; // Set(race_id)[]
    for (const st of stages) {
      let idx = subDays.findIndex((s) => !s.has(st.race_id) && s.size < cap);
      if (idx === -1) { subDays.push(new Set()); idx = subDays.length - 1; }
      subDays[idx].add(st.race_id);
      out.push({
        race_id: st.race_id,
        stage_number: st.stage_number,
        scheduled_at: st.scheduled_at,
        old_game_day: st.game_day ?? null,
        game_day: nextGameDay + idx,
      });
    }

    gameDaysPerDate[date] = subDays.length;
    nextGameDay += subDays.length;
  }

  return {
    rows: out,
    gameDayCount: nextGameDay - startGameDay,
    dateCount: byDate.size,
    gameDaysPerDate,
    changed: out.filter((r) => r.old_game_day !== r.game_day).length,
  };
}
