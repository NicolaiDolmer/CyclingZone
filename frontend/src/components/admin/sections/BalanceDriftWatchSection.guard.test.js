// #3559 — BalanceDriftWatchSection crashede hvis GET /api/admin/balance-drift
// svarede uden days-feltet: renderingen læste `data.days.length` direkte, så en
// fejl-shape/tom body tog hele admin-sektionen med sig (TypeError under render).
//
// Repoet kører `node --test` uden DOM-renderer og uden JSX-loader, så .jsx-filer
// kan ikke importeres. Derfor bor præcis de kodestier der kunne kaste i den rene
// balanceDriftShape.js, som testen eksekverer direkte med de rå payloads
// endpointet kan levere. Kildekode-guarden nederst holder komponenten ærlig: den
// må ikke læse `data.days` / `data.breaches` / `data.bands` udenom
// normaliseringen igen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatBand, formatValue, normalizeBalanceDrift } from "./balanceDriftShape.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "BalanceDriftWatchSection.jsx"), "utf8");

// Metrik-nøglerne komponenten altid renderer en række for — også når serveren
// slet ikke sendte bånd med.
const METRIC_KEYS = [
  "favoriteWinRate",
  "favoritePodiumRate",
  "share4PlusSameTeamTop10",
  "avgDistinctTeamsTop10",
  "dnfRatePct",
  "maxRiderWinRate",
  "jourSansSharePct",
  "breakawayWinSharePct",
];

// Alt endpointet realistisk kan levere når noget er galt: 500-body, tom body,
// ældre deploy uden feltet, forkert type, forgiftede elementer i listerne.
const MALFORMED_PAYLOADS = [
  ["undefined (ingen body)", undefined],
  ["null", null],
  ["tomt objekt", {}],
  ["fejl-shape fra 500", { error: "Kunne ikke hente balance-drift-data" }],
  ["days: null", { days: null, breaches: [], bands: {} }],
  ["days: streng", { days: "14", breaches: [], bands: {} }],
  ["days: objekt i stedet for liste", { days: { "2026-08-13": {} } }],
  ["array i stedet for objekt", []],
  ["streng i stedet for objekt", "ikke json"],
  ["kun bands (days mangler)", { bands: { favoriteWinRate: { min: 0.2, max: 0.4 } } }],
  ["days ok, breaches/bands mangler", { days: [{ date: "2026-08-13", statuses: {} }] }],
  ["forgiftede elementer", { days: [null, {}, { date: 5 }, { date: "" }], breaches: [null, "x"], bands: null }],
];

// Simulerer komponentens render-læsninger af den normaliserede shape: præcis de
// udtryk der kastede før fixet (days.length, breaches.length, bands[key] videre
// til formatBand, d.date.slice(5), formatValue på celleværdien).
function renderReads(raw) {
  const { ok, days, breaches, bands } = normalizeBalanceDrift(raw);
  const out = [ok, days.length, breaches.length];
  if (!ok || days.length === 0) return out;

  out.push(days[days.length - 1].date);
  out.push(breaches.map(b => `${b.metric} (${b.days}d siden ${b.since})`).join(" · "));
  for (const day of days) out.push(day.date.slice(5));
  for (const key of METRIC_KEYS) {
    out.push(formatBand(bands[key]));
    for (const day of days) out.push(formatValue(key, day.statuses?.[key]?.value));
  }
  return out;
}

test("#3559 render-læsningerne kaster ikke på et svar uden days-feltet", () => {
  for (const [label, payload] of MALFORMED_PAYLOADS) {
    assert.doesNotThrow(() => renderReads(payload), `payload "${label}" fik render-læsningerne til at kaste`);
  }
});

test("#3559 normalizeBalanceDrift giver altid rendérbare defaults", () => {
  for (const [label, payload] of MALFORMED_PAYLOADS) {
    const { days, breaches, bands } = normalizeBalanceDrift(payload);
    assert.ok(Array.isArray(days), `${label}: days skal være en liste`);
    assert.ok(Array.isArray(breaches), `${label}: breaches skal være en liste`);
    assert.ok(bands && typeof bands === "object" && !Array.isArray(bands), `${label}: bands skal være et objekt`);
    for (const day of days) {
      assert.equal(typeof day.date, "string", `${label}: en rendérbar dag skal have en streng-dato`);
      assert.ok(day.date.length > 0, `${label}: en rendérbar dag må ikke have tom dato`);
    }
    for (const breach of breaches) {
      assert.equal(typeof breach, "object", `${label}: breaches må kun indeholde objekter`);
      assert.notEqual(breach, null);
    }
  }
});

