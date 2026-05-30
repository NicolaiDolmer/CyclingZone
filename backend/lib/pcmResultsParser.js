// Parser for PCM (Pro Cycling Manager / Cycling Manager 4) resultat-eksport.
//
// PCM eksporterer "SpreadsheetML 2003" (XML), IKKE moderne .xlsx (OOXML-zip).
// exceljs kan derfor ikke læse filerne ("Can't find end of central directory")
// — verificeret 2026-05-30. Vi parser XML'en direkte med fast-xml-parser.
// Filerne er gyldig UTF-8 (accenter som "Kubiš", "Guégan", "Hopplà" læses rent).
//
// Struktur:
//   <Workbook><Worksheet ss:Name="Stage results"><Table>
//     <Row><Cell><Data ss:Type="String">..</Data></Cell> ...</Row>
//   ...
// Celler kan være sparse: <Cell ss:Index="5"> springer kolonner over.
//
// Hvert ark har:
//   R0 = titel, fx "X: Stage results after stage 1/5: Dunkerque - Abbeville"
//   R1 = kolonneheaders (Rank, Name, Team, Time, Player | …)
//   R2+ = data
//
// Ark-navne (6 stk): Stage results, General results, Points, Mountain,
//                     Team results, Young results.

import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // bevar alt som strings; vi caster selv
  parseAttributeValue: false,
  trimValues: true,
});

function asArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// Træk celle-tekst ud. <Cell><Data>val</Data></Cell>.
// fast-xml-parser giver Data enten som string, eller objekt med "#text".
function cellText(cell) {
  if (cell === undefined || cell === null) return "";
  const data = cell.Data;
  if (data === undefined || data === null) return "";
  if (typeof data === "object") {
    const t = data["#text"];
    return t === undefined || t === null ? "" : String(t);
  }
  return String(data);
}

// Konvertér én <Row> til et tæt 0-indekseret array, der respekterer ss:Index.
function rowToArray(row) {
  const out = [];
  let col = 0; // 0-indekseret skrivecursor
  for (const cell of asArray(row.Cell)) {
    const idxAttr = cell["@_ss:Index"];
    if (idxAttr !== undefined) {
      const idx1 = Number.parseInt(idxAttr, 10); // ss:Index er 1-indekseret
      if (!Number.isNaN(idx1)) col = idx1 - 1;
    }
    while (out.length < col) out.push("");
    out.push(cellText(cell));
    col += 1;
  }
  return out;
}

// Parse "…after stage 1/5: …" → { current: 1, total: 5, isFinalStage: false }.
// For endagsløb står der "after stage 1/1" → isFinalStage: true.
// Returnerer null hvis intet mønster findes.
export function parseStageInfo(titleText) {
  const m = /after stage\s+(\d+)\s*\/\s*(\d+)/i.exec(String(titleText || ""));
  if (!m) return null;
  const current = Number.parseInt(m[1], 10);
  const total = Number.parseInt(m[2], 10);
  if (Number.isNaN(current) || Number.isNaN(total)) return null;
  return { current, total, isFinalStage: current === total };
}

// Hjælper: find kolonneindeks (case-insensitivt) i et headers-array.
export function headerIndex(headers, label) {
  const want = String(label).toLowerCase();
  return headers.findIndex((h) => String(h || "").trim().toLowerCase() === want);
}

// Parse hele workbook-bufferen → struktureret form.
// Returnerer:
//   {
//     sheets: [{ name, title, headers:[...], rows:[[...], ...], stageInfo }],
//     stageInfo,  // fra Stage/General results-titlen (autoritativ etape-X/Y)
//   }
export function parsePcmWorkbook(buffer) {
  const xml = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
  let doc;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new Error(`Kunne ikke parse PCM-XML: ${err.message}`, { cause: err });
  }

  const workbook = doc?.Workbook;
  if (!workbook) {
    throw new Error("Ugyldig PCM-fil: <Workbook> mangler (er det en PCM-eksport?)");
  }

  const sheets = [];
  let workbookStageInfo = null;

  for (const ws of asArray(workbook.Worksheet)) {
    const name = String(ws["@_ss:Name"] || "").trim();
    const table = ws.Table;
    if (!table) {
      sheets.push({ name, title: "", headers: [], rows: [], stageInfo: null });
      continue;
    }
    const rawRows = asArray(table.Row).map(rowToArray);
    const title = rawRows.length > 0 ? String(rawRows[0][0] || "") : "";
    const headers =
      rawRows.length > 1 ? rawRows[1].map((h) => String(h || "").trim()) : [];
    const dataRows = rawRows.slice(2);
    const stageInfo = parseStageInfo(title);

    // Stage/General results-titlen bærer det autoritative etape-X/Y.
    const lower = name.toLowerCase();
    if (stageInfo && (lower === "stage results" || lower === "general results")) {
      workbookStageInfo = workbookStageInfo || stageInfo;
    }

    sheets.push({ name, title, headers, rows: dataRows, stageInfo });
  }

  return { sheets, stageInfo: workbookStageInfo };
}
