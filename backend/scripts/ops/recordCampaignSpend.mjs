import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export function parseCampaignSpend(args) {
  const { values } = parseArgs({
    args,
    options: {
      date: { type: "string" },
      campaign: { type: "string" },
      "amount-dkk": { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  const spendDate = values.date;
  if (typeof spendDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(spendDate) || spendDate.startsWith("0000")) {
    throw new Error("Angiv dato som YYYY-MM-DD");
  }
  const date = new Date(spendDate + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== spendDate) throw new Error("Ugyldig dato");

  const campaign = values.campaign;
  if (typeof campaign !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(campaign)) {
    throw new Error("Angiv kampagnen som en kort utm_campaign-slug med små bogstaver");
  }

  const amount = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(values["amount-dkk"] ?? "");
  if (!amount) throw new Error("Angiv et ikke-negativt DKK-beløb med højst to decimaler");
  const amount_ore = Number(amount[1]) * 100 + Number((amount[2] ?? "").padEnd(2, "0"));
  if (amount_ore > 2147483647) throw new Error("Beløbet er for stort til dagsfeltet");

  return { row: { spend_date: spendDate, utm_campaign: campaign, amount_ore }, apply: values.apply };
}

export async function recordCampaignSpend({ supabase, row, apply }) {
  if (!apply) return;
  const { error } = await supabase.from("campaign_spend_daily")
    .upsert(row, { onConflict: "utm_campaign,spend_date" });
  if (error) throw new Error("Dagsudgiften kunne ikke gemmes");
}

async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Brug: node scripts/ops/recordCampaignSpend.mjs --date YYYY-MM-DD --campaign SLUG --amount-dkk BELOEB [--apply]");
    return;
  }
  const input = parseCampaignSpend(args);
  let supabase;
  if (input.apply) {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase service-miljøet mangler");
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  }
  await recordCampaignSpend({ supabase, ...input });
  console.log(input.apply ? "Dagsudgift gemt" : "Dagsudgift valideret (dry-run)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error("Indtastning stoppet. Kontrollér argumenter, miljø og at migrationen er anvendt.");
    if (error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") console.error("Brug --help");
    process.exitCode = 1;
  });
}
