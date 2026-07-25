import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2891 — sæson-recappen hentede HELE race_results til klienten.
//
// fetchAllRows() paginerer med OFFSET. race_results har 459.347 rækker i prod,
// så siden lavede 459 round-trips hvor hver side er dyrere end den forrige
// (OFFSET skal scanne alt foran sig):
//
//   side 1   =    12,7 ms
//   side 451 = 3.662,0 ms      (288x værre)
//   sum      = ~9,5 MINUTTERS databasetid pr. sidevisning
//
// Dybeste observerede kald i pg_stat_statements var 7.154 ms mod et
// statement_timeout på 8.000 ms. Rammes loftet kaster supabasePagination.js, så
// HELE recappen fejler i stedet for at vise noget delvist.
//
// Det farlige var timingen: emitSeasonEndedNotifications (seasonTransition.js)
// sender ved sæson-slut en notifikation til alle menneske-managers, og
// NotificationsPage deep-linker season_ended → /seasons → denne side. Ved
// cutover ville ~150 managers ramme den samtidig, mens databasen også kørte
// finalization, payroll og op-/nedrykning. Den kode havde aldrig kørt i prod.
//
// De rå rækker blev brugt til præcis tre aggregeringer, som nu sker server-side
// i public.get_season_recap(): præmie pr. hold pr. løb, præmie-leder (= sum
// heraf) og etapesejre pr. rytter. 4.756 rækker og ~510 ms i ét kald.
//
// node --test uden DOM → kildekode-strukturel guard, samme mønster som
// TransfersPage.swapCashSign.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dirname, "SeasonEndPage.jsx"), "utf8");