test("#3559 manglende days-liste er fejl-state, tom days-liste er empty-state", () => {
  // Skellet afgør om admin ser "uventet svar" (noget er galt med endpointet)
  // eller "ingen målinger endnu" (cron'en har bare ikke kørt endnu).
  assert.equal(normalizeBalanceDrift({ breaches: [], bands: {} }).ok, false);
  assert.equal(normalizeBalanceDrift(undefined).ok, false);
  assert.equal(normalizeBalanceDrift({ days: [] }).ok, true);
  assert.equal(normalizeBalanceDrift({ days: [] }).days.length, 0);
});

test("#3559 et lovligt svar renderes uændret (guarden må ikke spise ægte data)", () => {
  const payload = {
    days: [
      { date: "2026-08-12", statuses: { favoriteWinRate: { status: "green", value: 0.2534 }, dnfRatePct: { status: "yellow", value: 3.216 } } },
      { date: "2026-08-13", statuses: { favoriteWinRate: { status: "red", value: 0.4 }, avgDistinctTeamsTop10: { status: "green", value: 6.44 } } },
    ],
    breaches: [{ metric: "favoriteWinRate", days: 3, since: "2026-08-11" }],
    bands: {
      favoriteWinRate: { min: 0.18, max: 0.32 },
      dnfRatePct: { max: 5 },
      avgDistinctTeamsTop10: { min: 5 },
      jourSansSharePct: { reportOnly: true },
    },
  };

  const { ok, days, breaches, bands } = normalizeBalanceDrift(payload);
  assert.equal(ok, true);
  assert.equal(days.length, 2);
  assert.equal(breaches.length, 1);
  assert.equal(days[days.length - 1].date, "2026-08-13");

  assert.equal(formatBand(bands.favoriteWinRate), "0.18–0.32");
  assert.equal(formatBand(bands.dnfRatePct), "≤5");
  assert.equal(formatBand(bands.avgDistinctTeamsTop10), "≥5");
  assert.equal(formatBand(bands.jourSansSharePct), "rapport-only");
  assert.equal(formatBand(bands.maxRiderWinRate), "—", "ukendt metrik uden bånd skal vises som — i stedet for at kaste");

  assert.equal(formatValue("favoriteWinRate", 0.2534), "25.3%");
  assert.equal(formatValue("dnfRatePct", 3.216), "3.22%");
  assert.equal(formatValue("avgDistinctTeamsTop10", 6.44), "6.4");
  assert.equal(formatValue("favoriteWinRate", undefined), "—");
  assert.equal(formatValue("dnfRatePct", "3.2"), "—", "en ikke-numerisk værdi fra serveren må ikke kaste på .toFixed()");
});

test("#3559 komponenten læser ikke det rå svar udenom normaliseringen", () => {
  assert.match(
    source,
    /const \{ ok, days, breaches, bands \} = normalizeBalanceDrift\(data\);/,
    "komponenten skal hente sin render-shape gennem normalizeBalanceDrift(data)",
  );
  const rawRead = /\bdata\.(days|breaches|bands)\b/.exec(source);
  assert.equal(
    rawRead,
    null,
    `komponenten læser stadig direkte på svaret (${rawRead?.[0]}). Det var præcis dét der crashede sektionen da days manglede — læs fra den normaliserede shape i stedet.`,
  );
});

test("#3559 fejl- og empty-state bruger de kanoniske states, ikke bar tekst", () => {
  assert.match(source, /<ErrorState\b/, "fejl-tilstanden skal bruge den kanoniske ErrorState (PAGE_TEMPLATES states-sheet)");
  assert.match(source, /<EmptyState\b/, "tom-tilstanden skal bruge den kanoniske EmptyState (PAGE_TEMPLATES states-sheet)");
});
