// 20 — B1′: backup → skrivning → rollback, felt for felt.
//
// Blokker B1′ var at backup og rollback ikke kunne bruges SAMMEN. Her køres de
// sammen, mod en ægte Postgres, med den COMMITTEDE rollback-fil ordret — inklusive
// dens `DO $$ … RAISE EXCEPTION`-porte, som aldrig har været eksekveret af en
// server før. Tildelingen kommer fra D-planen.
import { byg, lavSupabase, billede, sammenlign, ROD, SNAPSHOT_DIR, D_PLAN } from "./pgsim.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const UD = process.env.CZ_SIM_UD || join(ROD, "backend/scripts/dev/sim3570");
const v = await import(pathToFileURL(join(ROD, "backend/scripts/dev/repair3570Apply.mjs")).href);

const SQL = readFileSync(join(ROD, "backend/scripts/dev/repair3570Rollback.sql"), "utf8");
const skilleMærke = "-- PART B — ROLLBACK";
const iB = SQL.indexOf(skilleMærke);
if (iB < 0) throw new Error("kunne ikke finde PART B i rollback-filen");
// PART A slutter ved bannerlinjen over PART B.
const bannerStart = SQL.lastIndexOf("-- ███", iB);
const PART_A = SQL.slice(0, bannerStart);
const PART_B = SQL.slice(bannerStart);

const noter = [];
const kørSQL = async (db, sql, navn) => {
  const foer = noter.length;
  try {
    await db.exec(sql);
    return { navn, ok: true, noter: noter.slice(foer) };
  } catch (e) {
    return { navn, ok: false, fejl: e.message, noter: noter.slice(foer) };
  }
};

const resultat = { trin: [] };
const log = (s) => { console.log(s); };
const tæl = async (db) => ({
  levendeMedDraw: (await db.query("SELECT count(*)::int n FROM public.riders WHERE is_retired=false AND archetype_draw IS NOT NULL")).rows[0].n,
  alleMedDraw: (await db.query("SELECT count(*)::int n FROM public.riders WHERE archetype_draw IS NOT NULL")).rows[0].n,
  backupR: (await db.query("SELECT to_regclass('public.riders_3570_backup_20260816') IS NOT NULL t")).rows[0].t
    ? (await db.query("SELECT count(*)::int n FROM public.riders_3570_backup_20260816")).rows[0].n : null,
  backupA: (await db.query("SELECT to_regclass('public.rider_derived_abilities_3570_backup_20260816') IS NOT NULL t")).rows[0].t
    ? (await db.query("SELECT count(*)::int n FROM public.rider_derived_abilities_3570_backup_20260816")).rows[0].n : null,
});

