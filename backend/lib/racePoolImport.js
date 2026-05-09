// Slice 09 — Race-pool import (CSV → DB)
//
// Sheetet "Races Cycling Zone" har kolonnerne: Dato, Løb, Etaper, Kategori, Type.
// race_class bruger frontend's 9-key-taksonomi (uciRaceClasses.js), IKKE DB's
// race_classes-tabel (som er en parallel struktur til UCI-point-tildeling).
//
// external_id er deterministisk hash af (name + date_text) så re-import af samme
// CSV er no-op via UNIQUE constraint på race_pool.external_id.

import crypto from "node:crypto";

export const KATEGORI_TO_RACE_CLASS = {
  "Tour de France": "TourFrance",
  "Giro, Vuelta": "GiroVuelta",
  Monuments: "Monuments",
  "Other WorldTour A": "OtherWorldTourA",
  "Other WorldTour B": "OtherWorldTourB",
  "Other WorldTour C": "OtherWorldTourC",
  "ProSeries races": "ProSeries",
  "Class 1 races": "Class1",
  "Class 2 races": "Class2",
};

export const TYPE_TO_RACE_TYPE = {
  Endagsløb: "single",
  Etapeløb: "stage_race",
};

export const WORLD_TOUR_CLASSES = [
  "TourFrance",
  "GiroVuelta",
  "Monuments",
  "OtherWorldTourA",
  "OtherWorldTourB",
  "OtherWorldTourC",
];

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

export function buildExternalId(name, dateText) {
  const normName = (name || "").toLowerCase().replace(/\s+/g, " ").trim();
  const normDate = (dateText || "").replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(`${normName}|${normDate}`).digest("hex").slice(0, 16);
}

// Parser en CSV-tekst i sheet-format og returnerer { rows, errors }.
// rows er klar til at upserte med ON CONFLICT (external_id) i race_pool.
export function parseRacePoolCsv(csvText) {
  const errors = [];
  const rows = [];
  if (!csvText || typeof csvText !== "string") {
    errors.push({ line: 0, reason: "tomt_input" });
    return { rows, errors };
  }
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    errors.push({ line: 0, reason: "ingen_data_rækker" });
    return { rows, errors };
  }

  const header = parseCsvLine(lines[0]).map((h) => h.replace(/"/g, ""));
  const idx = {
    date: header.indexOf("Dato"),
    name: header.indexOf("Løb"),
    stages: header.indexOf("Etaper"),
    kategori: header.indexOf("Kategori"),
    type: header.indexOf("Type"),
  };
  for (const [key, value] of Object.entries(idx)) {
    if (value === -1) {
      errors.push({ line: 0, reason: `mangler_kolonne_${key}` });
    }
  }
  if (errors.length > 0) return { rows, errors };

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]).map((c) => c.replace(/^"|"$/g, ""));
    const dateText = cells[idx.date] || "";
    const name = cells[idx.name] || "";
    const stagesRaw = cells[idx.stages] || "";
    const kategori = cells[idx.kategori] || "";
    const type = cells[idx.type] || "";

    if (!name) {
      errors.push({ line: i + 1, reason: "manglende_navn" });
      continue;
    }
    const raceClass = KATEGORI_TO_RACE_CLASS[kategori];
    if (!raceClass) {
      errors.push({ line: i + 1, reason: `ukendt_kategori:${kategori}`, name });
      continue;
    }
    const raceType = TYPE_TO_RACE_TYPE[type];
    if (!raceType) {
      errors.push({ line: i + 1, reason: `ukendt_type:${type}`, name });
      continue;
    }
    const stages = parseInt(stagesRaw, 10);
    if (!Number.isFinite(stages) || stages < 1) {
      errors.push({ line: i + 1, reason: `ugyldig_etaper:${stagesRaw}`, name });
      continue;
    }
    if (raceType === "single" && stages !== 1) {
      errors.push({ line: i + 1, reason: "endagsløb_skal_have_stages_1", name });
      continue;
    }

    rows.push({
      external_id: buildExternalId(name, dateText),
      name,
      race_class: raceClass,
      race_type: raceType,
      stages,
      date_text: dateText,
    });
  }

  return { rows, errors };
}

// Beregner en oversigt over pool-løb pr. klasse: antal og samlede løbsdage.
// Bruges af AdminPage til at vise "her er hvad du kan vælge".
export function summarizePool(poolRows) {
  const summary = {};
  for (const row of poolRows || []) {
    const cls = row.race_class;
    if (!summary[cls]) summary[cls] = { count: 0, raceDays: 0 };
    summary[cls].count += 1;
    summary[cls].raceDays += Number(row.stages) || 0;
  }
  return summary;
}
