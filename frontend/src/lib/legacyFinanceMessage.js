const KNOWN_TYPES = new Set([
  "sponsor",
  "salary",
  "transfer_out",
  "transfer_in",
  "loan_received",
  "loan_repayment",
  "loan_interest",
  "emergency_loan",
  "prize",
  "bonus",
  "admin_adjustment",
  "interest",
  "academy_signing",
]);

const SIMPLE_CODES = {
  loan_received: "tx.legacy.loanReceived",
  loan_repayment: "tx.legacy.loanRepayment",
  loan_interest: "tx.legacy.loanInterest",
  emergency_loan: "tx.legacy.emergencyLoan",
  bonus: "tx.legacy.bonus",
  interest: "tx.legacy.interest",
  admin_adjustment: "tx.legacy.adminAdjustment",
};

function capturedParam(description, pattern, paramName) {
  const match = description.match(pattern);
  return match ? { [paramName]: match[1].trim() } : null;
}

// #1483: byttehandel-kontant skrev sin description med begge rytternavne adskilt
// af et venstre-hoejre-pil-tegn (U+2194), men uden metadata paa begge ben
// (payer=transfer_out, receiver=transfer_in) -> udtraek begge navne saa retro-rows
// ogsaa viser dem. Pil-tegnet (U+2194) skrives som \u2194-escape i regex, ikke
// som literal-tegn, saa ui-slop-guarden ikke taeller det som emoji-ikon.
function swapCashParams(description) {
  const match = description.match(/^Byttehandel kontantbetaling:\s*(.+?)\s*\u2194\s*(.+)$/i);
  if (!match) return null;
  return { code: "tx.swapCash", params: { offeredName: match[1].trim(), requestedName: match[2].trim() } };
}

export function resolveLegacyFinanceMessage(tx) {
  if (tx?.metadata?.code) return tx.metadata;

  const type = tx?.type || "";
  const description = String(tx?.description || "").trim();

  if (type === "sponsor") {
    const params = capturedParam(description, /^Sponsor(?:indtægt)?(?:\s*[-·:]?\s*)sæson\s+(\d+)$/i, "season");
    if (params) return { code: "tx.legacy.sponsor", params };
  }
  if (type === "salary") {
    const params = capturedParam(description, /^Løn(?:ninger)?(?:\s*[-·:]?\s*)sæson\s+(\d+)$/i, "season");
    if (params) return { code: "tx.legacy.salary", params };
  }
  if (type === "prize") {
    const params = capturedParam(description, /^Præmiepenge\s*[-—·:]\s*(.+)$/i, "raceName");
    if (params) return { code: "tx.legacy.prize", params };
  }
  if (type === "transfer_out") {
    // #1483: auktions-køb skrev "Købt <navn> på auktion" uden metadata → fald
    // tilbage til regex-udtræk så retro-rows også viser rytternavnet.
    const auctionBuy = capturedParam(description, /^Købt\s+(.+?)\s+på auktion$/i, "riderName");
    if (auctionBuy) return { code: "tx.auctionBuy", params: auctionBuy };
    // #1483: transfer-vindue-køb skrev "Købt <navn> via transfer" uden metadata.
    const transferBuy = capturedParam(description, /^Købt\s+(.+?)\s+via transfer$/i, "riderName");
    if (transferBuy) return { code: "tx.transferBuy", params: transferBuy };
    const swapCash = swapCashParams(description);
    if (swapCash) return swapCash;
    const params = capturedParam(description, /^(?:Køb af|Transfer-køb\s*[-—·:]?)\s*(.+)$/i, "detail");
    if (params) return { code: "tx.legacy.transferPurchase", params };
  }
  if (type === "transfer_in") {
    // #1483: auktions-salg + garanteret AI-salg.
    const auctionSell = capturedParam(description, /^Solgt\s+(.+?)\s+på auktion$/i, "riderName");
    if (auctionSell) return { code: "tx.auctionSell", params: auctionSell };
    // #1483: transfer-vindue-salg skrev "Solgt <navn> via transfer" uden metadata.
    const transferSell = capturedParam(description, /^Solgt\s+(.+?)\s+via transfer$/i, "riderName");
    if (transferSell) return { code: "tx.transferSell", params: transferSell };
    const swapCash = swapCashParams(description);
    if (swapCash) return swapCash;
    const aiSale = capturedParam(description, /^Garanteret AI-salg:\s*(.+)$/i, "riderName");
    if (aiSale) return { code: "tx.guaranteedAiSale", params: aiSale };
    const params = capturedParam(description, /^(?:Salg af|Transfer-salg\s*[-—·:]?)\s*(.+)$/i, "detail");
    if (params) return { code: "tx.legacy.transferSale", params };
  }
  if (type === "academy_signing") {
    // #1483: ungdomsauktions-vinder + akademi-signing skrev rytternavn (eller
    // rå UUID) i description; udtræk så Historik-fanen viser navnet.
    const youthWin = capturedParam(description, /^Vandt ungdomsrytter\s+(.+?)\s+på auktion$/i, "riderName");
    if (youthWin) return { code: "tx.youthAuctionWin", params: youthWin };
    const signing = capturedParam(description, /^Akademi-signing af\s+(.+)$/i, "riderName");
    if (signing) return { code: "tx.academySigning", params: signing };
  }
  if (SIMPLE_CODES[type] && description) {
    return { code: SIMPLE_CODES[type], params: {} };
  }
  if (KNOWN_TYPES.has(type)) {
    return { typeKey: `transactions.type.${type}` };
  }
  return { fallback: description };
}