async function rundtur({ navn, brugPartA }) {
  log(`\n╔══ ${navn} ══`);
  const { db } = await byg({ snapshotDir: SNAPSHOT_DIR });
  db.onNotice?.((n) => noter.push(n.message ?? String(n)));
  const supabase = lavSupabase(db);
  const t = { navn, trin: [] };

  const FØR = await billede(db);
  t.trin.push({ trin: "udgangspunkt", ...(await tæl(db)) });
  log(`  udgangspunkt: ${(await tæl(db)).levendeMedDraw} levende med draw`);

  // ── 1) Backup-kilden ──────────────────────────────────────────────────────
  if (brugPartA) {
    const a = await kørSQL(db, PART_A, "PART A (committeret fil, ordret)");
    t.trin.push({ trin: "PART A", ok: a.ok, fejl: a.fejl, noter: a.noter });
    log(`  PART A: ${a.ok ? "OK" : "FEJLEDE — " + a.fejl}`);
    for (const n of a.noter) log(`     NOTICE: ${n}`);
    if (!a.ok) return t;
  } else {
    await db.exec(v.backupDDL("20260816"));   // kun DDL — værktøjet fylder selv
    t.trin.push({ trin: "kun DDL (--print-backup-sql)", ok: true });
    log("  kun DDL oprettet — værktøjet fylder kopien selv");
  }
  const efterBackup = await tæl(db);
  t.trin.push({ trin: "efter backup-kilde", ...efterBackup });
  log(`  backup-tabeller: riders=${efterBackup.backupR} abilities=${efterBackup.backupA}`);

  // ── 2) Skrivningen ────────────────────────────────────────────────────────
  const linjer = [];
  const ud = await v.runRepair3570(supabase, {
    apply: true, ejerBekraeftet: true,
    planFil: D_PLAN,
    baselineDir: SNAPSHOT_DIR,
    backupSuffix: "20260816",
    log: (s) => linjer.push(s),
  });
  t.skrevet = ud.skrevet;
  t.backup = { genbrugt: ud.backup.genbrugt, kopi: ud.backup.kopi, indsat: ud.backup.indsat, verificeret: ud.backup.verificeret };
  t.postVerify = { kontrolleret: ud.postVerify.kontrolleret, antal: ud.postVerify.antal, forventet: ud.postVerify.forventet };
  t.planFil = ud.planFil;
  log(`  skrevet: identitet ${ud.skrevet.identitet} · lofter ${ud.skrevet.lofter}`);
  log(`  backup: genbrugt=${JSON.stringify(ud.backup.genbrugt)} kopi=${JSON.stringify(ud.backup.kopi)} indsat=${JSON.stringify(ud.backup.indsat)}`);
  log(`  post-verify: ${ud.postVerify.kontrolleret} kontrolleret · fejl ${JSON.stringify(ud.postVerify.antal)}`);

  const EFTER_SKRIV = await billede(db);
  const dSkriv = sammenlign(FØR, EFTER_SKRIV);
  t.trin.push({ trin: "efter skrivning", ...(await tæl(db)), aendredeFelter: Object.fromEntries(Object.entries(dSkriv.felter).map(([k, x]) => [k, x.antal])) });
  log(`  efter skrivning: ${(await tæl(db)).levendeMedDraw} levende med draw · ændrede felter ${JSON.stringify(Object.fromEntries(Object.entries(dSkriv.felter).map(([k, x]) => [k, x.antal])))}`);

  // ── 3) Rollback — den committede fil, ordret ──────────────────────────────
  const b = await kørSQL(db, PART_B, "PART B (committeret fil, ordret)");
  t.trin.push({ trin: "PART B", ok: b.ok, fejl: b.fejl, noter: b.noter });
  log(`  PART B: ${b.ok ? "OK" : "FEJLEDE — " + b.fejl}`);
  for (const n of b.noter) log(`     NOTICE: ${n}`);

  // ── 4) Er vi tilbage ved udgangspunktet? Felt for felt. ───────────────────
  const EFTER_ROLLBACK = await billede(db);
  const d = sammenlign(FØR, EFTER_ROLLBACK);
  t.rundtur = {
    identisk: d.identisk, raekker: d.raekker,
    kunIFoer: d.kunIFoer.length, kunIEfter: d.kunIEfter.length,
    felter: Object.fromEntries(Object.entries(d.felter).map(([k, x]) => [k, { antal: x.antal, eksempler: x.eksempler }])),
  };
  log(`  ► RUNDTUR: identisk=${d.identisk} · ${d.raekker} rækker · afvigende felter ${JSON.stringify(Object.fromEntries(Object.entries(d.felter).map(([k, x]) => [k, x.antal])))}`);

  // ── 5) Rollbacken skal være idempotent ────────────────────────────────────
  const b2 = await kørSQL(db, PART_B, "PART B anden gang");
  const EFTER2 = await billede(db);
  const d2 = sammenlign(FØR, EFTER2);
  t.andenRollback = { ok: b2.ok, fejl: b2.fejl, identisk: d2.identisk, noter: b2.noter };
  log(`  PART B igen: ${b2.ok ? "OK" : "FEJLEDE — " + b2.fejl} · stadig identisk med udgangspunktet: ${d2.identisk}`);

  await db.close();
  return t;
}

resultat.trin.push(await rundtur({ navn: "A → skrivning → B  (kørebogens vej: PART A tager kopien)", brugPartA: true }));
resultat.trin.push(await rundtur({ navn: "DDL → værktøjet fylder kopien → B", brugPartA: false }));

const udFil = join(UD, "out-20.json");
writeFileSync(udFil, JSON.stringify(resultat, null, 1));
console.log(`\nskrevet: ${udFil}`);
