// #7535 valg-skitser: de 8 punkter fra "Gennemgang af #8216" (issue-kommentar 16/11) med
// 2-3 varianter hver. Hver variant er en konfiguration af den samme side; alt det et punkt
// ikke handler om, står som i runde 3 (#8216), så billederne kun viser forskellen.
// Teksten i captionen brændes ind øverst i billedet: punkt, bogstav, navn, én sætning.

export type View = "squad" | "tactics" | "peak";

export interface Config {
  view: View;
  /** Punkt 1: hvordan Taktik-visningen ser ud. */
  tactics: "raceTab" | "compact" | "link";
  /** Punkt 2: mobil-arkets opbygning. */
  sheet: "today" | "sticky" | "cards";
  /** Punkt 3: status pr. løb i løbslisten. */
  status: "squad" | "full" | "single";
  /** Punkt 4: hvor meget der står før første rytter. */
  head: "today" | "compact" | "folded";
  /** Punkt 5: kolonnen "Efter løbet". */
  after: "today" | "finish" | "none";
  /** Punkt 6: Formtop-visningens kobling til truppen. */
  peak: "today" | "linked" | "column";
  /** Punkt 7: trup-tabellens kolonner. */
  table: "today" | "status" | "roleChip";
  /** Punkt 8: hvor der gemmes. */
  save: "today" | "follows" | "bar";
  /** Punkt 8: truppen har ugemte ændringer. */
  squadDirty: boolean;
  /** Mobil: vis løbslisten i stedet for arket. */
  mobileList: boolean;
  /** Rul hertil før billedet (element-id), så punktet står i billedet. */
  anchor?: string;
  mobileAnchor?: string;
}

export const BASE: Config = {
  view: "squad",
  tactics: "raceTab",
  sheet: "today",
  status: "squad",
  head: "today",
  after: "today",
  peak: "today",
  table: "today",
  save: "today",
  squadDirty: false,
  mobileList: false,
};

export interface Variant {
  id: string;
  point: number;
  letter: "A" | "B" | "C";
  name: string;
  /** Én sætning: fordel; ulempe. */
  line: string;
  recommended: boolean;
  /** Kort note ved siden af anbefalingen (fx rækkefølge). */
  recNote?: string;
  cfg: Partial<Config>;
  /** Hele siden i ét billede (desktop/mobil) i stedet for én skærm. */
  fullD?: boolean;
  fullM?: boolean;
}

export const POINTS: Record<number, string> = {
  1: "Taktik",
  2: "Mobil-ark",
  3: "Status pr. løb",
  4: "Plads før data",
  5: "\"Efter løbet\"",
  6: "Formtop",
  7: "Trup-tabel",
  8: "Gem",
};

