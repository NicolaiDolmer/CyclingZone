// Storage-less, consent-uafhængig visit-dedup (#2040). Hash inkluderer dagen, så
// samme besøgende får ÉT hash pr. dag (dedup) men er UNLINKABLE på tværs af dage.
// Intet lægges på brugerens enhed; rå IP/UA gemmes aldrig — kun dette hash.
import { createHash } from "node:crypto";

export function dayString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function computeVisitHash({ ip, ua, day, secret }) {
  const input = `${ip || ""}|${ua || ""}|${day || ""}|${secret || ""}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}
