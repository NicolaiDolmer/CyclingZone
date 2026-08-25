// #3385 — nightly klokke-drift-detektor.
//
// Delt mellem frontend og backend (derfor repo-roden, ikke frontend/scripts/),
// flyttet 25/8 da detektoren blev udvidet til backend, se AGENTS.md hard rule 16.
// Backends runner spawner child-processer, så DER skal modulet loades via
// NODE_OPTIONS (arves af children), ikke et bart `--import`-flag på forælderen.
//
// Preload-modul (kør via `node --import`) der skubber "nu" et antal dage frem
// UDEN at ændre systemuret (kan ikke på Windows-dev-maskiner, og skal ikke på
// CI-runneren heller — andre jobs deler samme runner-image).
//
// Kun det der repræsenterer "læs vægur-tiden" flyttes: `new Date()` (ingen
// argumenter) og `Date.now()`. Et eksplicit `new Date("2026-08-05...")` eller
// `new Date(y, m, d)` er forfatterens data, ikke en klokke-aflæsning, og
// forbliver derfor UÆNDRET — ellers ville vi flytte testenes egne faste
// tidsstempler og ikke bare afsløre hvor koden faldt tilbage på ægte "nu".
//
// Reproducerer PRÆCIS #3385-mekanismen: en test der bygger en fast
// FAR_FUTURE-konstant og kalder produktionskoden UDEN et `now`-argument falder
// tilbage på denne (fremskudte) "nu" — akkurat som den ville falde tilbage på
// den ægte vægur-tid i produktion efter FAR_FUTURE er passeret.
const offsetDaysRaw = process.env.CZ_TEST_CLOCK_OFFSET_DAYS;
const offsetDays = Number(offsetDaysRaw);

if (!offsetDaysRaw || !Number.isFinite(offsetDays) || offsetDays === 0) {
  console.warn(
    "[fake-clock-preload] CZ_TEST_CLOCK_OFFSET_DAYS er ikke sat (eller 0) — klokken er UÆNDRET. " +
      "Dette preload-modul er en no-op i den tilstand.",
  );
} else {
  const offsetMs = offsetDays * 24 * 60 * 60 * 1000;
  const RealDate = Date;

  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(RealDate.now() + offsetMs);
      } else {
        // @ts-expect-error — spread ind i Date-konstruktøren er korrekt her
        super(...args);
      }
    }

    static now() {
      return RealDate.now() + offsetMs;
    }
  }

  globalThis.Date = FakeDate;
  console.warn(
    `[fake-clock-preload] Klokken er skubbet ${offsetDays} dage frem ` +
      `(ny "nu": ${new Date().toISOString()}). Kun new Date()/Date.now() uden ` +
      "argumenter er påvirket.",
  );
}
