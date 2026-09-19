import test from "node:test";
import assert from "node:assert/strict";
import { buildSponsorMetadata } from "./economyEngine.js";

// #4861 — buildSponsorMetadata (backend/lib/economyEngine.js:~1298) mappede kun
// mode "variable"/"fallback" til deres egne i18n-koder; alt andet (inkl. mode
// "contract" fra en aktiv, forhandlet sponsorkontrakt, #1663) faldt igennem til
// else-grenens "tx.sponsor.seasonStartIntro" — så finanslogget viste sæson-
// startens sponsorlinje som "intro" for et hold med en navngivet kontraktsponsor.
// sponsorEngine.js's computeSponsorForSeason returnerer mode:"contract" for
// ALLE hold med en aktiv kontrakt (linje ~98), så bugget ramte hvert eneste af
// dem. SPONSOR_RULES.md §5: budget-modifier og sponsor-pullout ganger den
// garanterede base uanset mode — modifier/pulloutActive behandles derfor
// præcis som variable/fallback-grenene.

test("#4861: mode 'contract' mapper til seasonStartContract, ikke intro", () => {
  const breakdown = { mode: "contract", base: 500_000, gross_sponsor: 500_000, sponsor_name: "Rouleur Coffee" };
  const meta = buildSponsorMetadata(breakdown, 1.1, false);
  assert.equal(meta.code, "tx.sponsor.seasonStartContract");
  assert.deepEqual(meta.params, { modifier: 1.1, base: 500_000, sponsor: "Rouleur Coffee" });
});

test("#4861: mode 'contract' + aktiv pullout mapper til Pullout-varianten", () => {
  const breakdown = { mode: "contract", base: 340_000, gross_sponsor: 340_000, sponsor_name: "Nordisk Stål" };
  const meta = buildSponsorMetadata(breakdown, 1.0, true);
  assert.equal(meta.code, "tx.sponsor.seasonStartContractPullout");
  assert.deepEqual(meta.params, { modifier: 1.0, base: 340_000, sponsor: "Nordisk Stål" });
});

test("#4861: mode 'contract' uden sponsor_name falder tilbage til 'Your sponsor' (samme konvention som sponsorContractsService.js)", () => {
  const breakdown = { mode: "contract", base: 400_000, gross_sponsor: 400_000, sponsor_name: null };
  const meta = buildSponsorMetadata(breakdown, 1.0, false);
  assert.equal(meta.params.sponsor, "Your sponsor");
});

// Forward-guard: de eksisterende rækker/moder må IKKE ændre kode eller params.
test("#4861 forward-guard: mode 'variable' er uændret", () => {
  const breakdown = { mode: "variable", base: 340_000, variable: 75_000, gross_sponsor: 415_000 };
  const meta = buildSponsorMetadata(breakdown, 1.0, false);
  assert.equal(meta.code, "tx.sponsor.seasonStartVariable");
  assert.deepEqual(meta.params, { modifier: 1.0, base: 340_000, variable: 75_000 });
});

test("#4861 forward-guard: mode 'variable' + pullout er uændret", () => {
  const breakdown = { mode: "variable", base: 340_000, variable: 75_000, gross_sponsor: 415_000 };
  const meta = buildSponsorMetadata(breakdown, 1.0, true);
  assert.equal(meta.code, "tx.sponsor.seasonStartVariablePullout");
});

test("#4861 forward-guard: mode 'fallback' er uændret", () => {
  const breakdown = { mode: "fallback", gross_sponsor: 260_000 };
  const meta = buildSponsorMetadata(breakdown, 1.0, false);
  assert.equal(meta.code, "tx.sponsor.seasonStartFallback");
  assert.deepEqual(meta.params, { modifier: 1.0, amount: 260_000 });
});

test("#4861 forward-guard: mode 'intro' (rigtig sæson-1-introsæson) er uændret", () => {
  const breakdown = { mode: "intro", gross_sponsor: 240_000 };
  const meta = buildSponsorMetadata(breakdown, 1.0, false);
  assert.equal(meta.code, "tx.sponsor.seasonStartIntro");
  assert.deepEqual(meta.params, { modifier: 1.0, amount: 240_000 });
});

test("#4861 forward-guard: manglende mode falder stadig tilbage til intro (legacy-rækker)", () => {
  const meta = buildSponsorMetadata({ gross_sponsor: 200_000 }, 1.0, false);
  assert.equal(meta.code, "tx.sponsor.seasonStartIntro");
});
