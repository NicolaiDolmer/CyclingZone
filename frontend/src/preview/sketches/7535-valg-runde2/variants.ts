// #8254 (valg runde 2 for #7535): punkt 4-8 fra "Gennemgang af #8216" som billeder side om side
// med wireframen fra 2/11 (pr-screens/7535/prototype-desktop-1440.png, prototype-mobile-375.png).
//
// Grundlaget i hvert billede: ejerens valg 1-3 fra 16/11 er lagt ind (fælles taktik-komponent med
// løbssiden v6, kompakt mobil med kolonneoverskrifter og kortets radius, status B i løbslisten), og
// alle punkter billedet IKKE handler om, står som wireframen. Så viser hvert billede kun forskellen
// for sit eget punkt, og de røde numre peger kun på afvigelser der hører til punktet.
//
// Bogstaverne A-C er de samme som i PR #8226's tabel og anbefaling (4B, 5B, 6B, 7B, 8B). Hvor ingen
// af A-C er "som wireframen", er der lagt et D til, der er det.

export type View = "squad" | "tactics" | "peak";

export interface Config {
  view: View;
  /** Punkt 4: hvor meget der står før første rytter. */
  head: "wireframe" | "today" | "compact" | "folded";
  /** Punkt 4: "Skjul profil" er trykket (valget huskes af siden). */
  profileHidden: boolean;
  /** Punkt 5: kolonnen "Efter løbet". */
  after: "today" | "finish" | "none";
  /** Punkt 6: Formtop-visningens kobling til truppen. */
  peak: "today" | "linked" | "column";
  /** Punkt 7: trup-tabellens kolonner. */
  table: "wireframe" | "today" | "status" | "roleChip";
  /** Punkt 8: hvor der gemmes. */
  save: "today" | "follows" | "bar";
  /** Punkt 8: truppen har ugemte ændringer. */
  squadDirty: boolean;
  /** Punktet billedet handler om; kun dets afvigelser får røde numre. */
  focus: number;
}

/** Alt der ikke er billedets punkt: som wireframen (4D, 5A, 6A, 7D, 8A). */
export const BASE: Config = {
  view: "squad",
  head: "wireframe",
  profileHidden: false,
  after: "today",
  peak: "today",
  table: "wireframe",
  save: "today",
  squadDirty: false,
  focus: 0,
};

export interface Variant {
  id: string;
  point: number;
  letter: "A" | "B" | "C" | "D";
  name: string;
  /** Én sætning: fordel; ulempe. */
  line: string;
  /** Anbefalet i PR #8226 (samme bogstav). */
  recommended: boolean;
  /** Varianten er som wireframen fra 2/11. */
  wireframe: boolean;
  /** Kort note ved wireframe-mærket (fx hvad wireframen ikke tegner). */
  wfNote?: string;
  cfg: Partial<Config>;
}

export const POINTS: Record<number, string> = {
  4: "Plads før data",
  5: "\"Efter løbet\"",
  6: "Formtop",
  7: "Trup-tabel",
  8: "Gem",
};

/** Anbefalingen pr. punkt i PR #8226 (bogstavet må ikke flytte sig). */
export const PR8226_RECOMMENDED: Record<number, string> = { 4: "B", 5: "B", 6: "B", 7: "B", 8: "B" };

/** Punkt 4 vises i begge tilstande; resten i én. */
export type ProfileState = "vist" | "skjult";

