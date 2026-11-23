
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { parseCampaignSpend, recordCampaignSpend } from "./recordCampaignSpend.mjs";

const args = ["--date", "2026-11-23", "--campaign", "s6-test", "--amount-dkk", "12,34"];
const row = { spend_date: "2026-11-23", utm_campaign: "s6-test", amount_ore: 1234 };

test("campaign spend parses minor units exactly and verifies the input", () => {
  assert.deepEqual(parseCampaignSpend(args), { row, apply: false });
  assert.deepEqual(parseCampaignSpend([...args, "--apply"]), { row, apply: true });
  for (const [index, bad] of [[1, "2026-02-30"], [3, "fixture@example.test"], [5, "-0.01"], [5, "2.001"], [5, "21474836.48"]]) {
    const invalid = [...args];
    invalid[index] = bad;
    assert.throws(() => parseCampaignSpend(invalid));
  }
});

test("the script writes one daily total only in apply mode", async () => {
  const calls = [];
  const supabase = { from: (table) => ({
    upsert: async (value, opts) => { calls.push({ table, value, opts }); return { error: null }; },
  })};
  await recordCampaignSpend({ supabase, ...parseCampaignSpend(args) });
  assert.deepEqual(calls, []);
  await recordCampaignSpend({ supabase, ...parseCampaignSpend([...args, "--apply"]) });
  assert.deepEqual(calls, [{ table: "campaign_spend_daily", value: row, opts: { onConflict: "utm_campaign,spend_date" } }]);
});

test("the additive spend table can be applied twice and stays service-only", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
    const migration = readFileSync(new URL("../../../database/2026-11-23-8584-campaign-spend-daily.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec("SET ROLE service_role");
    await db.exec("INSERT INTO public.campaign_spend_daily VALUES ('campaign-a','2026-11-23',1234),('campaign-a','2026-11-24',0),('campaign-b','2026-11-23',100)");
    await db.exec("INSERT INTO public.campaign_spend_daily VALUES ('campaign-a','2026-11-23',1235) ON CONFLICT (utm_campaign,spend_date) DO UPDATE SET amount_ore=EXCLUDED.amount_ore");
    await db.exec("RESET ROLE");
    await db.exec(migration);
    const { rows } = await db.query("SELECT utm_campaign, sum(amount_ore)::int AS amount FROM public.campaign_spend_daily GROUP BY 1 ORDER BY 1");
    assert.deepEqual(rows, [{ utm_campaign: "campaign-a", amount: 1235 }, { utm_campaign: "campaign-b", amount: 100 }]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec("SET ROLE " + role);
      await assert.rejects(db.query("SELECT * FROM public.campaign_spend_daily"), { code: "42501" });
      await assert.rejects(db.exec("INSERT INTO public.campaign_spend_daily VALUES ('campaign-a','2026-11-25',100)"), { code: "42501" });
      await db.exec("RESET ROLE");
    }
  } finally {
    await db.close();
  }
});

test("the CLI prints its date and amount validation errors", () => {
  const script = fileURLToPath(new URL("./recordCampaignSpend.mjs", import.meta.url));
  for (const [index, invalid, expected] of [
    [1, "2026-02-30", /Ugyldig dato/],
    [5, "2.001", /højst to decimaler/],
  ]) {
    const invalidArgs = [...args];
    invalidArgs[index] = invalid;
    const result = spawnSync(process.execPath, [script, ...invalidArgs], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});
