// 30 — B5: skelner post-verify "slettet undervejs" (forventet) fra
// "skrivningen fejlede" (fejl)?
//
// Fem scenarier mod ægte Postgres med FK ON DELETE CASCADE. Ét skal bestå,
// fire skal fejle. Består de fire også, beviser scenarie 1 ingenting.
import { byg, lavSupabase, ROD, SNAPSHOT_DIR, D_PLAN } from "./pgsim.mjs";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const UD = process.env.CZ_SIM_UD || join(ROD, "backend/scripts/dev/sim3570");
const v = await import(pathToFileURL(join(ROD, "backend/scripts/dev/repair3570Apply.mjs")).href);

/** Kører en fuld apply-kørsel med en krog der forstyrrer midt i skrivningen. */
async function kør(navn, forstyr) {
  const { db } = await byg({ snapshotDir: SNAPSHOT_DIR });
  await db.exec(v.backupDDL("20260816"));
  const ctl = { skjulFraBredtOpslag: new Set() };
  let n = 0;
  const supabase = lavSupabase(db, ctl);
  ctl.foerSkrivning = async (h) => {
    if (h.table !== "riders") return null;
    n++;
    return forstyr({ n, db, ctl, hvem: h.ekstra?.[0] ?? [] });
  };

  const linjer = [];
  let ud = null, fejl = null;
  try {
    ud = await v.runRepair3570(supabase, {
      apply: true, ejerBekraeftet: true,
      planFil: D_PLAN,
      baselineDir: SNAPSHOT_DIR,
      backupSuffix: "20260816",
      log: (s) => linjer.push(s),
    });
  } catch (e) { fejl = e; }
  const svar = {
    navn,
    bestod: !fejl,
    fejl: fejl?.message ?? null,
    rapport: fejl?.rapport ?? null,
    postVerify: ud?.postVerify ? { kontrolleret: ud.postVerify.kontrolleret, iScope: ud.postVerify.iScope, antal: ud.postVerify.antal, forventet: ud.postVerify.forventet } : null,
    skrevet: ud?.skrevet ?? null,
  };
  await db.close();
  return svar;
}

const idsFra = async (db, n, offset = 0) =>
  (await db.query(
    `SELECT id FROM public.riders WHERE is_retired=false AND archetype_draw IS NULL ORDER BY id LIMIT $1 OFFSET $2`,
    [n, offset])).rows.map((r) => r.id);

const resultater = [];

// ── 1) FORVENTET: 12 ryttere slettes midt i skrivningen (AI-hold-trimmen) ───
resultater.push(await kør("1. 12 ryttere SLETTET midt i skrivningen (aiTeamTrimHealSweep)", async ({ n, db }) => {
  if (n === 20) {
    const ids = await idsFra(db, 12, 4000);
    await db.query(`DELETE FROM public.riders WHERE id = ANY($1::uuid[])`, [ids]);
  }
  return null;
}));

// ── 2) NEGATIV: en identitets-batch fejler TAVST (0 rækker, ingen fejl) ─────
resultater.push(await kør("2. NEGATIV — en identitets-batch skriver intet, men melder OK", ({ n }) => (n === 20 ? { spring: true } : null)));

// ── 3) NEGATIV: rytteren lever, men abilities-rækken er væk ────────────────
resultater.push(await kør("3. NEGATIV — 3 abilities-rækker slettet, rytterne lever (CASCADE brudt)", async ({ n, db }) => {
  if (n === 20) {
    const ids = await idsFra(db, 3, 100);
    await db.query(`DELETE FROM public.rider_derived_abilities WHERE rider_id = ANY($1::uuid[])`, [ids]);
  }
  return null;
}));

// ── 4) NEGATIV: flere forsvinder end loftet max(25, 5 %) ───────────────────
resultater.push(await kør("4. NEGATIV — 450 ryttere forsvinder (over loftet på 410)", async ({ n, db }) => {
  if (n === 20) {
    const ids = await idsFra(db, 450, 2000);
    await db.query(`DELETE FROM public.riders WHERE id = ANY($1::uuid[])`, [ids]);
  }
  return null;
}));

// ── 5) NEGATIV: LÆSEFEJL — rækker der findes, men mangler i det brede opslag ─
resultater.push(await kør("5. NEGATIV — 9 ryttere mangler i det brede opslag, men FINDES (læsefejl)", async ({ n, db, ctl }) => {
  if (n === 20) for (const id of await idsFra(db, 9, 6000)) ctl.skjulFraBredtOpslag.add(id);
  return null;
}));

console.log("");
for (const r of resultater) {
  console.log(`${r.bestod ? "BESTOD " : "FEJLEDE"}  ${r.navn}`);
  if (r.postVerify) {
    console.log(`         kontrolleret ${r.postVerify.kontrolleret} af ${r.postVerify.iScope} · forventet ${JSON.stringify(r.postVerify.forventet)} · fejl ${JSON.stringify(r.postVerify.antal)}`);
  }
  if (r.fejl) console.log(`         ${r.fejl.split("\n")[0]}`);
  if (r.rapport) console.log(`         forventet ${JSON.stringify(r.rapport.forventet)} · kontrolleret ${r.rapport.kontrolleret}`);
}
const forventetMønster = [true, false, false, false, false];
const ok = resultater.every((r, i) => r.bestod === forventetMønster[i]);
console.log(`\n► B5-skellet holder: ${ok}  (1 skal bestå, 2-5 skal fejle)`);
writeFileSync(join(UD, "out-30.json"), JSON.stringify({ resultater, ok }, null, 1));
