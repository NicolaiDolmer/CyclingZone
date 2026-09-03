import test from "node:test";
import assert from "node:assert/strict";

import { repairOrphanedAcademyOffers4576, BACKUP_TABLE } from "./repairOrphanedAcademyOffers4576.js";

// In-memory mock af de tre tabeller scriptet roerer:
//   academy_intake: select(cols).eq("status","offered").order().range()  [liste]
//                   select("*").in("id",[...]).order().range()          [fulde raekker]
//                   update({status,resolved_at}).eq("id",x).eq("status","offered").select()
//   riders:         select("id, team_id").in("id",[...]).order().range()
//   backup-tabel:   select(cols).limit(1)                                [probe]
//                   upsert(rows, {onConflict})                           [backup]
//                   select("row_id").in("row_id",[...]).order().range()  [post-verify]
function makeMock({ intake, riders, backupExists = true, backupRows = [] }) {
  const intakeRows = intake;
  const backup = backupRows;
  return {
    from(table) {
      if (table === "academy_intake") {
        const eqFilters = [];
        let inIds = null;
        let mode = "select";
        let patch = null;
        const b = {
          select() { return b; },
          update(p) { mode = "update"; patch = p; return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          in(_col, ids) { inIds = ids; return b; },
          order() { return b; },
          range(from, to) {
            let out = inIds
              ? intakeRows.filter((r) => inIds.includes(r.id))
              : intakeRows.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
            out = out.slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
          then(resolve, reject) {
            if (mode !== "update") {
              return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            }
            const matched = intakeRows.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
            for (const r of matched) Object.assign(r, patch);
            return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null }).then(resolve, reject);
          },
        };
        return b;
      }
      if (table === "riders") {
        let inIds = null;
        const b = {
          select() { return b; },
          in(_col, ids) { inIds = ids; return b; },
          order() { return b; },
          range(from, to) {
            let out = riders.filter((r) => (inIds ? inIds.includes(r.id) : true));
            out = out.slice(from, to + 1);
            return Promise.resolve({ data: out.map((r) => ({ id: r.id, team_id: r.team_id })), error: null });
          },
        };
        return b;
      }
      if (table === BACKUP_TABLE) {
        let inIds = null;
        let limitN = null;
        const b = {
          select() { return b; },
          in(_col, ids) { inIds = ids; return b; },
          order() { return b; },
          limit(n) {
            limitN = n;
            if (!backupExists) return Promise.resolve({ data: null, error: new Error("relation does not exist") });
            return Promise.resolve({ data: backup.slice(0, n ?? backup.length), error: null });
          },
          range(from, to) {
            let out = inIds ? backup.filter((r) => inIds.includes(r.row_id)) : backup;
            out = out.slice(from, to + 1);
            return Promise.resolve({ data: out.map((r) => ({ row_id: r.row_id })), error: null });
          },
          upsert(rows) {
            for (const row of rows) {
              const i = backup.findIndex((r) => r.row_id === row.row_id);
              if (i >= 0) backup[i] = row; else backup.push(row);
            }
            return Promise.resolve({ data: rows, error: null });
          },
        };
        return b;
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

function makeCase() {
  return {
    intake: [
      { id: "i-same", team_id: "team-A", rider_id: "r-1", status: "offered", resolved_at: null },
      { id: "i-other", team_id: "team-A", rider_id: "r-2", status: "offered", resolved_at: null },
      { id: "i-free", team_id: "team-A", rider_id: "r-3", status: "offered", resolved_at: null },
    ],
    riders: [
      { id: "r-1", team_id: "team-A" }, // ejet af tilbudsholdet → signed
      { id: "r-2", team_id: "team-B" }, // ejet af andet hold → rejected
      { id: "r-3", team_id: null },      // fri → ikke stale
    ],
  };
}

test("#4576 dry-run: rapporterer plan (2 stale), skriver intet, backup uroert", async () => {
  const { intake, riders } = makeCase();
  const mock = makeMock({ intake, riders });
  const res = await repairOrphanedAcademyOffers4576({ supabase: mock, dryRun: true, log: () => {} });
  assert.equal(res.dryRun, true);
  assert.equal(res.stale, 2);
  assert.equal(res.signed, 1);
  assert.equal(res.rejected, 1);
  assert.equal(res.backedUp, 0);
  assert.equal(res.updated, 0);
  assert.equal(intake.find((r) => r.id === "i-same").status, "offered", "dry-run roerer ikke academy_intake");
});

test("#4576 apply: backer op FOER flip, flipper til signed/rejected, post-verify 0 tilbage", async () => {
  const { intake, riders } = makeCase();
  const mock = makeMock({ intake, riders, backupExists: true, backupRows: [] });
  const now = () => new Date("2026-09-03T08:00:00Z");

  const res = await repairOrphanedAcademyOffers4576({ supabase: mock, dryRun: false, now, log: () => {} });

  assert.equal(res.backedUp, 2, "kun de 2 stale raekker sikres");
  assert.equal(res.updated, 2);
  assert.equal(res.postVerifyRemaining, 0);
  assert.equal(intake.find((r) => r.id === "i-same").status, "signed");
  assert.equal(intake.find((r) => r.id === "i-other").status, "rejected");
  assert.equal(intake.find((r) => r.id === "i-free").status, "offered", "fri rytters aabne tilbud roeres ikke");
});

test("#4576 apply: backup indeholder foer-billedet af HELE raekken (row_before)", async () => {
  const { intake, riders } = makeCase();
  const mock = makeMock({ intake, riders });
  const now = () => new Date("2026-09-03T08:00:00Z");
  await repairOrphanedAcademyOffers4576({ supabase: mock, dryRun: false, now, log: () => {} });

  // Genlaes backup-tabellens interne state via en ny probe-forespoergsel.
  const { data } = await mock.from(BACKUP_TABLE).select("row_id,row_before").limit(10);
  const same = data.find((r) => r.row_id === "i-same");
  assert.ok(same, "i-same er sikret i backup");
  assert.equal(same.row_before.rider_id, "r-1", "row_before er hele foer-billedet, ikke kun id");
});

test("#4576 apply: backup-tabel mangler → kaster foer noget skrives til academy_intake", async () => {
  const { intake, riders } = makeCase();
  const mock = makeMock({ intake, riders, backupExists: false });
  await assert.rejects(
    () => repairOrphanedAcademyOffers4576({ supabase: mock, dryRun: false, log: () => {} }),
    /findes ikke/,
  );
  assert.equal(intake.find((r) => r.id === "i-same").status, "offered", "ingen flip naar backup-porten fejler");
});

test("#4576 idempotent: gentaget koersel efter apply finder 0 stale raekker (no-op)", async () => {
  const { intake, riders } = makeCase();
  const mock = makeMock({ intake, riders });
  const now = () => new Date("2026-09-03T08:00:00Z");
  await repairOrphanedAcademyOffers4576({ supabase: mock, dryRun: false, now, log: () => {} });

  const res2 = await repairOrphanedAcademyOffers4576({ supabase: mock, dryRun: false, now, log: () => {} });
  assert.equal(res2.stale, 0);
  assert.equal(res2.backedUp, 0);
  assert.equal(res2.updated, 0);
  assert.deepEqual(res2.plan, []);
});

test("#4576 tom population: idempotent no-op i baade dry-run og apply", async () => {
  const mock = makeMock({ intake: [], riders: [] });
  const resDry = await repairOrphanedAcademyOffers4576({ supabase: mock, dryRun: true, log: () => {} });
  assert.equal(resDry.stale, 0);
  const resApply = await repairOrphanedAcademyOffers4576({ supabase: mock, dryRun: false, log: () => {} });
  assert.equal(resApply.stale, 0);
  assert.equal(resApply.backedUp, 0);
});
