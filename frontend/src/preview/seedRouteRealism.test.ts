// Ejer 27/11 (#8826-billedet): "Hvorfor er der en forkert rute med? Det må altså ikke ske mere".
// Rodaarsag: preview-mockens etaper er haandskrevne og blev aldrig holdt op mod generatorens regler,
// saa en flad spurtetape fik en kategoriseret stigning 18 km foer maal. Prod har 0 af den slags
// (maalt 27/11: 0 af 381 flade S5-etaper og 0 af 95 flade S6-etaper). Denne test holder mocken
// paa samme regler, saa et billede til ejeren aldrig viser en rute, spillet ikke kan lave.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_STAGE_PROFILES } from "./seedData.js";

type Climb = { name: string; category: string; crest_km: number; summit_finish?: boolean };
type Stage = { race_id: string; stage_number: number; profile_type: string; finale_type: string; distance_km: number; climbs?: Climb[] };

const LATE_CLIMB_KM = 20;
const SPRINT_FINALES = new Set(["bunch_sprint", "flat_sprint"]);

test("preview-etaper foelger generatorens regler for flade spurtetaper", () => {
  const brud: string[] = [];
  for (const s of SEED_STAGE_PROFILES as Stage[]) {
    const climbs = s.climbs ?? [];
    const id = `${s.race_id} etape ${s.stage_number}`;
    if (s.profile_type === "flat") {
      for (const c of climbs) {
        if (["1", "2", "HC"].includes(String(c.category))) brud.push(`${id}: flad etape med kat. ${c.category} (${c.name})`);
        if (s.distance_km - c.crest_km <= LATE_CLIMB_KM) brud.push(`${id}: flad etape med stigning ${s.distance_km - c.crest_km} km foer maal (${c.name})`);
      }
    }
    if (SPRINT_FINALES.has(s.finale_type)) {
      for (const c of climbs) {
        if (c.summit_finish) brud.push(`${id}: spurtafslutning med topmaal (${c.name})`);
      }
    }
    for (const c of climbs) {
      if (c.crest_km > s.distance_km) brud.push(`${id}: stigningens top (km ${c.crest_km}) ligger efter maal (km ${s.distance_km})`);
    }
  }
  assert.deepEqual(brud, []);
});