export const VARIANTS: Variant[] = [
  {
    id: "1a", point: 1, letter: "A", name: "Løbssidens taktik-fane, rettet",
    fullD: true, fullM: true,
    line: "Fordel: præcis samme taktik som løbssiden (tændt for alle), ét guld \"Gem etape 1\" og ingen intro, kan laves straks; ulempe: lang og fylder som en side i siden.",
    recommended: false, recNote: "Trin 1, straks",
    cfg: { view: "tactics", tactics: "raceTab", anchor: "view-switch", mobileAnchor: "view-switch" },
  },
  {
    id: "1b", point: 1, letter: "B", name: "Kompakt planlægnings-udgave",
    fullD: true, fullM: true,
    line: "Fordel: holdplan på ét kort og én række pr. rytter med plan-chips og pris i ord, samme gem som løbssiden; ulempe: en ny visning at holde i takt med løbssiden.",
    recommended: true, recNote: "Mål efter A",
    cfg: { view: "tactics", tactics: "compact", anchor: "view-switch", mobileAnchor: "view-switch" },
  },
  {
    id: "1c", point: 1, letter: "C", name: "Kun status + link til løbssiden",
    fullD: true, fullM: true,
    line: "Fordel: intet dobbelt, status pr. etape ses her og taktikken sættes ét sted; ulempe: man forlader planlægningen for at sætte taktik.",
    recommended: false,
    cfg: { view: "tactics", tactics: "link", anchor: "view-switch", mobileAnchor: "view-switch" },
  },
  {
    id: "2a", point: 2, letter: "A", name: "Som runde 3",
    line: "Fordel: intet nyt at bygge; ulempe: ca. 600 px før første rytter og kun ca. 4 ryttere pr. skærm på telefonen.",
    recommended: false,
    cfg: { sheet: "today" },
  },
  {
    id: "2b", point: 2, letter: "B", name: "Klæbende visninger, foldet profil, D-047",
    line: "Fordel: Trup/Taktik/Formtop klæber øverst, profilen er én linje og 9-10 ryttere står på skærmen med tre tal og \"Fuld tabel\"; ulempe: ruten skal foldes ud for at ses.",
    recommended: true,
    cfg: { sheet: "sticky", head: "compact" },
  },
  {
    id: "2c", point: 2, letter: "C", name: "Rytterkort",
    line: "Fordel: hver rytter har plads til rolle, tal og status uden tabel; ulempe: kortene fylder, så kun 4-5 ryttere ses, og D-047 valgte tabellen frem for kort.",
    recommended: false,
    cfg: { sheet: "cards", head: "compact" },
  },
  {
    id: "3a", point: 3, letter: "A", name: "Kun trup (som i dag)",
    line: "Fordel: roligt og kendt; ulempe: \"Klar\" siger intet om taktik eller formtop, så et løb kan se færdigt ud uden en plan.",
    recommended: false,
    cfg: { status: "squad", mobileList: true },
  },
  {
    id: "3b", point: 3, letter: "B", name: "Trup + taktik + formtop-mærke",
    line: "Fordel: hvert løb viser trup, taktik (Gemt/Standardplan/Ikke gemt) og formtop, og ugen siger \"4 mangler trup · 3 mangler taktik\"; ulempe: kræver et samlet læse-kald først.",
    recommended: true,
    cfg: { status: "full", mobileList: true },
  },
  {
    id: "3c", point: 3, letter: "C", name: "Én samlet status",
    line: "Fordel: ét mærke der kun er grønt når trup og taktik begge er klar; ulempe: man skal åbne løbet for at se hvad der mangler og hvor meget.",
    recommended: false,
    cfg: { status: "single", mobileList: true },
  },
  {
    id: "4a", point: 4, letter: "A", name: "Som runde 3",
    line: "Fordel: den store profil er altid fremme; ulempe: første rytter står ca. 950 px nede (TASTE: under 250), så tabellen er under folden.",
    recommended: false,
    cfg: { head: "today", anchor: "workbench", mobileAnchor: "sheet-top" },
  },
  {
    id: "4b", point: 4, letter: "B", name: "Lille profil + vælger i løbshovedet",
    line: "Fordel: profilen er en lav stribe, Trup/Taktik/Formtop står i løbshovedets række og hovedet klæber, så første rytter er ca. 250 px nede; ulempe: afviger fra specen og kræver dit ja.",
    recommended: true,
    cfg: { head: "compact", anchor: "workbench", mobileAnchor: "sheet-top", sheet: "sticky" },
  },
  {
    id: "4c", point: 4, letter: "C", name: "Profilen foldet helt væk",
    line: "Fordel: tabellen starter næsten med det samme; ulempe: ruten er kun etape-chips, og man skal klikke for at se terrænet man udtager til.",
    recommended: false,
    cfg: { head: "folded", anchor: "workbench", mobileAnchor: "sheet-top", sheet: "sticky" },
  },
  {
    id: "5a", point: 5, letter: "A", name: "\"Efter løbet\" (som i dag)",
    line: "Fordel: findes allerede; ulempe: tallet ser bort fra planen og hedder det samme som løbssidens \"efter løbet\", der betyder noget andet.",
    recommended: false,
    cfg: { after: "today", anchor: "squad-table", mobileAnchor: "squad-table" },
  },
  {
    id: "5b", point: 5, letter: "B", name: "\"Træthed ved mål\" med +-bjælke",
    line: "Fordel: navnet siger hvad det er, og bjælken viser nu + det løbet lægger oven i; ulempe: regnes først efter den gemte plan senere (motor-design + Fable).",
    recommended: true,
    cfg: { after: "finish", anchor: "squad-table", mobileAnchor: "squad-table" },
  },
  {
    id: "5c", point: 5, letter: "C", name: "Fjern kolonnen indtil planen tæller",
    line: "Fordel: intet tal der kan misforstås; ulempe: manageren mister et fingerpeg om hvem der er brugt op efter løbet.",
    recommended: false,
    cfg: { after: "none", anchor: "squad-table", mobileAnchor: "squad-table" },
  },
  {
    id: "6a", point: 6, letter: "A", name: "Som runde 3",
    fullD: true,
    line: "Fordel: samme liste som Form-fanen; ulempe: ingen kobling til truppen, så en formtop på en rytter der ikke er udtaget ses ikke.",
    recommended: false,
    cfg: { view: "peak", peak: "today", anchor: "view-switch", mobileAnchor: "view-switch" },
  },
  {
    id: "6b", point: 6, letter: "B", name: "Udtagne øverst + advarsel",
    fullD: true,
    line: "Fordel: \"I truppen\" øverst og en advarsel når formtoppen rammer et løb rytteren ikke er udtaget til, mobilens 3. kolonne er målets status; ulempe: listen er sorteret efter trup, ikke efter rating.",
    recommended: true,
    cfg: { view: "peak", peak: "linked", anchor: "view-switch", mobileAnchor: "view-switch" },
  },
  {
    id: "6c", point: 6, letter: "C", name: "Formtop som kolonne i truppen",
    fullD: true,
    line: "Fordel: ingen ekstra visning, formtop ses mens man udtager; ulempe: trup-tabellen får endnu en kolonne og selve målet sættes stadig et andet sted.",
    recommended: false,
    cfg: { view: "squad", peak: "column", table: "today", anchor: "squad-table", mobileAnchor: "squad-table" },
  },
  {
    id: "7a", point: 7, letter: "A", name: "Som runde 3",
    line: "Fordel: kendt; ulempe: payback står kun i Formtop, og rutematch i guld konkurrerer med sidens ene guld-knap.",
    recommended: false,
    cfg: { table: "today", anchor: "squad-table", mobileAnchor: "squad-table" },
  },
  {
    id: "7b", point: 7, letter: "B", name: "Formtop-mærke + payback i status, rutematch som bjælke",
    line: "Fordel: status viser formtop og prisen i ord, og rutematch er en neutral bjælke med tal; ulempe: status-cellen bliver to linjer for nogle ryttere.",
    recommended: true,
    cfg: { table: "status", anchor: "squad-table", mobileAnchor: "squad-table" },
  },
  {
    id: "7c", point: 7, letter: "C", name: "B + rolle som chip (fælles med taktik)",
    line: "Fordel: rollen ser ens ud i trup og taktik, et tryk skifter den; ulempe: kræver den fælles rolle-komponent, som er et senere trin.",
    recommended: false,
    cfg: { table: "roleChip", anchor: "squad-table", mobileAnchor: "squad-table" },
  },
  {
    id: "8a", point: 8, letter: "A", name: "Som runde 3",
    fullD: true, fullM: true,
    line: "Fordel: intet nyt; ulempe: taktik gemmes nederst mens hovedets guld siger \"Gem trup\", og en ugemt trup skjuler taktikken helt.",
    recommended: false,
    cfg: { view: "tactics", save: "today", squadDirty: true, anchor: "workbench", mobileAnchor: "sheet-top" },
  },
  {
    id: "8b", point: 8, letter: "B", name: "Hovedets guld følger visningen",
    fullD: true, fullM: true,
    line: "Fordel: ét guld øverst der altid gemmer det man ser, og ved ugemt trup står \"Gem trup og sæt taktik\"; ulempe: hovedets knap skifter tekst, når man skifter visning.",
    recommended: true,
    cfg: { view: "tactics", save: "follows", squadDirty: true, anchor: "workbench", mobileAnchor: "sheet-top" },
  },
  {
    id: "8c", point: 8, letter: "C", name: "Fælles gem-bjælke nederst",
    fullD: true, fullM: true,
    line: "Fordel: én bjælke samler alle ugemte ændringer, trup og taktik, og gemmer dem i ét tryk; ulempe: to skriv bag én knap, så en delvis fejl skal forklares.",
    recommended: false,
    cfg: { view: "tactics", save: "bar", squadDirty: true, anchor: "workbench", mobileAnchor: "sheet-top" },
  },
];

export function configFor(v: Variant): Config {
  return { ...BASE, ...v.cfg };
}

export function variantById(id: string | null): Variant | undefined {
  return VARIANTS.find((v) => v.id === id);
}
