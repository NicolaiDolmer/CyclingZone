// XP-modellens dagsvariation (#6110, spec §4.2 og §5.2, ejervalg 7/11).
//
// ═══ HVORFOR ═════════════════════════════════════════════════════════════════
// XP-tallet vises for spilleren, og XP pr. dag er selve potentialet. Uden variation
// kan talentet regnes ud på få datoer. Ejeren valgte 7/11 en bred variation MED
// hukommelse: gode og dårlige perioder, som skjuler talentet længere end en ren
// dag-for-dag-variation ved samme daglige udsving (gate X9, H6b).
//
// ═══ KRAV ════════════════════════════════════════════════════════════════════
//  1. Deterministisk pr. (rytter, dato): en gen-kørsel af datoen giver samme tal.
//  2. Neutral over en sæson: forventningen er 1, så sæsonens samlede udbytte ikke flytter sig.
//  3. HEMMELIG NØGLE: repoet er offentligt, og seededUnitMixed er en åben hash. Med
//     kun rytter og dato som seed kunne en spiller regne variationen efter og trække
//     den fra. Hvert træk er derfor en HMAC med en nøgle, der kun findes i
//     private_config. Nøglen logges aldrig, skrives aldrig i rapporter og sendes
//     aldrig til klienten.
//  4. Hukommelse uden lager: tilstanden for en dato regnes fra trækkene for de
//     foregående datoer, så motoren ikke skal gemme noget, og en dato kan regnes
//     om alene. Formen er den samme som 10-sæsoners-kørslens variationSeries, så
//     det, kørslen måler, er det, motoren kører.
//
// ═══ NØGLEN I HUKOMMELSEN ════════════════════════════════════════════════════
// Den validerede variation er et frosset objekt med bredde og hukommelse. Nøglen
// ligger IKKE på objektet, men i et modul-privat WeakMap. Så kan params skrives
// med JSON.stringify, console.log eller util.inspect (fx i en kørsels-nøgle eller
// en fejlmeddelelse) uden at nøglen kommer med.
//
// Tallene (bredde og hukommelse) er private (hard rule 17) og står kun i params.

import { createHmac } from "node:crypto";

export interface XpVariation {
  /** Største udsving som andel af dagens XP. Over 0 og under 1, så XP aldrig bliver nul. */
  readonly span: number;
  /** Hvor meget af gårsdagens tilstand der bæres med. 0 = dag for dag, under 1. */
  readonly memory: number;
}

// En kort nøgle kan gættes; kravet er beskedent, og nøglen sættes af ejeren.
const MIN_KEY_LENGTH = 32;
// Hvor mange datoer tilbage hukommelsen regnes over. Resten af fortiden står i ét
// samlet træk, så variansen er den samme uanset vinduet. Det træk skifter frit fra
// dato til dato, så vinduet skal være langt nok til, at det vejer lidt; ellers
// ville en høj hukommelse give MINDRE sammenhæng mellem datoerne (Codex-fund).
// En hukommelse, der kræver mere end det største vindue, afvises i valideringen.
const MAX_WINDOW = 1000;
const WINDOW_TAIL = 0.05;
// Hver HMAC giver 32 byte = otte træk, så en hukommelse over mange datoer koster få kald.
const DRAWS_PER_BLOCK = 8;
const DOMAIN = "cz-xp-variation-v1";
const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const KEYS = new WeakMap<XpVariation, string>();

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Validerer variationsfelterne. `undefined` betyder ingen variation (feltet er ikke
 * sat). Er feltet sat, skal det være gyldigt, ellers er hele params ugyldige
 * (null), så motoren falder tilbage til dagens model i stedet for at køre XP uden
 * den variation, ejeren har krævet.
 */
export function validateXpVariation(raw: unknown): XpVariation | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.key !== "string" || v.key.length < MIN_KEY_LENGTH) return null;
  if (!isNum(v.span) || !(v.span > 0 && v.span < 1)) return null;
  if (!isNum(v.memory) || !(v.memory >= 0 && v.memory < 1)) return null;
  // Hukommelsen skal kunne regnes inden for vinduet, ellers forsvinder perioderne.
  if (fullWindow(v.memory) > MAX_WINDOW) return null;
  const variation: XpVariation = Object.freeze({ span: v.span, memory: v.memory });
  KEYS.set(variation, v.key);
  return variation;
}

/** Dagsnummer fra en dansk dato (YYYY-MM-DD), ellers null. Ingen ur, kun kalenderen. */
function dayIndex(dateStr: unknown): number | null {
  if (typeof dateStr !== "string") return null;
  const m = DATE_RE.exec(dateStr);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== dateStr) return null;
  return Math.round(t / DAY_MS);
}

/** Antal datoer, hukommelsen skal regnes over, før fortidens samlede træk vejer lidt. */
function fullWindow(memory: number): number {
  if (!(memory > 0)) return 0;
  return Math.ceil(Math.log(WINDOW_TAIL) / Math.log(memory));
}

/** Antal datoer, hukommelsen regnes over (valideringen sikrer, at loftet ikke binder). */
function windowFor(memory: number): number {
  return Math.min(MAX_WINDOW, fullWindow(memory));
}

/**
 * Dagens variation for én rytter: en faktor omkring 1, som ganges på dagens XP.
 * Uden variation (null/undefined) er faktoren præcis 1. Ukendt rytter eller dato
 * giver også 1, så korrupt input aldrig giver ekstra fart.
 */
export function developmentXpDayVariation(
  { riderId, dateStr }: { riderId: unknown; dateStr: unknown },
  variation: XpVariation | null | undefined,
): number {
  if (!variation) return 1;
  const key = KEYS.get(variation);
  // Et variations-objekt uden nøgle er en programfejl (fx en kopi af params, der ikke
  // er valideret). Hellere stoppe datoen end at køre XP uden den krævede variation.
  if (key === undefined) throw new Error("[development-xp] variation without a registered key - params must come from validateDevelopmentXpParams");
  if (riderId === null || riderId === undefined || riderId === "") return 1;
  const day = dayIndex(dateStr);
  if (day === null) return 1;

  const blocks = new Map<number, Buffer>();
  // Et træk i [-1, 1) for (rytter, dagsnummer), kun til at regne med nøglen.
  const draw = (d: number): number => {
    const block = Math.floor(d / DRAWS_PER_BLOCK);
    let bytes = blocks.get(block);
    if (!bytes) {
      bytes = createHmac("sha256", key).update(`${DOMAIN}:${String(riderId)}:${block}`).digest();
      blocks.set(block, bytes);
    }
    const slot = d - block * DRAWS_PER_BLOCK;
    return 2 * ((bytes.readUInt32BE(slot * 4) + 0.5) / 2 ** 32) - 1;
  };

  const { span, memory } = variation;
  const window = windowFor(memory);
  let state: number;
  if (window === 0) {
    state = draw(day);
  } else {
    // Tilstanden er en vægtet sum af de seneste træk, hvor ældre datoer vejer
    // mindre. Det ældste led står for hele fortiden før vinduet, så tilstandens
    // spredning er den samme som i den uendelige proces.
    const fresh = Math.sqrt(1 - memory * memory);
    state = Math.pow(memory, window) * draw(day - window);
    let weight = 1;
    for (let k = 0; k < window; k++) {
      state += weight * fresh * draw(day - k);
      weight *= memory;
    }
  }
  // Klippet er symmetrisk, så forventningen forbliver 1.
  return 1 + span * Math.max(-1, Math.min(1, state));
}