// Guarden skal måle KODEN, ikke prosaen. Kommentarerne i filen beskriver med vilje
// det mønster vi forbyder ("hentede før alle rækker med fetchAllRows(...)"), og en
// naiv regex over råteksten ville derfor fejle på sin egen dokumentation.
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("#2891 recappen henter ALDRIG race_results-rækker til klienten igen", () => {
  assert.doesNotMatch(
    code,
    /from\(\s*["'`]race_results["'`]\s*\)/,
    "SeasonEndPage må ikke selecte fra race_results — tabellen har 459k rækker, " +
      "og aggregeringen hører hjemme i public.get_season_recap()",
  );
});

test("#2891 fetchAllRows er ude af filen — den var selve OFFSET-mekanismen", () => {
  assert.doesNotMatch(
    code,
    /fetchAllRows\s*\(/,
    "intet kald til fetchAllRows: OFFSET-paginering over en 459k-rækkers tabel var rodårsagen",
  );
  assert.doesNotMatch(
    code,
    /^\s*import\s+\{[^}]*fetchAllRows/m,
    "fetchAllRows må ikke være importeret — en ubrugt import inviterer til at den tages i brug igen",
  );
});

test("#2891 kommentar-strippen skjuler ikke ægte kode (guarden kan stadig fejle)", () => {
  // Mutations-tjek: uden dette ville en for grådig strip gøre alle guards
  // ovenfor grønne uanset hvad filen indeholder.
  const mutated = code + '\nconst x = await fetchAllRows(() => supabase.from("race_results"));\n';
  assert.match(mutated, /fetchAllRows\s*\(/);
  assert.match(mutated, /from\(\s*["'`]race_results["'`]\s*\)/);
  assert.ok(code.includes("get_season_recap"), "strippen må ikke have ædt selve RPC-kaldet");
});

test("#2891 siden kalder aggregerings-RPC'en", () => {
  assert.match(
    code,
    /\.rpc\(\s*["'`]get_season_recap["'`]\s*,\s*\{\s*p_season_id:/,
    "recappen skal hente sine tal via get_season_recap(p_season_id)",
  );
});

test("#2891 RPC-fejl kastes, den sluges ikke til en tom recap", () => {
  // #1851-klassen: et tavst `|| []` ville rendere en tom sæson som om der
  // aldrig havde været resultater — værre end en fejlside, fordi den ser rigtig ud.
  assert.match(
    code,
    /recapError[\s\S]{0,80}throw new Error/,
    "en fejl fra get_season_recap skal kastes, så ErrorState vises i stedet for en tom recap",
  );
});

// ── Paritet: aggregerings-logikken skal give samme tal som den gamle JS ────────
//
// Den gamle kode byggede progression ved at filtrere ALLE rå rækker pr. løb og
// summere prize_money pr. rytterens team_id. Den nye bygger et race_id → team_id
// → prize-opslag ud af RPC'ens allerede-aggregerede rækker. Herunder køres begge
// veje mod samme datasæt og sammenlignes.

function progressionFromRawRows(sortedRaces, standings, rawRows) {
  const prog = {};
  const cumulative = {};
  standings.forEach((s) => { prog[s.team_id] = []; cumulative[s.team_id] = 0; });
  sortedRaces.forEach((race) => {
    const racePoints = {};
    rawRows.filter((r) => r.race_id === race.id).forEach((r) => {
      if (r.rider?.team_id) {
        racePoints[r.rider.team_id] = (racePoints[r.rider.team_id] || 0) + (r.prize_money || 0);
      }
    });
    standings.forEach((s) => {
      cumulative[s.team_id] = (cumulative[s.team_id] || 0) + (racePoints[s.team_id] || 0);
      if (prog[s.team_id]) prog[s.team_id].push(cumulative[s.team_id]);
    });
  });
  return prog;
}

function progressionFromAggregate(sortedRaces, standings, prizeByRace) {
  const prog = {};
  const cumulative = {};
  standings.forEach((s) => { prog[s.team_id] = []; cumulative[s.team_id] = 0; });
  sortedRaces.forEach((race) => {
    const racePrize = prizeByRace[race.id] || {};
    standings.forEach((s) => {
      cumulative[s.team_id] = (cumulative[s.team_id] || 0) + (Number(racePrize[s.team_id]) || 0);
      if (prog[s.team_id]) prog[s.team_id].push(cumulative[s.team_id]);
    });
  });
  return prog;
}

const RACES = [{ id: "r1" }, { id: "r2" }, { id: "r3" }];
const STANDINGS = [{ team_id: "tA" }, { team_id: "tB" }];
const RAW = [
  { race_id: "r1", prize_money: 100, rider: { team_id: "tA" } },
  { race_id: "r1", prize_money: 50, rider: { team_id: "tA" } },
  { race_id: "r1", prize_money: 70, rider: { team_id: "tB" } },
  // r2: kun tB scorer — tA skal stadig få et punkt (fladt), ikke et hul.
  { race_id: "r2", prize_money: 30, rider: { team_id: "tB" } },
  { race_id: "r3", prize_money: 10, rider: { team_id: "tA" } },
  // rytter uden hold falder ud begge veje (joinet i SQL, if-guarden i JS)
  { race_id: "r3", prize_money: 999, rider: { team_id: null } },
];
// Serverens form: { race_id: { team_id: prize } }. Bemærk at r2 IKKE har tA som
// nøgle — sådan ser et løb ud hvor holdet ikke scorede (321 af 423 løb i sæson 1
// har overhovedet en nøgle).
const AGGREGATE = {
  r1: { tA: 150, tB: 70 },
  r2: { tB: 30 },
  r3: { tA: 10 },
};

test("#2891 progression: aggregeret vej giver samme kurver som rå rækker", () => {
  assert.deepEqual(
    progressionFromAggregate(RACES, STANDINGS, AGGREGATE),
    progressionFromRawRows(RACES, STANDINGS, RAW),
  );
});

test("#2891 progression er kumulativ og har ét punkt pr. løb, også uden score", () => {
  const prog = progressionFromAggregate(RACES, STANDINGS, AGGREGATE);
  assert.deepEqual(prog.tA, [150, 150, 160], "tA scorer ikke i r2 → kurven skal være flad, ikke mangle et punkt");
  assert.deepEqual(prog.tB, [70, 100, 100]);
  assert.equal(prog.tA.length, RACES.length, "grafens labels er races.map(...) — punkter og labels må aldrig desynke");
});

test("#2891 et løb helt uden data giver flad kurve, ikke et hul", () => {
  const prog = progressionFromAggregate(
    [{ id: "r1" }, { id: "ukendt" }, { id: "r3" }],
    [{ team_id: "tA" }],
    AGGREGATE,
  );
  assert.deepEqual(prog.tA, [150, 150, 160]);
});

test("#2891 prize kan komme som streng fra jsonb uden at blive strengsammensat", () => {
  // jsonb kan levere bigint som streng. "150" + "10" = "15010" ville være en
  // tavs katastrofe i et pengetal, derfor Number() omkring opslaget.
  const prog = progressionFromAggregate(
    [{ id: "r1" }, { id: "r2" }],
    [{ team_id: "tA" }],
    { r1: { tA: "150" }, r2: { tA: "10" } },
  );
  assert.deepEqual(prog.tA, [150, 160]);
});

test("#2891 præmie-leder summerer aggregatet og respekterer menneskehold-filteret", () => {
  const humanTeamIds = new Set(["tA", "tB"]);
  const withAi = { ...AGGREGATE, r1: { ...AGGREGATE.r1, aiTeam: 99999 } };
  const prizeByTeam = {};
  Object.values(withAi).forEach((perTeam) => {
    Object.entries(perTeam || {}).forEach(([teamId, prize]) => {
      if (!humanTeamIds.has(teamId)) return;
      prizeByTeam[teamId] = (prizeByTeam[teamId] || 0) + (Number(prize) || 0);
    });
  });
  const top = Object.entries(prizeByTeam).sort((a, b) => b[1] - a[1])[0];
  assert.deepEqual(top, ["tA", 160]);
  assert.equal(prizeByTeam.aiTeam, undefined, "AI-hold må aldrig kunne blive præmie-leder");
});
