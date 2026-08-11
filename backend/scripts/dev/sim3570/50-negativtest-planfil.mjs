// 50 — NEGATIV-TEST af --plan-fil-porten.
// Den sunde D-fil skal bestå; fem beskadigede versioner skal hver især fejle.
// Består en beskadiget fil, beviser den sunde ingenting.
import { ROD, SNAPSHOT_DIR, D_PLAN } from "./pgsim.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const UD = process.env.CZ_SIM_UD || join(ROD, "backend/scripts/dev/sim3570");
const TMP = mkdtempSync(join(tmpdir(), "sim3570-"));
const v = await import(pathToFileURL(join(ROD, "backend/scripts/dev/repair3570Apply.mjs")).href);
const DIR = SNAPSHOT_DIR;

const rå = JSON.parse(gunzipSync(readFileSync(D_PLAN)).toString("utf8"));
const kopi = () => JSON.parse(JSON.stringify(rå));
const skrivMidlertidig = (o, navn) => {
  const sti = join(TMP, `tmp-${navn}.json`);
  writeFileSync(sti, JSON.stringify(o));
  return sti;
};

const prøv = (navn, byg) => {
  let sti, r = null, fejl = null;
  try {
    sti = byg();
    const pf = v.laesPlanFil(sti);
    r = v.runPlanFilSelvtest({ dir: DIR, planFil: pf });
    if (!r.bestaaet) fejl = r.afvigelser.map((a) => `${a.navn}: ${a.faktisk} (forventet ${a.forventet})`).join("; ");
  } catch (e) { fejl = e.message; }
  return { navn, bestod: !fejl, fejl };
};

const resultater = [];

resultater.push(prøv("0. SUND REFERENCE — D-filen som den er", () => D_PLAN));

// Manglende dækning er IKKE en paritets-fejl (filen kan være bygget på et nyere
// snapshot). Den skal rapporteres, kvote-kontrollen skal falde bort, og selve
// dækningskravet håndhæves mod den FRISKE population — se scenarie 6.
resultater.push(prøv("1. en rytter fjernet fra filen — skal rapporteres, ikke fejle", () => {
  const o = kopi();
  const i = o.ryttere.findIndex((r) => r.skrives);
  o.ryttere.splice(i, 1);
  return skrivMidlertidig(o, "mangler-rytter");
}));

resultater.push(prøv("2. ÉN loft-celle ændret med 1", () => {
  const o = kopi();
  const r = o.ryttere.find((x) => x.skrives && x.skrives_ability_caps);
  r.skrives_ability_caps.climbing = Number(r.skrives_ability_caps.climbing) + 1;
  return skrivMidlertidig(o, "loft-celle");
}));

resultater.push(prøv("3. én rytter flyttet til en anden type (kvoten brydes)", () => {
  const o = kopi();
  const r = o.ryttere.find((x) => x.skrives && x.kilde === "tildelt" && x.primary_efter !== "gc");
  r.primary_efter = "gc";
  if (r.secondary_efter === "gc") r.secondary_efter = "sprinter";
  return skrivMidlertidig(o, "kvote");
}));

resultater.push(prøv("4. primær og sekundær sat ens", () => {
  const o = kopi();
  const r = o.ryttere.find((x) => x.skrives);
  r.secondary_efter = r.primary_efter;
  return skrivMidlertidig(o, "ens-typer");
}));

resultater.push(prøv("5. en ugyldig type-nøgle", () => {
  const o = kopi();
  const r = o.ryttere.find((x) => x.skrives);
  r.primary_efter = "bjergged";
  return skrivMidlertidig(o, "ugyldig-type");
}));

// ── 6) Dækningskravet, dér hvor det hører hjemme: mod den friske population ──
{
  const { byg, lavSupabase } = await import("./pgsim.mjs");
  const { db } = await byg({ snapshotDir: DIR });
  await db.exec(v.backupDDL("20260816"));
  const o = kopi();
  o.ryttere.splice(o.ryttere.findIndex((r) => r.skrives), 1);
  const sti = skrivMidlertidig(o, "hul-frisk");
  let fejl = null;
  const supabase = lavSupabase(db, {});
  try {
    await v.runRepair3570(supabase, {
      apply: true, ejerBekraeftet: true, planFil: sti,
      baselineDir: DIR, backupSuffix: "20260816", log: () => {},
    });
  } catch (e) { fejl = e.message; }
  const skrevet = (await db.query("SELECT count(*)::int n FROM public.riders WHERE archetype_draw IS NOT NULL")).rows[0].n;
  const kopieret = (await db.query("SELECT count(*)::int n FROM public.riders_3570_backup_20260816")).rows[0].n;
  resultater.push({
    navn: "6. NEGATIV — rytter mangler i filen, kørt mod den FRISKE population",
    bestod: !fejl, fejl, drawEfter: skrevet, backupRaekker: kopieret,
  });
  await db.close();
}

for (const r of resultater) {
  console.log(`${r.bestod ? "BESTOD " : "FEJLEDE"}  ${r.navn}`);
  if (r.fejl) console.log(`         ${r.fejl.split("\n")[0].slice(0, 220)}`);
  if (r.drawEfter !== undefined) console.log(`         ryttere med draw efter forsøget: ${r.drawEfter} (uændret 6) · backup-rækker: ${r.backupRaekker} (0 = ingen kopi taget)`);
}
const mønster = [true, true, false, false, false, false, false];
const ok = resultater.every((r, i) => r.bestod === mønster[i]);
console.log(`\n► planfil-porten er fejlbar: ${ok}  (0 og 1 skal bestå, 2-6 skal fejle)`);
writeFileSync(join(UD, "out-50.json"), JSON.stringify({ resultater, ok }, null, 1));