export const VARIANTS: Variant[] = [
  {
    id: "4a", point: 4, letter: "A", name: "Som runde 3",
    line: "Fordel: den store profil med stat-linje og terræn-mærker er fremme, og Skjul profil folder den til etape-linjen og huskes; ulempe: med profilen vist står første rytter langt under folden.",
    recommended: false, wireframe: false,
    cfg: { head: "today" },
  },
  {
    id: "4b", point: 4, letter: "B", name: "Lille profil + vælger i løbshovedet",
    line: "Fordel: profilen er en lav stribe med alle etaper, Trup/Taktik/Formtop står i løbshovedet og første rytter er højt oppe, også med profilen vist; ulempe: afviger fra wireframen, der har én stor profil og fanerne under den.",
    recommended: true, wireframe: false,
    cfg: { head: "compact" },
  },
  {
    id: "4c", point: 4, letter: "C", name: "Profilen foldet helt væk",
    line: "Fordel: tabellen starter næsten med det samme, fordi profilen som standard er foldet til etape-linjen; ulempe: man skal trykke Vis profil for at se terrænet man udtager til.",
    recommended: false, wireframe: false,
    cfg: { head: "folded" },
  },
  {
    id: "4d", point: 4, letter: "D", name: "Som wireframen",
    line: "Fordel: præcis wireframens rækkefølge (hoved med tre knapper, etape-linje med Skjul profil, én profil, fanerne, tabellen), og skjult profil huskes; ulempe: med profilen vist står første rytter under folden på 1440x900.",
    recommended: false, wireframe: true,
    cfg: { head: "wireframe" },
  },
  {
    id: "5a", point: 5, letter: "A", name: "\"Efter løbet\" (som i dag)",
    line: "Fordel: findes allerede og står som i wireframen (~tal efter løbet); ulempe: tallet ser bort fra planen og hedder det samme som løbssidens \"efter løbet\", der betyder noget andet.",
    recommended: false, wireframe: true,
    cfg: { after: "today" },
  },
  {
    id: "5b", point: 5, letter: "B", name: "\"Træthed ved mål\" med +-bjælke",
    line: "Fordel: navnet siger hvad det er, og bjælken viser nu + det løbet lægger oven i; ulempe: regnes først efter den gemte plan senere (motor-design + Fable).",
    recommended: true, wireframe: false,
    cfg: { after: "finish" },
  },
  {
    id: "5c", point: 5, letter: "C", name: "Fjern kolonnen indtil planen tæller",
    line: "Fordel: intet tal der kan misforstås; ulempe: manageren mister et fingerpeg om hvem der er brugt op efter løbet, og wireframens kolonne forsvinder.",
    recommended: false, wireframe: false,
    cfg: { after: "none" },
  },
  {
    id: "6a", point: 6, letter: "A", name: "Som runde 3",
    line: "Fordel: samme liste som Form-fanen, og fanen Formtop står hvor wireframen har Peak form; ulempe: ingen kobling til truppen, så en formtop på en rytter der ikke er udtaget ses ikke.",
    recommended: false, wireframe: true, wfNote: "fanen; wireframen tegner ikke indholdet",
    cfg: { view: "peak", peak: "today" },
  },
  {
    id: "6b", point: 6, letter: "B", name: "Udtagne øverst + advarsel",
    line: "Fordel: \"I truppen\" øverst og en advarsel når formtoppen rammer et løb rytteren ikke er udtaget til; ulempe: listen er sorteret efter trup, ikke efter rating.",
    recommended: true, wireframe: false,
    cfg: { view: "peak", peak: "linked" },
  },
  {
    id: "6c", point: 6, letter: "C", name: "Formtop som kolonne i truppen",
    line: "Fordel: ingen ekstra visning, formtop ses mens man udtager; ulempe: trup-tabellen får endnu en kolonne og selve målet sættes stadig et andet sted.",
    recommended: false, wireframe: false,
    cfg: { view: "squad", peak: "column" },
  },
  {
    id: "7a", point: 7, letter: "A", name: "Som runde 3",
    line: "Fordel: kendt; ulempe: payback står kun i Formtop, rutematch i guld konkurrerer med sidens ene guld-knap, og Type-kolonnen fra wireframen mangler.",
    recommended: false, wireframe: false,
    cfg: { table: "today" },
  },
  {
    id: "7b", point: 7, letter: "B", name: "Formtop-mærke + payback i status, rutematch som bjælke",
    line: "Fordel: status viser formtop og prisen i ord, og rutematch er en neutral bjælke med tal; ulempe: status-cellen bliver to linjer for nogle ryttere.",
    recommended: true, wireframe: false,
    cfg: { table: "status" },
  },
  {
    id: "7c", point: 7, letter: "C", name: "B + rolle som chip (fælles med taktik)",
    line: "Fordel: rollen ser ens ud i trup og taktik, et tryk skifter den; ulempe: kræver den fælles rolle-komponent, som er et senere trin.",
    recommended: false, wireframe: false,
    cfg: { table: "roleChip" },
  },
  {
    id: "7d", point: 7, letter: "D", name: "Som wireframen",
    line: "Fordel: wireframens kolonner i dens rækkefølge (Type, træthed med bjælke, Efter løbet, sorteret på rutematch); ulempe: payback og formtop står ikke ved rytteren, og den bedste rutematch står i guld.",
    recommended: false, wireframe: true,
    cfg: { table: "wireframe" },
  },
  {
    id: "8a", point: 8, letter: "A", name: "Som runde 3",
    line: "Fordel: Gem trup står i hovedet som wireframens Save squad; ulempe: taktik gemmes nederst, og en ugemt trup skjuler taktikken helt.",
    recommended: false, wireframe: true, wfNote: "Gem trup i hovedet; wireframen tegner ikke taktikkens gem",
    cfg: { view: "tactics", save: "today", squadDirty: true },
  },
  {
    id: "8b", point: 8, letter: "B", name: "Hovedets guld følger visningen",
    line: "Fordel: ét guld øverst der altid gemmer det man ser, og ved ugemt trup står \"Gem trup og sæt taktik\"; ulempe: hovedets knap skifter tekst, når man skifter visning.",
    recommended: true, wireframe: false,
    cfg: { view: "tactics", save: "follows", squadDirty: true },
  },
  {
    id: "8c", point: 8, letter: "C", name: "Fælles gem-bjælke nederst",
    line: "Fordel: én bjælke samler alle ugemte ændringer, trup og taktik, og gemmer dem i ét tryk; ulempe: to skriv bag én knap, så en delvis fejl skal forklares.",
    recommended: false, wireframe: false,
    cfg: { view: "tactics", save: "bar", squadDirty: true },
  },
];

/** Tilstandene et billede tages i: punkt 4 i begge, resten i én. */
export function statesFor(v: Variant): Array<ProfileState | null> {
  return v.point === 4 ? ["vist", "skjult"] : [null];
}

export function configFor(v: Variant, state: ProfileState | null = null): Config {
  // 4C er foldet som standard; "vist" er efter et tryk på Vis profil.
  return { ...BASE, ...v.cfg, focus: v.point, profileHidden: state === "skjult" };
}

export function variantById(id: string | null): Variant | undefined {
  return VARIANTS.find((v) => v.id === id);
}

/** Filnavn uden bredde: 4b-vist, 4b-skjult, 5a. */
export function shotName(v: Variant, state: ProfileState | null): string {
  return state ? `${v.id}-${state}` : v.id;
}
