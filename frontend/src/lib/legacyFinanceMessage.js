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
    const params = capturedParam(description, /^(?:Køb af|Transfer-køb\s*[-—·:]?)\s*(.+)$/i, "detail");
    if (params) return { code: "tx.legacy.transferPurchase", params };
  }
  if (type === "transfer_in") {
    const params = capturedParam(description, /^(?:Salg af|Transfer-salg\s*[-—·:]?)\s*(.+)$/i, "detail");
    if (params) return { code: "tx.legacy.transferSale", params };
  }
  if (SIMPLE_CODES[type] && description) {
    return { code: SIMPLE_CODES[type], params: {} };
  }
  if (KNOWN_TYPES.has(type)) {
    return { typeKey: `transactions.type.${type}` };
  }
  return { fallback: description };
}
