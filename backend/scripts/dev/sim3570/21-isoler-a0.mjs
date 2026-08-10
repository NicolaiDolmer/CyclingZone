// 21 — Isolerer A0-porten i den committede rollback.sql.
// Påstanden der skal afgøres: fejler PART A på en REN database, altså i præcis
// den situation den er skrevet til?
import { createRequire } from "node:module";
import { BACKEND, ROD } from "./pgsim.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const req = createRequire(join(BACKEND, "package.json"));
const { PGlite } = await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href);

const A0 = `
DO $$
DECLARE n_draw bigint;
BEGIN
  IF to_regclass('public.riders_3570_backup_20260816') IS NOT NULL
     AND (SELECT count(*) FROM public.riders_3570_backup_20260816) > 0 THEN
    RAISE NOTICE 'findes allerede';
    RETURN;
  END IF;
  SELECT count(*) INTO n_draw FROM public.riders WHERE archetype_draw IS NOT NULL;
  IF n_draw > 50 THEN
    RAISE EXCEPTION 'STOP: % ryttere har allerede et archetype_draw.', n_draw;
  END IF;
  RAISE NOTICE 'A0 passeret, n_draw=%', n_draw;
END
$$;`;

// Den NUVÆRENDE form læses ud af den committede fil — ikke skrevet af igen her.
// Ellers ville scriptet bevise noget om sin egen kopi, ikke om det operatøren kører.
// Rettelsen er at neste: den ydre IF planlægges og udføres FØR den indre sætning
// overhovedet bliver planlagt, så en manglende tabel ikke kan vælte udtrykket.
const FIL = readFileSync(join(ROD, "backend/scripts/dev/repair3570Rollback.sql"), "utf8");
const a0Start = FIL.indexOf("DO $$", FIL.indexOf("-- A0."));
const a0Slut = FIL.indexOf("$$;", a0Start);
if (a0Start < 0 || a0Slut < 0) throw new Error("kunne ikke finde A0-blokken i den committede rollback.sql");
const A0_NESTET = FIL.slice(a0Start, a0Slut + 3);

// Fødselstidspunkter i forhold til planens snapshot (2026-08-09T22:30:17.369Z).
const FOER = "2026-08-01T09:00:00Z";   // fandtes da planen blev lavet
const EFTER = "2026-08-10T17:47:17Z";  // de 722 der blev født 10/8 kl. 19:47

const scenarier = [
  ["REN database (backup-tabellen findes IKKE) — PART A's normale førstegangs-kørsel", false, 6, FOER],
  ["backup-tabellen findes allerede (tom)", true, 6, FOER],
  ["databasen er allerede repareret (8193 draws fra før planen)", false, 8193, FOER],
  // Regressionen spærren blev rettet for: 722 nyfødte med anlæg er IKKE en halv
  // reparation. Den GAMLE form fyrer her; den nuværende skal lade den passere.
  ["722 NYFØDTE med anlæg (prod 10/8 kl. 19:47) — må IKKE spærre", false, 722, EFTER],
];

for (const [navn, opretKopi, antalDraw, foedt] of scenarier) {
  for (const [variant, sql] of [["GAMMEL form (før)", A0], ["NU, fra filen", A0_NESTET]]) {
    const db = new PGlite();
    const noter = [];
    db.onNotice?.((n) => noter.push(n.message ?? String(n)));
    await db.exec(`CREATE TABLE public.riders (id int primary key, archetype_draw jsonb, created_at timestamptz);`);
    for (let i = 0; i < antalDraw; i++) {
      await db.query(`INSERT INTO public.riders VALUES ($1,'{"primary":"gc"}',$2)`, [i, foedt]);
    }
    if (opretKopi) await db.exec(`CREATE TABLE public.riders_3570_backup_20260816 (id int);`);
    let ud;
    try { await db.exec(sql); ud = `OK  ${noter.join(" | ")}`; } catch (e) { ud = `FEJLER: ${e.message}`; }
    console.log(`${navn}\n   ${variant.padEnd(16)} → ${ud}`);
    await db.close();
  }
  console.log("");
}
