// Fair-play prisbånd (#3133): gulv OG loft på hvad en rytter må skifte hænder
// for mellem to spillere. Dækker tre håndhævelsespunkter (alle server-side,
// alle i routes/api.js):
//   - PATCH /api/transfers/offers/:id  action=accept / accept_counter
//   - PATCH /api/transfers/swaps/:id   action=accept / accept_counter (SAMLET
//     værdi inkl. cash_adjustment/counter_cash)
//   - POST  /api/auctions              starting_price ved oprettelse (kun
//     EGEN rytter — bank/AI-salg har sit eget gulv, se
//     auctionRules.getAuctionStartPriceIssue, og er ikke spiller-til-spiller)
//
// #2803 lærte os at UI-checks ikke er nok: køberen kunne selv sætte
// seller_confirmed, og swaps havde slet ingen værdikontrol. Begge kendte
// snydesager udnyttede præcis det hul (#2776: 1 kr. stykket for ryttere værd
// ~1,97 mio. samlet; #2221: handler til 15-16× markedsværdi den anden vej,
// hvor kontanter flyttede værdien i stedet for ryttere).
//
// Grænserne bor i app_config (nøglerne nedenfor), IKKE hardcodet, så de kan
// justeres uden deploy. #3136 (empirisk rekalibrering) leverer de rigtige
// tal — DEFAULT her er DEAKTIVERET (floor_pct=0, cap_multiple=null): shippet
// med denne PR ændrer mekanikken intet, før ejeren selv skriver reelle
// værdier i app_config.
//
// Fail-safe-retning: en læse-fejl (DB nede, netværk, malformed value) falder
// tilbage til DISABLED (floor_pct=0, cap_multiple=null) — samme tilstand som
// "ingen konfiguration sat endnu". Det er den MODSATTE retning af
// featureStage.evaluateFlagStage (adgangskontrol, hvor fail-safe = ingen
// adgang): her er den sikre retning at IKKE indføre nye falske afvisninger af
// legitime handler under en forbigående DB-fejl. Mekanismen er i forvejen
// slået fra som default, så fail-open betyder blot "ingen adfærdsændring",
// aldrig et sikkerhedshul (loft/gulv var aldrig håndhævet før denne PR).

export const TRANSFER_PRICE_FLOOR_PCT_KEY = "transfer_price_floor_pct";
export const TRANSFER_PRICE_CAP_MULTIPLE_KEY = "transfer_price_cap_multiple";

const DISABLED_CONFIG = Object.freeze({ floorPct: 0, capMultiple: null });

// Læs de to config-nøgler fra app_config. Returnerer altid { floorPct,
// capMultiple } — aldrig null/undefined felter — så kaldere kan sprede
// resultatet direkte ind i getPriceBandViolation/getSwapPriceBandViolation.
export async function readTransferPriceBandConfig(supabase) {
  if (!supabase?.from) return { ...DISABLED_CONFIG };
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("key, value")
      .in("key", [TRANSFER_PRICE_FLOOR_PCT_KEY, TRANSFER_PRICE_CAP_MULTIPLE_KEY]);
    if (error || !Array.isArray(data)) return { ...DISABLED_CONFIG };

    const byKey = Object.fromEntries(data.map((row) => [row.key, row.value]));
    const floorRaw = byKey[TRANSFER_PRICE_FLOOR_PCT_KEY];
    const capRaw = byKey[TRANSFER_PRICE_CAP_MULTIPLE_KEY];

    const floorPct = typeof floorRaw === "number" && Number.isFinite(floorRaw) && floorRaw > 0
      ? floorRaw
      : 0;
    const capMultiple = typeof capRaw === "number" && Number.isFinite(capRaw) && capRaw > 0
      ? capRaw
      : null;

    return { floorPct, capMultiple };
  } catch {
    // best-effort: config-læsning må aldrig vælte selve transfer/swap/auktions-
    // requesten den kaldes fra. Fail-safe er DISABLED (se fil-header) — samme
    // tilstand som "ingen konfiguration sat endnu", ikke et sikkerhedshul.
    return { ...DISABLED_CONFIG };
  }
}

// Ren funktion: er `price` inden for [floorPct×marketValue, capMultiple×marketValue]?
// - floorPct <= 0 → intet gulv.
// - capMultiple null/undefined → intet loft.
// - marketValue ikke et positivt, endeligt tal → intet at sammenligne imod,
//   skip (data-integritet på market_value er ikke denne funktions ansvar).
export function getPriceBandViolation({ price, marketValue, floorPct = 0, capMultiple = null } = {}) {
  const p = Number(price);
  const v = Number(marketValue);
  if (!Number.isFinite(p) || !Number.isFinite(v) || v <= 0) return null;

  if (floorPct > 0) {
    const floorPrice = Math.round(v * floorPct);
    if (p < floorPrice) {
      return { code: "below_price_floor", floorPrice, floorPct, marketValue: v, price: p };
    }
  }

  if (capMultiple !== null && capMultiple !== undefined) {
    const capPrice = Math.round(v * capMultiple);
    if (p > capPrice) {
      return { code: "above_price_cap", capPrice, capMultiple, marketValue: v, price: p };
    }
  }

  return null;
}

// Swap-variant: to ryttere + cash_adjustment (SAMLET værdi, jf. issue-AC). En
// swap modelleres som to implicitte køb limet sammen af kontant-udligningen:
//   - proposing_team "betaler" for requested-rytteren med:
//       offered.market_value + cash   (cash > 0 = proposing lægger kontant OVEN
//       I sin rytter — se executeSwapOffer: payerId = cash>0 ? proposing : receiving)
//   - receiving_team "betaler" for offered-rytteren med:
//       requested.market_value - cash (cash > 0 = receiving MODTAGER kontant,
//       hvilket sænker deres effektive pris for offered-rytteren)
// Begge retninger tjekkes hver mod deres modparts market_value. Det er netop
// denne dobbelt-check der fanger #2221-mønsteret (kontanter flyttet i stedet
// for ryttere): en ekstrem cash_adjustment presser MINDST én af de to
// effektive priser uden for båndet, uanset hvilken retning kontanterne går.
export function getSwapPriceBandViolation({
  offeredMarketValue,
  requestedMarketValue,
  cashAdjustment = 0,
  floorPct = 0,
  capMultiple = null,
} = {}) {
  const cash = Number(cashAdjustment) || 0;

  const proposingPaid = Number(offeredMarketValue) + cash;
  const proposingIssue = getPriceBandViolation({
    price: proposingPaid,
    marketValue: requestedMarketValue,
    floorPct,
    capMultiple,
  });
  if (proposingIssue) {
    return {
      ...proposingIssue,
      side: "proposing",
      effectivePrice: proposingPaid,
      comparedMarketValue: Number(requestedMarketValue),
    };
  }

  const receivingPaid = Number(requestedMarketValue) - cash;
  const receivingIssue = getPriceBandViolation({
    price: receivingPaid,
    marketValue: offeredMarketValue,
    floorPct,
    capMultiple,
  });
  if (receivingIssue) {
    return {
      ...receivingIssue,
      side: "receiving",
      effectivePrice: receivingPaid,
      comparedMarketValue: Number(offeredMarketValue),
    };
  }

  return null;
}
