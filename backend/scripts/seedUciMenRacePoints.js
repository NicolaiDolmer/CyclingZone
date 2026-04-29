import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { buildUciMenRacePointRows } from "../lib/uciRacePointDefaults.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

function chunk(rows, size) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function updateLegacyRaceClasses() {
  const legacyMappings = [
    ["CWTGTFrance", "TourFrance"],
    ["CWTGTAutres", "GiroVuelta"],
    ["CWTMajeures", "Monuments"],
    ["CWTAutresToursA", "OtherWorldTourA"],
    ["CWTAutresClasA", "OtherWorldTourA"],
    ["CWTAutresToursB", "OtherWorldTourB"],
    ["CWTAutresClasB", "OtherWorldTourB"],
    ["CWTAutresToursC", "OtherWorldTourC"],
    ["CWTAutresClasC", "OtherWorldTourC"],
    ["Cont2HC", "ProSeries"],
    ["Cont1HC", "ProSeries"],
    ["Cont21", "Class1"],
    ["Cont11", "Class1"],
    ["Cont22", "Class2"],
    ["Cont12", "Class2"],
  ];

  for (const [from, to] of legacyMappings) {
    const { error } = await supabase
      .from("races")
      .update({ race_class: to })
      .eq("race_class", from);
    if (error && !error.message?.includes("race_class")) {
      throw new Error(error.message);
    }
  }
}

async function seedRacePoints() {
  const updatedAt = new Date().toISOString();
  const rows = buildUciMenRacePointRows().map(row => ({
    ...row,
    updated_at: updatedAt,
  }));

  for (const rowsChunk of chunk(rows, 500)) {
    const { error } = await supabase
      .from("race_points")
      .upsert(rowsChunk, { onConflict: "race_class,result_type,rank" });
    if (error) throw new Error(error.message);
  }

  return rows.length;
}

await updateLegacyRaceClasses();
const rowsSeeded = await seedRacePoints();
console.log(`Seeded ${rowsSeeded} UCI men race point rows.`);
