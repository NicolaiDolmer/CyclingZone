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
    const params = capturedParam(description, /^(?:Køb af|Transfer-køb\s*[-—·:]?)\s*(.+)$/i, "detail");
    if (params) return { code: "tx.legacy.transferPurchase", params };
  }
  if (type === "transfer_in") {
    // #1483: auktions-salg + garanteret AI-salg.
    const auctionSell = capturedParam(description, /^Solgt\s+(.+?)\s+på auktion$/i, "riderName");
    if (auctionSell) return { code: "tx.auctionSell", params: auctionSell };
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
